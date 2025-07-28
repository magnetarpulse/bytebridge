use std::{path::PathBuf, sync::Arc};

use futures::future;
use h3_quinn::quinn;
use h3::error::{StreamError};
use structopt::StructOpt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{error, info};
use bytes::Buf;

static ALPN: &[u8] = b"h3";

#[derive(StructOpt, Debug)]
#[structopt(name = "webtransport-client")]
struct Opt {
    #[structopt(
        long,
        short,
        help = "Certificate file (PEM format) of CA who issues the server certificate"
    )]
    pub ca: Option<PathBuf>,

    #[structopt(name = "keylogfile", long)]
    pub key_log_file: bool,

    #[structopt(help = "The URL to connect to (e.g., https://your.domain:8000)")]
    pub url: String,

    #[structopt(long, help = "Path to the local file to upload")]
    pub upload: Option<PathBuf>,

    #[structopt(long, help = "Name of the remote file to download")]
    pub download: Option<String>,

    #[structopt(
        long,
        default_value = ".",
        help = "Directory or full path to save a downloaded file"
    )]
    pub output: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::FULL)
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();

    // Install the default crypto provider before any TLS operations
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "Failed to install default crypto provider")?;

    let opt = Opt::from_args();

    // Validate arguments
    if opt.upload.is_none() && opt.download.is_none() {
        return Err("Either --upload or --download must be specified".into());
    }

    if opt.upload.is_some() && opt.download.is_some() {
        return Err("Cannot specify both --upload and --download".into());
    }

    // Parse URI
    let uri = opt.url.parse::<http::Uri>()?;

    if uri.scheme() != Some(&http::uri::Scheme::HTTPS) {
        return Err("uri scheme must be 'https'".into());
    }

    let auth = uri.authority().ok_or("uri must have a host")?.clone();
    let port = auth.port_u16().unwrap_or(443);

    let addr = tokio::net::lookup_host((auth.host(), port))
        .await?
        .next()
        .ok_or("dns found no addresses")?;

    info!("DNS lookup for {:?}: {:?}", uri, addr);

    // Determine the path based on operation
    let path = if let Some(ref upload_path) = opt.upload {
        let filename = upload_path
            .file_name()
            .ok_or("Invalid upload file path")?
            .to_string_lossy();
        format!("/upload/{}", filename)
    } else if let Some(ref download_name) = opt.download {
        format!("/download/{}", download_name)
    } else {
        unreachable!()
    };

    info!("Connecting to {}:{} with path {}", auth.host(), port, path);

    // Setup TLS configuration
    let mut roots = rustls::RootCertStore::empty();
    
    // Fix: Handle CertificateResult properly
    let cert_result = rustls_native_certs::load_native_certs();
    for cert in cert_result.certs {
        if let Err(e) = roots.add(cert) {
            error!("failed to parse trust anchor: {}", e);
        }
    }
    
    // Log any errors from loading native certs
    for error in cert_result.errors {
        error!("Error loading native certificate: {}", error);
    }

    // Load custom CA certificate if provided
    if let Some(ca_path) = &opt.ca {
        info!("Loading CA certificate from: {:?}", ca_path);
        let ca_file = std::fs::read(ca_path)?;
        let mut ca_reader = std::io::Cursor::new(ca_file);
        
        // Parse PEM certificates
        let certs: Result<Vec<_>, _> = rustls_pemfile::certs(&mut ca_reader).collect();
        let certs = certs?;
        
        for cert in certs {
            if let Err(e) = roots.add(cert) {
                error!("failed to add CA certificate: {}", e);
            } else {
                info!("Successfully added CA certificate");
            }
        }
    }

    let mut tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    tls_config.enable_early_data = true;
    tls_config.alpn_protocols = vec![ALPN.into()];

    if opt.key_log_file {
        tls_config.key_log = Arc::new(rustls::KeyLogFile::new());
    }

    // Create QUIC client endpoint
    let mut client_endpoint = h3_quinn::quinn::Endpoint::client("[::]:0".parse().unwrap())?;

    let client_config = quinn::ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(tls_config)?,
    ));
    client_endpoint.set_default_client_config(client_config);

    let conn = client_endpoint.connect(addr, auth.host())?.await?;
    info!("QUIC connection established");

    // Create H3 connection
    let quinn_conn = h3_quinn::Connection::new(conn);
    let (mut driver, mut send_request) = h3::client::new(quinn_conn).await?;

    let drive = async move {
        future::poll_fn(|cx| driver.poll_close(cx)).await
    };

    // Build WebTransport CONNECT request
    let request = async move {
        info!("Establishing WebTransport session...");

        // Build the HTTP request using the builder pattern
        // Don't manually add pseudo-headers to HeaderMap - let the builder handle them
        let mut req = http::Request::builder()
            .uri(&format!("https://{}{}", auth.as_str(), path))
            .method("CONNECT")
            .header("sec-webtransport-http3-draft", "02")
            .header("upgrade", "webtransport")
            .body(())
            .map_err(|e| {
                error!("Failed to build request: {}", e);
                StreamError::Undefined(Box::new(e))
            })?;

        req.extensions_mut().insert(h3::ext::Protocol::WEB_TRANSPORT);

        let mut stream = send_request.send_request(req).await?;
        stream.finish().await?;

        info!("Waiting for WebTransport session response...");
        let resp = stream.recv_response().await?;

        info!("WebTransport response: {:?} {}", resp.version(), resp.status());
        
        if !resp.status().is_success() {
            return Err(StreamError::Undefined(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Server rejected WebTransport session: {}", resp.status()),
            ))));
        }

        // Check for WebTransport confirmation header
        let is_webtransport = resp.headers()
            .get("sec-webtransport-http3-draft")
            .is_some();

        if !is_webtransport {
            return Err(StreamError::Undefined(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Server did not confirm WebTransport session",
            ))));
        }

        info!("WebTransport session established successfully");

        // Handle upload or download
        if let Some(ref upload_path) = opt.upload {
            handle_upload(&mut stream, upload_path).await?;
        } else if opt.download.is_some() {
            handle_download(&mut stream, &opt.download.unwrap(), &opt.output).await?;
        }

        Ok::<_, StreamError>(())
    };


    let (req_res, drive_res) = tokio::join!(request, drive);

    if let Err(err) = req_res {
        error!("request failed: {:?}", err);
    }

    if !drive_res.is_h3_no_error() {
        error!("connection closed with error: {:?}", drive_res);
        return Err(drive_res.into());
    }

    info!("connection closed normally");
    client_endpoint.wait_idle().await;
    Ok(())
}

