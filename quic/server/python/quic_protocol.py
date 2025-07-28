import asyncio
import logging
import os
from pathlib import Path
from typing import Optional, BinaryIO
from urllib.parse import unquote, urlparse

from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import WebTransportStreamDataReceived, HeadersReceived, H3Event
from aioquic.quic.events import QuicEvent, ConnectionTerminated

logger = logging.getLogger("hypercorn.quic")
RECEIVED_FILES_DIR = Path(__file__).parent / "received_files"
DRAFT_HEADER_VERSION = b"draft02"
CHUNK_SIZE = 65536

class WebTransportServerProtocol(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._h3: Optional[H3Connection] = None
        self._upload_file_handle: Optional[BinaryIO] = None

    def quic_event_received(self, event: QuicEvent) -> None:
        """
        Override the base method to gain full control of stream handling
        and prevent unwanted object creation that causes warnings.
        """
        if isinstance(event, ConnectionTerminated):
            # Let the parent class handle termination logic
            super().quic_event_received(event)
            return

        if self._h3 is None: 
            self._h3 = H3Connection(self._quic, enable_webtransport=True)
        
        # Pass the event to the H3 layer.
        for h3_event in self._h3.handle_event(event):
            asyncio.create_task(self.h3_event_received(h3_event))

    async def h3_event_received(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            headers = {k.decode("utf-8"): v.decode("utf-8") for k, v in event.headers}
            if headers.get(":method") == "CONNECT" and headers.get(":protocol") == "webtransport":
                path = headers.get(":path", "/")
                parsed_path = urlparse(path)
                
                if parsed_path.path.startswith("/upload/"):
                    filename = unquote(os.path.basename(parsed_path.path.lstrip('/upload/')))
                    self.accept_upload_session(event.stream_id, filename)
                elif parsed_path.path.startswith("/download/"):
                    filename = unquote(os.path.basename(parsed_path.path.lstrip('/download/')))
                    self.accept_download_session(event.stream_id, filename)
                else:
                    self._h3.send_headers(event.stream_id, [(b":status", b"404")]); self.transmit()
        
        elif isinstance(event, WebTransportStreamDataReceived):
            await self.handle_upload_chunk(event)

    def accept_upload_session(self, session_id: int, filename: str):
        try:
            RECEIVED_FILES_DIR.mkdir(exist_ok=True)
            filepath = RECEIVED_FILES_DIR / filename
            logger.info(f"Accepting UPLOAD session for '{filename}'. Saving to {filepath}")
            self._upload_file_handle = open(filepath, "wb")
            self._h3.send_headers(session_id, [(b":status", b"200"), (b"sec-webtransport-http3-draft", DRAFT_HEADER_VERSION)])
            self.transmit()
        except Exception as e:
            logger.error(f"Failed to open file for upload: {e}")
            self._h3.send_headers(session_id, [(b":status", b"500")]); self.transmit()
    
    def accept_download_session(self, session_id: int, filename: str):
        logger.info(f"Accepting DOWNLOAD session for '{filename}'.")
        self._h3.send_headers(session_id, [(b":status", b"200"), (b"sec-webtransport-http3-draft", DRAFT_HEADER_VERSION)])
        self.transmit()
        asyncio.create_task(self.start_file_download(session_id, filename))

    async def start_file_download(self, session_id: int, filename: str):
        filepath = RECEIVED_FILES_DIR / filename
        if not filepath.is_file():
            logger.error(f"Download failed: File not found at '{filepath}'")
            return
            
        try:
            # Create a WebTransport stream using your corrected method.
            stream_id = self._h3.create_webtransport_stream(session_id, is_unidirectional=True)
            logger.info(f"Starting download of '{filepath}' on new server-initiated stream {stream_id}...")
            
            loop = asyncio.get_running_loop()
            with await loop.run_in_executor(None, open, filepath, "rb") as f:
                while True:
                    chunk = await loop.run_in_executor(None, f.read, CHUNK_SIZE)
                    # Use the low-level QUIC data sending method for this raw stream.
                    self._quic.send_stream_data(stream_id, chunk, not chunk)
                    self.transmit()
                    if not chunk:
                        break
            logger.info(f"Finished sending '{filepath}' and closed stream {stream_id}")
        except Exception as e:
            logger.exception(f"Error during file download: {e}")

    async def handle_upload_chunk(self, event: WebTransportStreamDataReceived):
        if self._upload_file_handle and event.data:
            await asyncio.get_running_loop().run_in_executor(None, self._upload_file_handle.write, event.data)
        if event.stream_ended:
            logger.info("Upload stream ended.")
    
    def connection_lost(self, exc):
        if self._upload_file_handle:
            logger.info("Connection lost, closing upload file handle.")
            self._upload_file_handle.close()
            self._upload_file_handle = None
        super().connection_lost(exc)