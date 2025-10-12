// Entry point for the QUIC WebTransport server
// mod auth;
mod quic_protocol;
mod quic_run_server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!();
    println!("\x1b[2m===================================\x1b[0m");
    println!("\x1b[36mByteBridge QUIC WebTransport Server\x1b[0m");
    println!("\x1b[2m===================================\x1b[0m");
    println!("\x1b[32mStarting high-performance file transfer server...\x1b[0m");
    println!("\x1b[33mPress Ctrl+C to gracefully shutdown the server\x1b[0m");
    println!();

    // Run the server and handle the result
    let result = quic_run_server::run_server().await;
    
    println!();
    println!("\x1b[35mByteBridge Server Shutdown Complete\x1b[0m");
    println!("\x1b[36mThank you for using ByteBridge!\x1b[0m");
    
    result
}