async fn handle_upload(
    stream: &mut h3::client::RequestStream<h3_quinn::BidiStream<bytes::Bytes>, bytes::Bytes>,
    upload_path: &PathBuf,
) -> Result<(), StreamError> {
    info!("Starting file upload: {:?}", upload_path);

    // Read the file
    let mut file = tokio::fs::File::open(upload_path).await.map_err(|e| {
        StreamError::Undefined(Box::new(e))
    })?;

    let mut file_data = Vec::new();
    file.read_to_end(&mut file_data).await.map_err(|e| {
        StreamError::Undefined(Box::new(e))
    })?;

    info!("File data read: {} bytes", file_data.len());

    // Send the file data through the stream
    stream.send_data(file_data.into()).await?;

    info!("File upload completed successfully");
    Ok(())
}

async fn handle_download(
    stream: &mut h3::client::RequestStream<h3_quinn::BidiStream<bytes::Bytes>, bytes::Bytes>,
    download_name: &str,
    output_path: &PathBuf,
) -> Result<(), StreamError> {
    info!("Starting file download: {}", download_name);

    // Determine the full output path
    let full_output_path = if output_path.is_dir() {
        output_path.join(download_name)
    } else {
        output_path.clone()
    };

    // Create parent directories if they don't exist
    if let Some(parent) = full_output_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            StreamError::Undefined(Box::new(e))
        })?;
    }

    info!("Saving file to: {:?}", full_output_path);

    // Create the output file
    let mut output_file = tokio::fs::File::create(&full_output_path).await.map_err(|e| {
        StreamError::Undefined(Box::new(e))
    })?;

    // Read data from the stream
    info!("Waiting for server to send file data...");

    let mut total_bytes = 0;
    while let Some(mut chunk) = stream.recv_data().await? {
        let chunk_size = chunk.remaining();
        output_file.write_all_buf(&mut chunk).await.map_err(|e| {
            StreamError::Undefined(Box::new(e))
        })?;
        total_bytes += chunk_size;
        info!("Received {} bytes (total: {})", chunk_size, total_bytes);
    }

    output_file.flush().await.map_err(|e| {
        StreamError::Undefined(Box::new(e))
    })?;

    info!("File download completed successfully: {} bytes", total_bytes);
    Ok(())
}