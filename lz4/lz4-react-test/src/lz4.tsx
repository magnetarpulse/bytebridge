import React, { useState, useRef, useEffect } from 'react';

// TypeScript type definitions for the LZ4 WASM module
interface LZ4Module {
  compress: (data: Uint8Array) => Uint8Array;
  decompress: (data: Uint8Array) => Uint8Array;
}

type InitFunction = (input?: string | URL | Request | BufferSource | WebAssembly.Module) => Promise<any>;

type StatusType = 'idle' | 'loading' | 'info' | 'success' | 'error' | 'warning';

interface TestResult {
  label: string;
  value: string | React.ReactNode;
}

interface ProgressState {
  percent: number;
  message: string;
}

const LZ4CompressionTest: React.FC = () => {
  const [wasmLoaded, setWasmLoaded] = useState<boolean>(false);
  const [lz4Module, setLz4Module] = useState<LZ4Module | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ message: string; type: StatusType }>({ 
    message: '', 
    type: 'idle' 
  });
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [compressedData, setCompressedData] = useState<Uint8Array | null>(null);
  const [decompressedData, setDecompressedData] = useState<Uint8Array | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const styles = {
    container: {
      width: '100%',
      padding: '20px',
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      background: 'linear-gradient(135deg, #f5f7fa 0%, #e4e7f1 100%)',
      minHeight: '100vh',
      color: '#34495e',
      lineHeight: '1.6'
    },
    header: {
      textAlign: 'center' as const,
      marginBottom: '30px',
      padding: '20px'
    },
    title: {
      fontSize: '2.5rem',
      color: '#2c3e50',
      marginBottom: '10px',
      fontWeight: '600'
    },
    subtitle: {
      color: '#95a5a6',
      fontSize: '1.1rem',
      maxWidth: '600px',
      margin: '0 auto'
    },
    card: {
      background: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.08)',
      padding: '30px',
      marginBottom: '30px',
      transition: 'transform 0.3s ease'
    },
    uploadSection: {
      border: '2px dashed #e0e0e0',
      borderRadius: '8px',
      padding: '30px',
      textAlign: 'center' as const,
      background: '#f9f9f9',
      transition: 'all 0.3s ease'
    },
    uploadIcon: {
      fontSize: '3rem',
      color: '#3498db',
      marginBottom: '15px'
    },
    uploadTitle: {
      fontSize: '1.2rem',
      marginBottom: '10px',
      color: '#2c3e50',
      fontWeight: '500'
    },
    uploadDescription: {
      color: '#95a5a6',
      marginBottom: '20px'
    },
    fileInputWrapper: {
      position: 'relative' as const,
      display: 'inline-block',
      margin: '20px 0'
    },
    fileInput: {
      position: 'absolute' as const,
      left: '0',
      top: '0',
      opacity: 0,
      width: '100%',
      height: '100%',
      cursor: 'pointer'
    },
    fileInputButton: {
      background: '#3498db',
      color: 'white',
      padding: '12px 25px',
      borderRadius: '6px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontWeight: '500',
      transition: 'background 0.3s',
      border: 'none'
    },
    fileName: {
      marginTop: '15px',
      fontSize: '0.9rem',
      color: '#95a5a6'
    },
    controls: {
      display: 'flex',
      flexWrap: 'wrap' as const,
      gap: '12px',
      justifyContent: 'center',
      marginTop: '25px'
    },
    btn: {
      padding: '12px 25px',
      borderRadius: '6px',
      border: 'none',
      fontWeight: '500',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      transition: 'all 0.3s ease',
      fontSize: '1rem'
    },
    btnPrimary: {
      background: '#3498db',
      color: 'white'
    },
    btnSuccess: {
      background: '#2ecc71',
      color: 'white'
    },
    btnDisabled: {
      background: '#95a5a6',
      cursor: 'not-allowed'
    },
    status: {
      padding: '15px',
      borderRadius: '8px',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '24px'
    },
    statusInfo: {
      background: '#d1ecf1',
      color: '#0c5460',
      borderLeft: '4px solid #3498db'
    },
    statusSuccess: {
      background: '#d4edda',
      color: '#155724',
      borderLeft: '4px solid #2ecc71'
    },
    statusError: {
      background: '#f8d7da',
      color: '#721c24',
      borderLeft: '4px solid #e74c3c'
    },
    statusWarning: {
      background: '#fff3cd',
      color: '#856404',
      borderLeft: '4px solid #f39c12'
    },
    progressContainer: {
      marginBottom: '24px'
    },
    progressBar: {
      height: '32px',
      background: '#e9ecef',
      borderRadius: '8px',
      overflow: 'hidden'
    },
    progressFill: {
      height: '100%',
      background: '#3498db',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontWeight: 'bold',
      fontSize: '14px',
      transition: 'width 0.3s ease'
    },
    resultsTitle: {
      fontSize: '1.4rem',
      marginBottom: '15px',
      color: '#2c3e50',
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    resultItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: '1px solid #eee'
    },
    resultLabel: {
      fontWeight: '500',
      color: '#34495e'
    },
    resultValue: {
      color: '#95a5a6',
      fontFamily: 'monospace',
      wordBreak: 'break-all' as const,
      textAlign: 'right' as const,
      maxWidth: '60%'
    },
    hashValue: {
      fontFamily: 'monospace',
      background: '#f8f9fa',
      padding: '5px 8px',
      borderRadius: '4px',
      fontSize: '0.85rem'
    },
    compressionRatio: {
      display: 'inline-block',
      padding: '3px 8px',
      borderRadius: '20px',
      fontSize: '0.85rem',
      fontWeight: '500'
    },
    ratioGood: {
      background: 'rgba(46, 204, 113, 0.15)',
      color: '#2ecc71'
    },
    ratioPoor: {
      background: 'rgba(231, 76, 60, 0.15)',
      color: '#e74c3c'
    },
    footer: {
      textAlign: 'center' as const,
      marginTop: '40px',
      color: '#95a5a6',
      fontSize: '0.9rem',
      padding: '20px'
    }
  };

  useEffect(() => {
    loadWasmModule();
  }, []);

  const loadWasmModule = async (): Promise<void> => {
    try {
      setStatus({ message: 'Loading WASM module...', type: 'loading' });
      
      const module = await import('./pkg/lz4_wasm_nodejs.js');
      const init: InitFunction = module.default;
      const { compress, decompress } = module;
      
      await init();
      
      setLz4Module({ compress, decompress });
      setWasmLoaded(true);
      setStatus({ message: 'WASM module loaded successfully!', type: 'success' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus({ message: `Failed to load WASM: ${errorMessage}`, type: 'error' });
      console.error('WASM loading error:', error);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const calculateHash = async (data: Uint8Array): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    
    if (file) {
      setSelectedFile(file);
      setStatus({ 
        message: `File selected: ${file.name} (${formatBytes(file.size)})`, 
        type: 'info' 
      });
      
      if (file.size > 500 * 1024 * 1024) {
        setStatus({ 
          message: 'Warning: File is larger than 500MB. This may take a while and could use significant memory.', 
          type: 'warning' 
        });
      }
    }
  };

  const addResult = (label: string, value: string | React.ReactNode): void => {
    setResults(prev => [...prev, { label, value }]);
  };

  const clearResults = (): void => {
    setResults([]);
  };

  const runTest = async (): Promise<void> => {
    if (!selectedFile || !lz4Module) {
      setStatus({ message: 'Please select a file first', type: 'error' });
      return;
    }

    setIsProcessing(true);
    clearResults();
    setCompressedData(null);
    setDecompressedData(null);

    try {
      setStatus({ message: 'Starting compression test...', type: 'info' });
      setProgress({ percent: 10, message: 'Reading file...' });

      const fileBuffer = await selectedFile.arrayBuffer();
      const originalData = new Uint8Array(fileBuffer);
      
      addResult('Original filename', selectedFile.name);
      addResult('Original size', formatBytes(originalData.length));
      
      setProgress({ percent: 20, message: 'Calculating original hash...' });
      const originalHash = await calculateHash(originalData);
      addResult('Original SHA-256', <span style={styles.hashValue}>{originalHash}</span>);

      setProgress({ percent: 30, message: 'Compressing...' });
      const compressStart = performance.now();
      const compressed = lz4Module.compress(originalData);
      const compressTime = performance.now() - compressStart;
      
      setProgress({ percent: 60, message: 'Compression complete!' });
      setCompressedData(compressed);
      
      addResult('Compressed size', formatBytes(compressed.length));
      const compressionRatio = ((1 - compressed.length / originalData.length) * 100).toFixed(2);
      const ratioStyle = parseFloat(compressionRatio) > 30 ? styles.ratioGood : styles.ratioPoor;
      addResult('Compression ratio', 
        <span style={{...styles.compressionRatio, ...ratioStyle}}>
          {compressionRatio}%
        </span>
      );
      addResult('Compression time', `${(compressTime / 1000).toFixed(2)} seconds`);
      addResult('Compression speed', `${formatBytes(originalData.length / (compressTime / 1000))}/s`);

      setProgress({ percent: 70, message: 'Decompressing...' });
      const decompressStart = performance.now();
      const decompressed = lz4Module.decompress(compressed);
      const decompressTime = performance.now() - decompressStart;
      
      setProgress({ percent: 90, message: 'Decompression complete!' });
      setDecompressedData(decompressed);
      
      addResult('Decompressed size', formatBytes(decompressed.length));
      addResult('Decompression time', `${(decompressTime / 1000).toFixed(2)} seconds`);
      addResult('Decompression speed', `${formatBytes(decompressed.length / (decompressTime / 1000))}/s`);

      setProgress({ percent: 95, message: 'Verifying integrity...' });
      const decompressedHash = await calculateHash(decompressed);
      addResult('Decompressed SHA-256', <span style={styles.hashValue}>{decompressedHash}</span>);

      setProgress({ percent: 100, message: 'Complete!' });

      if (originalHash === decompressedHash && originalData.length === decompressed.length) {
        setStatus({ 
          message: 'SUCCESS! File compressed and decompressed correctly. Hashes match perfectly!', 
          type: 'success' 
        });
      } else {
        setStatus({ 
          message: 'FAILURE! Data integrity check failed. Hashes do not match!', 
          type: 'error' 
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus({ message: `Error during test: ${errorMessage}`, type: 'error' });
      console.error('Test error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = (data: Uint8Array, filename: string): void => {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ message: `${filename} downloaded successfully`, type: 'success' });
  };

  const getStatusStyle = (type: StatusType) => {
    const baseStyle = styles.status;
    switch (type) {
      case 'success': return { ...baseStyle, ...styles.statusSuccess };
      case 'error': return { ...baseStyle, ...styles.statusError };
      case 'warning': return { ...baseStyle, ...styles.statusWarning };
      default: return { ...baseStyle, ...styles.statusInfo };
    }
  };

  const getStatusIcon = (type: StatusType): string => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'warning': return '⚠';
      case 'loading': return '⟳';
      default: return 'ℹ';
    }
  };

  return (
    <div style={styles.container}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <header style={styles.header}>
          <h1 style={styles.title}>LZ4 File Compression Tool</h1>
          <p style={styles.subtitle}>High-performance compression and decompression using WebAssembly</p>
        </header>

        <main>
          <div style={styles.card}>
            <div style={styles.uploadSection}>
              <div style={styles.uploadIcon}></div>
              <h3 style={styles.uploadTitle}>Select File for Compression</h3>
              <p style={styles.uploadDescription}>Upload any file to test LZ4 compression (recommended: up to 500MB)</p>
              
              <div style={styles.fileInputWrapper}>
                <div style={styles.fileInputButton}>
                  Choose File
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  style={styles.fileInput}
                  accept="*/*"
                />
              </div>
              
              <div style={styles.fileName}>
                {selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : 'No file selected'}
              </div>
              
              <div style={styles.controls}>
                <button
                  onClick={runTest}
                  disabled={!selectedFile || !wasmLoaded || isProcessing}
                  style={{
                    ...styles.btn,
                    ...styles.btnPrimary,
                    ...(!selectedFile || !wasmLoaded || isProcessing ? styles.btnDisabled : {})
                  }}
                >
                  {isProcessing ? 'Processing...' : 'Run Compression Test'}
                </button>
                
                <button
                  onClick={() => compressedData && selectedFile && downloadFile(compressedData, `${selectedFile.name}.lz4`)}
                  disabled={!compressedData}
                  style={{
                    ...styles.btn,
                    ...styles.btnSuccess,
                    ...(!compressedData ? styles.btnDisabled : {})
                  }}
                >
                  Download Compressed
                </button>
                
                <button
                  onClick={() => decompressedData && selectedFile && downloadFile(decompressedData, `${selectedFile.name}.decompressed`)}
                  disabled={!decompressedData}
                  style={{
                    ...styles.btn,
                    ...styles.btnSuccess,
                    ...(!decompressedData ? styles.btnDisabled : {})
                  }}
                >
                  Download Decompressed
                </button>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            {status.message && (
              <div style={getStatusStyle(status.type)}>
                <span>{getStatusIcon(status.type)}</span>
                <span>{status.message}</span>
              </div>
            )}
            
            {progress && (
              <div style={styles.progressContainer}>
                <div style={styles.progressBar}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${progress.percent}%`
                    }}
                  >
                    {Math.round(progress.percent)}% - {progress.message}
                  </div>
                </div>
              </div>
            )}
            
            {results.length > 0 && (
              <div>
                <h3 style={styles.resultsTitle}>Compression Results</h3>
                {results.map((result, index) => (
                  <div key={index} style={styles.resultItem}>
                    <div style={styles.resultLabel}>{result.label}</div>
                    <div style={styles.resultValue}>{result.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        <footer style={styles.footer}>
          <p>LZ4 WebAssembly Compression Tool | High Performance File Compression</p>
        </footer>
      </div>
    </div>
  );
};

export default LZ4CompressionTest;