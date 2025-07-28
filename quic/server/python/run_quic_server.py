import asyncio
import logging
from pathlib import Path
from rich.console import Console
from rich.logging import RichHandler
from rich.traceback import install as install_traceback
from aioquic.asyncio import serve
from aioquic.quic.configuration import QuicConfiguration
from quic_protocol import WebTransportServerProtocol

HOST = "0.0.0.0"
QUIC_PORT = 8001
CERT_DIR = Path(__file__).parent / "certs"
CERT_FILE = CERT_DIR / "fullchain.pem"
KEY_FILE = CERT_DIR / "privkey.pem"

install_traceback(show_locals=True)

console = Console(force_terminal=True)
rich_handler = RichHandler(
    console=console,
    rich_tracebacks=True,
    markup=True
)

logging.basicConfig(
    level="INFO",
    format="%(message)s",
    datefmt="[%X]",
    handlers=[rich_handler]
)

logger = logging.getLogger(__name__)

async def main():
    logger.info("Configuring QUIC server...")
    config = QuicConfiguration(is_client=False, alpn_protocols=["h3"])
    config.load_cert_chain(CERT_FILE, KEY_FILE)

    logger.info(f"Starting QUIC/WebTransport server on [bold magenta]udp://{HOST}:{QUIC_PORT}[/bold magenta]")
    await serve(
        host=HOST,
        port=QUIC_PORT,
        configuration=config,
        create_protocol=WebTransportServerProtocol,
    )
    await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print()
        logger.info("QUIC server stopped by user.")