// Entry point for the QUIC WebTransport server
mod quic_protocol;
mod quic_run_server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    quic_run_server::run_server().await
}