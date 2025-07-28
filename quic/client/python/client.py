import argparse
import asyncio
import logging
from pathlib import Path
from typing import Dict, Optional, BinaryIO
from urllib.parse import urlparse

from aioquic.asyncio import QuicConnectionProtocol, connect
from aioquic.quic.configuration import QuicConfiguration
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import HeadersReceived, WebTransportStreamDataReceived, H3Event
from aioquic.quic.events import QuicEvent

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("wt-client")

class WebTransportClient(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._h3_connection: Optional[H3Connection] = None
        self.session_id: Optional[int] = None
        self.session_ready = asyncio.Event()
        self.session_failed = False
        self._download_files: Dict[int, BinaryIO] = {}
        self.download_finished = asyncio.Event()
        self._download_output_path: Optional[Path] = None


    def quic_event_received(self, event: QuicEvent) -> None:
        if self._h3_connection:
            for h3_event in self._h3_connection.handle_event(event):
                self._h3_event_received(h3_event)

    def _h3_event_received(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            is_webtransport_setup = False
            status = ""
            for header, value in event.headers:
                if header == b":status":
                    status = value.decode()
                if header == b"sec-webtransport-http3-draft":
                    is_webtransport_setup = True
            
            if is_webtransport_setup and status.startswith("2"):
                logger.info(f"WebTransport session established successfully (Status: {status})")
                self.session_id = event.stream_id
                self.session_ready.set()
            else:
                logger.error(f"Server rejected WebTransport session (Status: {status})")
                self.session_failed = True
                self.session_ready.set()

        elif isinstance(event, WebTransportStreamDataReceived):
            if event.stream_id not in self._download_files:
                logger.info(f"Server initiated download on stream {event.stream_id}")
                # Use the path set by the download_file method
                output_path = getattr(self, "_download_output_path", "downloaded_file")
                
                # Ensure the destination directory exists
                output_path.parent.mkdir(parents=True, exist_ok=True)
                
                logger.info(f"Opening file for writing at: {output_path}")
                self._download_files[event.stream_id] = open(output_path, "wb")
            
            logger.info(f"Received {len(event.data)} bytes for download on stream {event.stream_id}")
            self._download_files[event.stream_id].write(event.data)

            if event.stream_ended:
                logger.info(f"Download finished for stream {event.stream_id}")
                self._download_files[event.stream_id].close()
                del self._download_files[event.stream_id]
                self.download_finished.set()

    async def upload_file(self, file_path: Path):
        logger.info("Waiting for session to be ready...")
        await self.session_ready.wait()
        if self.session_failed or self.session_id is None:
            logger.error("Upload failed: session not established.")
            return
        logger.info(f"Session is ready. Opening new stream to upload '{file_path.name}'...")
        try:
            with open(file_path, "rb") as f:
                file_data = f.read()
            logger.info(f"File data read: {len(file_data)} bytes")
            stream_id = self._h3_connection.create_webtransport_stream(
                session_id=self.session_id, is_unidirectional=True
            )
            logger.info(f"Created WebTransport stream with ID: {stream_id}")
            self.transmit()
            self._quic.send_stream_data(stream_id, file_data, end_stream=True)
            self.transmit()
            logger.info(f"Sent raw data on QUIC stream {stream_id}")
            await asyncio.sleep(0.5)
        except FileNotFoundError:
            logger.error(f"Upload failed: File not found at '{file_path}'")
        except Exception as e:
            logger.error(f"Upload failed with error: {e}")
            import traceback
            traceback.print_exc()

    async def download_file(self, output_path: Path):
        """Prepares for a download by setting the output path and waiting."""
        self._download_output_path = output_path
        
        logger.info("Waiting for session to be ready...")
        await self.session_ready.wait()

        if self.session_failed or self.session_id is None:
            logger.error("Download failed: session not established.")
            return

        logger.info(f"Session ready. Waiting for server to send file to '{output_path}'...")
        try:
            await asyncio.wait_for(self.download_finished.wait(), timeout=30.0)
            logger.info(f"File successfully downloaded.")
        except asyncio.TimeoutError:
            logger.error("Download timed out. Server did not send a file in 30 seconds.")

async def main():
    parser = argparse.ArgumentParser(description="WebTransport Client for file transfer")
    parser.add_argument("url", type=str, help="The URL to connect to (e.g., https://your.domain:8000)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--upload", type=str, help="Path to the local file to upload.")
    group.add_argument("--download", type=str, help="Name of the remote file to download.")
    parser.add_argument("--output", type=str, default=".", help="Directory or full path to save a downloaded file.")

    args = parser.parse_args()
    
    parsed_url = urlparse(args.url)
    host = parsed_url.hostname
    port = parsed_url.port or 443
    
    file_path = None
    if args.upload:
        file_path = Path(args.upload)
        path = f"/upload/{file_path.name}"
    else: 
        file_name = args.download
        path = f"/download/{file_name}"

    logger.info(f"Connecting to {host}:{port} with path {path}")

    configuration = QuicConfiguration(
        alpn_protocols=["h3"],
        is_client=True,
        verify_mode=None
    )

    async with connect(
        host, port, configuration=configuration, create_protocol=WebTransportClient
    ) as client:
        client = client
        client._h3_connection = H3Connection(client._quic, enable_webtransport=True)
        stream_id = client._quic.get_next_available_stream_id()
        headers = [
            (b":method", b"CONNECT"), (b":scheme", b"https"),
            (b":authority", str.encode(f"{host}:{port}")), (b":path", str.encode(path)),
            (b":protocol", b"webtransport"), (b"sec-webtransport-http3-draft", b"02"),
        ]
        client._h3_connection.send_headers(stream_id=stream_id, headers=headers)
        client.transmit()

        if args.upload:
            await client.upload_file(file_path)
        else:
            output_arg = Path(args.output)
            # If the output path is a directory, append the requested filename.
            # Otherwise, use the full path as given.
            if output_arg.is_dir() or not output_arg.suffix:
                output_arg.mkdir(parents=True, exist_ok=True)
                full_output_path = output_arg / args.download
            else:
                output_arg.parent.mkdir(parents=True, exist_ok=True)
                full_output_path = output_arg
                
            await client.download_file(full_output_path)

        await asyncio.sleep(0.5)
        client.close()
        await client.wait_closed()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass