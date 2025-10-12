use anyhow::{          
    Context,
    Result
};
use h3_quinn::quinn::{self, crypto::rustls::QuicServerConfig, VarInt};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use structopt::StructOpt;
use tokio::fs;
use tokio::sync::Semaphore;
use tracing::{error, info, warn};

use crate::quic_protocol::{handle_connection, create_upload_semaphore, create_download_semaphore};

// Command-line options structure using StructOpt for automatic CLI parsing
// This allows operators to configure the server without recompiling
#[derive(StructOpt, Debug)]
#[structopt(name = "server")]
struct Opt {
    // Server binding address, this is where the server listens for incoming connections
    // Uses SocketAddr which handles both IPv4 and IPv6 addresses
    #[structopt(short, long, help = "What address:port to listen for new connections")]
    pub listen: SocketAddr,
    
    // Certificate configuration is flattened to include cert/key fields directly
    // This makes the CLI interface cleaner while keeping the cert logic organized
    #[structopt(flatten)]
    pub certs: Certs,
    
    // Directory where uploaded files are stored, which is configurable for different deployments
    // Default is relative path, but absolute paths work too if needed
    #[structopt(long, default_value = "./received_files", help = "Files directory")]
    pub files_dir: PathBuf,
    
    // Connection limits; It prevents resource exhaustion under high load
    // 1000 concurrent connections is reasonable for most server hardware
    // Each connection consumes memory and file descriptors
    #[structopt(long, default_value = "1000", help = "Maximum concurrent connections")]
    pub max_connections: usize,
    
    // Transport configuration; These affect QUIC protocol behavior
    // Keep-alive prevents NAT timeouts and detects dead connections
    // 30 seconds balances network overhead with connection health monitoring
    #[structopt(long, default_value = "30", help = "Keep-alive interval in seconds")]
    pub keep_alive_interval: u64,
    
    // Idle timeout closes inactive connections to free resources
    // 120 seconds allows for slow uploads while preventing resource leaks
    #[structopt(long, default_value = "120", help = "Max idle timeout in seconds")]
    pub idle_timeout: u64,
    
    // Flow control windows manage how much data can be in-flight
    // Larger windows improve throughput but use more memory
    // 10MB windows support high-speed transfers without excessive buffering
    #[structopt(long, default_value = "250000000", help = "Receive window size in bytes (default 250MB)")]
    pub receive_window: u32,
    
    #[structopt(long, default_value = "250000000", help = "Send window size in bytes (default 250MB)")]
    pub send_window: u32,
    
    // Memory limit, we need to control buffer sizes to prevent memory exhaustion
    // 1MB datagram buffer handles large individual packets efficiently
    // Datagrams are used for control messages and small data transfers
    #[structopt(long, default_value = "10485760", help = "Datagram receive buffer size in bytes (default 10MB)")]
    pub datagram_buffer_size: usize,
    
    // 2MB stream window controls per-stream flow control
    // Streams carry file data, so larger windows improve file transfer performance
    #[structopt(long, default_value = "50000000", help = "Stream receive window in bytes (default 50MB)")]
    pub stream_window: u64,
}

// Certificate configuration structure, it handles TLS certificate and private key paths
// QUIC requires TLS 1.3, so we need valid certificates for encrypted connections
// PEM format is standard and widely supported by certificate authorities
#[derive(StructOpt, Debug)]
pub struct Certs {
    // Path to TLS certificate file in PEM format
    // This proves the server's identity to clients and enables encrypted communication
    #[structopt(long, short, help = "Certificate for TLS (PEM format).")]
    pub cert: PathBuf,
    
    // Path to private key file in PEM format  
    // Used to decrypt data sent to the server and sign outgoing messages
    // Must correspond to the public key in the certificate
    #[structopt(long, short, help = "Private key for the certificate (PEM format).")]
    pub key: PathBuf,
}

// ALPN (Application-Layer Protocol Negotiation) identifiers for HTTP/3
// These are the protocol versions the server support during TLS handshake
// Clients and servers negotiate which version to use based on mutual support
// Listed in preference order, with newer versions first, with fallbacks for compatibility
const ALPN_H3: &[&[u8]] = &[
    b"h3", b"h3-32", b"h3-31", b"h3-30", b"h3-29",
];

// Metrics tracking structure for monitoring server health and load
// Uses atomic operations for thread-safe counters without locks
// This enables concurrent updates from multiple connection handlers
struct ServerMetrics {
    // Current number of active connection, it decrements when connections close
    // Used for load monitoring and connection limit enforcement
    active_connections: Arc<std::sync::atomic::AtomicUsize>,
    
    // Total connections accepted since server start, it only increments
    // Useful for understanding overall server usage patterns and growth
    total_connections: Arc<std::sync::atomic::AtomicU64>,
}

impl ServerMetrics {
    // Initialize metrics with zero counters
    // Arc wrapping enables sharing across async tasks without lifetime issues
    fn new() -> Self {
        Self {
            active_connections: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            total_connections: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
    
    // Increment both active and total connection counters when a new connection arrives
    // Relaxed ordering is sufficient since we don't need strict synchronization
    // These are metrics, not critical for correctness, as eventual consistency is fine
    fn increment_active(&self) {
        self.active_connections.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.total_connections.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    // Decrement active connections when a connection closes
    // Only affects active count, the total connections never decrease
    fn decrement_active(&self) {
        self.active_connections.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    // Read current active connection count for monitoring
    // Relaxed ordering provides good performance for frequent reads
    fn get_active(&self) -> usize {
        self.active_connections.load(std::sync::atomic::Ordering::Relaxed)
    }
    
    // Read total connection count for usage statistics
    // This number only increases, providing historical connection volume
    fn get_total(&self) -> u64 {
        self.total_connections.load(std::sync::atomic::Ordering::Relaxed)
    }
}

// Main server entry point, which sets up QUIC server with HTTP/3 and WebTransport support
// Returns a boxed error trait object to handle different error types uniformly
pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    // Install the default crypto provider (ring) before any cryptographic operations
    // This is required by rustls and must be done early in the program lifecycle
    // The ring crate provides high-performance, audited cryptographic implementations
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "Failed to install default crypto provider")?;

    // Initialize structured logging with environment-based filtering
    // Operators can control log levels via RUST_LOG environment variable
    // Format provides timestamps, levels, and hierarchical span information
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse command-line arguments into our configuration struct
    // StructOpt automatically handles --help, validation, and type conversion
    let opt = Opt::from_args();
    
    // Validate configuration parameters to prevent invalid server states
    // Zero connections would make the server unable to accept any clients
    if opt.max_connections == 0 {
        return Err("max_connections must be greater than 0".into());
    }
    // Zero keep-alive would disable connection health monitoring
    if opt.keep_alive_interval == 0 {
        return Err("keep_alive_interval must be greater than 0".into());
    }
    // Zero idle timeout would immediately close all connections
    if opt.idle_timeout == 0 {
        return Err("idle_timeout must be greater than 0".into());
    }
    
    // Ensure the files directory exists before starting the server
    // create_dir_all creates parent directories if needed, similar to 'mkdir -p'
    fs::create_dir_all(&opt.files_dir).await?;
    // Arc wrapping allows sharing the path across multiple async tasks safely
    let files_dir = Arc::new(opt.files_dir);
    
    // Create semaphores for rate limiting different operation types
    // Upload operations are more resource-intensive (disk I/O, parsing)
    // Download operations are primarily network-bound
    // Separate limits allow tuning based on resource usage patterns
    let upload_semaphore = create_upload_semaphore();
    let download_semaphore = create_download_semaphore();
    
    // Create connection limit semaphore to prevent resource exhaustion
    // This is the hard limit on concurrent connections the server will accept
    // Exceeding this limit could exhaust file descriptors or memory
    let connection_limit = Arc::new(Semaphore::new(opt.max_connections));
    info!("Connection limit set to: {}", opt.max_connections);
    
    // Initialize metrics tracking for server monitoring
    // Arc enables sharing metrics between the main loop and background tasks
    let metrics = Arc::new(ServerMetrics::new());
    
    // Spawn background task for periodic metrics logging
    // This provides operational visibility into server load and usage patterns
    // 30-second intervals balance informativeness with log volume
    let metrics_clone = metrics.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            info!(
                "Server metric -> Active connections: {}, Total connections: {}",
                metrics_clone.get_active(),
                metrics_clone.get_total()
            );
        }
    });
    
    // Extract certificate configuration from command-line options
    let Certs { cert, key } = opt.certs;

    // Load TLS certificate chain from PEM file
    // PEM files can contain multiple certificates forming a chain
    // BufReader improves performance for file reading operations
    let certs: Vec<CertificateDer> = rustls_pemfile::certs(&mut std::io::BufReader::new(
        std::fs::File::open(cert).context("Failed to open cert file")?,
    ))
    .collect::<Result<_, _>>()?;

    // Load private key from PEM file
    // The private key must correspond to the first certificate in the chain
    // rustls_pemfile automatically detects different key formats (RSA, ECDSA, Ed25519)
    let key: PrivateKeyDer = rustls_pemfile::private_key(&mut std::io::BufReader::new(
        std::fs::File::open(key).context("Failed to open key file")?,
    ))?
    .context("Failed to find private key in file")?;

    // Build TLS configuration for the QUIC server
    // No client authentication required, as this is a public file transfer service
    // Single certificate configuration is sufficient for most use cases
    let mut tls_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    // Set ALPN protocols to negotiate HTTP/3 during TLS handshake
    // This tells clients that we support HTTP/3 over QUIC transport
    tls_config.alpn_protocols = ALPN_H3.iter().map(|&x| x.into()).collect();
    
    // Create QUIC transport configuration with user-specified parameters
    // This controls low-level QUIC protocol behavior and performance characteristics
    let mut transport_config = quinn::TransportConfig::default();
    
    // Configure keep-alive to detect dead connections and prevent NAT timeouts
    // Regular keep-alive packets maintain connection state in network equipment
    // This is essential for long-lived connections behind NATs and firewalls
    transport_config.keep_alive_interval(Some(
        std::time::Duration::from_secs(opt.keep_alive_interval)
    ));
    
    // Set maximum idle timeout before closing inactive connections
    // This prevents resource leaks from abandoned connections
    // Balance between allowing slow operations and freeing unused resources
    transport_config.max_idle_timeout(Some(
        std::time::Duration::from_secs(opt.idle_timeout).try_into().unwrap()
    ));
    
    // Configure flow control windows to manage memory usage and throughput
    // Larger windows allow more data in-flight, improving performance for high-latency connections
    // But they also consume more memory and can amplify congestion
    transport_config.receive_window(VarInt::from_u32(opt.receive_window).into());
    transport_config.send_window(VarInt::from_u32(opt.send_window).into());
    
    // Set memory limits for different data types
    // Datagram buffer size affects unreliable message performance
    // Stream receive window controls per-stream memory usage
    transport_config.datagram_receive_buffer_size(Some(opt.datagram_buffer_size));
    transport_config.stream_receive_window(VarInt::from_u64(opt.stream_window).unwrap());
    
    // Log the applied transport configuration for operational visibility
    // Helps operators verify settings and diagnose connection issues
    // Convert bytes to MB for human-readable logging
    info!("Transport config -> Keep-alive: {}s, Idle timeout: {}s, Receive window: {}MB, Send window: {}MB",
          opt.keep_alive_interval, opt.idle_timeout, 
          opt.receive_window / 1_000_000, opt.send_window / 1_000_000);
    
    // Combine TLS configuration with transport settings to create the server config
    // Arc wrapping is required because quinn needs shared ownership of the configuration
    // The configuration is used by all connections accepted by this server
    let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(QuicServerConfig::try_from(tls_config)?));
    server_config.transport = Arc::new(transport_config);
    
    // Create and bind the QUIC endpoint to the specified address
    // This creates the UDP socket and begins listening for incoming connections
    // The endpoint manages connection establishment and multiplexing
    let endpoint = quinn::Endpoint::server(server_config, opt.listen)?;
    info!("Server listening on {}", opt.listen);

    // Setup graceful shutdown handler for clean server termination
    // Ctrl+C signal allows operators to stop the server cleanly
    // tokio::pin! is needed because select! requires pinned futures
    let shutdown = tokio::signal::ctrl_c();
    tokio::pin!(shutdown);

    // Main server loop, which handles incoming connections and shutdown signals
    // tokio::select! allows us to handle multiple async operations concurrently
    loop {
        tokio::select! {
            // New incoming connection branch
            Some(new_conn) = endpoint.accept() => {
                // Enforce connection limits to prevent resource exhaustion
                // try_acquire_owned doesn't block, so we can reject connections immediately
                // The owned permit automatically releases when the connection task completes
                let permit = match connection_limit.clone().try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        warn!("Connection limit reached, rejecting new connection");
                        continue;
                    }
                };
                
                // Clone shared resources for the connection handler task
                // Arc cloning is cheap, it only increments a reference counter
                // Each connection needs access to these shared resources
                let files_dir = files_dir.clone();
                let upload_semaphore = upload_semaphore.clone();
                let download_semaphore = download_semaphore.clone();
                let metrics = metrics.clone();
                
                // Spawn async task to handle this connection independently
                // This allows the server to accept new connections while processing existing ones
                // Each connection runs in its own task with its own stack
                tokio::spawn(async move {
                    // Update metrics to track connection activity
                    metrics.increment_active();
                    
                    // Hold the connection permit for the entire connection lifetime
                    // When this variable is dropped, the permit is automatically returned
                    let _permit = permit;
                    
                    // Wait for the QUIC connection to be fully established
                    // This includes the TLS handshake and QUIC connection setup
                    match new_conn.await {
                        Ok(conn) => {
                            info!("New connection established from {:?}", conn.remote_address());
                            // Build HTTP/3 connection on top of the QUIC connection
                            // WebTransport support enables bidirectional streaming
                            // Datagram support allows unreliable message delivery
                            // Extended CONNECT enables WebTransport protocol negotiation
                            let h3_conn = match h3::server::builder()
                                .enable_webtransport(true)
                                .enable_datagram(true)
                                .enable_extended_connect(true)
                                .build(h3_quinn::Connection::new(conn))
                                .await
                            {
                                Ok(conn) => conn,
                                Err(err) => {
                                    error!("Failed to build H3 connection: {:?}", err);
                                    // Ensure metrics are correctly decremented on setup failure
                                    metrics.decrement_active();
                                    return;
                                }
                            };

                            // Handle the established HTTP/3 connection
                            // This delegates to our protocol-specific connection handler
                            // Errors are logged but don't crash the server, as connections can fail for many reasons
                            if let Err(err) = handle_connection(
                                h3_conn, 
                                files_dir, 
                                upload_semaphore, 
                                download_semaphore
                            ).await {
                                info!("Connection ended: {err:?}");
                            }
                        }
                        Err(err) => {
                            // Log connection establishment failures
                            // These can occur due to network issues, invalid certificates, etc.
                            error!("Accepting connection failed: {:?}", err);
                        }
                    }
                    
                    // Always decrement active connection count when task completes
                    // This ensures accurate metrics regardless of how the connection ended
                    metrics.decrement_active();
                });
            }
            // Shutdown signal branch, it gracefully handles server termination
            _ = &mut shutdown => {
                println!();
                info!("Shutdown signal received, closing server gracefully...");
                
                // Close the endpoint to stop accepting new connections
                // This prevents new clients from connecting during shutdown
                // The error code 0 indicates normal termination to clients
                endpoint.close(VarInt::from_u32(0), b"Server shutting down");
                
                // Wait for all active connections to complete naturally
                // This ensures file transfers in progress can finish
                // Prevents data loss or corruption from abrupt termination
                info!("Waiting for active connections to finish...");
                endpoint.wait_idle().await;
                
                info!("Server shutdown complete");
                break;
            }
        }
    }

    Ok(())
}