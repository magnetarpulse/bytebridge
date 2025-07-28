/**
 * @file Upload.tsx
 * @description This file contains the main React component for the client-side
 * file encryption and upload tool. It manages the user interface, state, and
 * logic for a multi-step process, coordinating with Web Workers for heavy lifting.
 */

// --- React and UI Imports ---
import React, { useState, useCallback, useRef } from 'react';
import {
  Box, Button, Card, CardContent, Container, Divider, IconButton,
  Paper, Typography, Tooltip, LinearProgress, Alert, AlertTitle, Snackbar, Fade,
  FormControlLabel, List, ListItem, ListItemText, ListItemIcon, Checkbox,
  Stepper, Step, StepLabel, Stack, RadioGroup, Radio, Chip,
} from '@mui/material';
import {
  CloudUpload, Lock, FileCopy, CheckCircle, Delete, UploadFile, Refresh,
  InsertDriveFile, FolderZip, Download, Visibility, VisibilityOff, Fingerprint, HelpOutline,
  Storage, Security, Language,
} from '@mui/icons-material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { useDropzone } from 'react-dropzone';
import { styled } from '@mui/system';
import Switch from '@mui/material/Switch';
import SpeedIcon from '@mui/icons-material/Speed';

// --- Type and Worker Imports ---
import { type CompressionLevel } from '../../types';
import EncryptionWorker from '../../lib/encryption.worker.ts?worker';
import EncryptionStreamingWorker from '../../lib/encryption.streaming.worker.ts?worker';

// --- Styled Components for Consistent UI ---

/** A styled Paper component for the file dropzone area. */
const StyledDropzone = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'isDragActive',
})<{ isDragActive: boolean }>(({ theme, isDragActive }) => ({
  border: `2px dashed ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(6, 4),
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'all 0.3s ease-in-out',
  backgroundColor: isDragActive ? theme.palette.action.hover : 'transparent',
  borderColor: isDragActive ? theme.palette.primary.main : theme.palette.divider,
  '&:hover': {
    borderColor: theme.palette.primary.main,
  },
}));

/** A styled Box for displaying sensitive key information with a monospace font. */
const KeyDisplay = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(1.5, 2),
  position: 'relative',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}));

/** A styled Alert for critical user warnings, such as saving keys. */
const WarningAlert = styled(Alert)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 193, 7, 0.1)',
  color: theme.palette.mode === 'dark' ? theme.palette.warning.light : theme.palette.warning.dark,
  border: `1px solid ${theme.palette.mode === 'dark' ? theme.palette.warning.dark : theme.palette.warning.light}`,
  borderRadius: theme.shape.borderRadius,
}));

/** A styled Card for selectable server options ("ByteBridges"). */
const ByteBridgeCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  border: `2px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  cursor: 'pointer',
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    borderColor: theme.palette.primary.main,
    boxShadow: (theme.shadows as string[])?.[4],
  },
  '&.selected': {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.08)' : 'rgba(25, 118, 210, 0.04)',
  },
}));

// --- Component Prop and State Interfaces ---

interface KeyFieldProps {
  label: string;
  value: string;
}

interface FileItem {
  file: File;
  relativePath: string;
}

interface KeyData {
  secretKey: string;
  nonce: string;
  keyFingerprint: string;
}

interface ByteBridge {
  id: string;
  name: string;
  location: string;
  capacity: string;
  reflection: string;
  HippaCompliant: string;
  status: 'online' | 'busy' | 'maintenance';
}

/**
 * @component FileEncryptionTool
 * @description The main functional component that orchestrates the entire file
 * encryption and upload process. It manages the UI state for a multi-step wizard,
 * handles user interactions, and communicates with Web Workers to perform
 * CPU-intensive tasks without blocking the UI thread.
 */
const FileEncryptionTool: React.FC = () => {
  // --- State Management ---
  const [activeStep, setActiveStep] = useState(0);                               // Tracks the current step in the wizard
  const [selectedByteBridge, setSelectedByteBridge] = useState<string>('');      // ID of the chosen server
  const [file, setFile] = useState<File | null>(null);                           // The single file selected by the user
  const [fileItems, setFileItems] = useState<FileItem[]>([]);                    // A list of files if a folder is selected
  const [isFolder, setIsFolder] = useState(false);                               // Flag to indicate if the selection is a folder
  const [isProcessing, setIsProcessing] = useState(false);                       // Controls the display of loading indicators
  const [progress, setProgress] = useState({ value: 0, text: '' });              // Progress bar state for worker operations
  const [keys, setKeys] = useState<KeyData | null>(null);                        // Holds the generated encryption keys
  const [processedData, setProcessedData] = useState<Uint8Array | null>(null);   // Stores the encrypted data (or just the header for streaming)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);               // UI feedback for copy-to-clipboard
  const [compressFile, setCompressFile] = useState(true);                        // User option for compression
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>(6); // Compression level (1-9)
  const [hasSavedKey, setHasSavedKey] = useState(false);                         // User has downloaded or copied the key
  const [hasAcknowledgedKey, setHasAcknowledgedKey] = useState(false);           // User has checked the acknowledgement box
  const [useWebTransport, setUseWebTransport] = useState<boolean>(true);         // User preference for WebTransport vs. HTTP/1.1
  const [transportMethod, setTransportMethod] = useState<string | null>(null);   // The transport method selected by the user, if applicable

  // --- Refs ---
  const workerRef = useRef<Worker | null>(null);                                 // Holds a reference to the active Web Worker instance
  const fileInputRef = useRef<HTMLInputElement>(null);                           // Ref to the hidden file input for folder selection

  /** The file size threshold (20MB) to switch from one-shot to streaming upload. */
  const STREAMING_THRESHOLD = 20 * 1024 * 1024;

  // --- Data and Logic ---

  /** Simulated data for available ByteBridge servers. */
  const byteBridges: ByteBridge[] = [
    {
      id: 'bb-Huy',
      name: 'ByteBridge Huy',
      location: 'DePaul University, IL',
      capacity: '10.2 TB Available',
      reflection: 'Reflection: True',
      HippaCompliant: 'HIPPA Complaint: True',
      status: 'online'
    },
    {
      id: 'bb-Charmi',
      name: 'ByteBridge Charmi',
      location: 'Illinois Institute of Technology, IL',
      capacity: '8.7 TB Available',
      reflection: 'Reflection: True',
      HippaCompliant: 'HIPPA Complaint: True',
      status: 'online'
    },
    {
      id: 'bb-Nandhini',
      name: 'ByteBridge Nandhini',
      location: 'University of Illinois Chicago, IL',
      capacity: '12.1 TB Available',
      reflection: 'Reflection: True',
      HippaCompliant: 'HIPPA Complaint: False',
      status: 'busy'
    }
  ];

  /**
   * Creates a simple, uncompressed archive from a list of files.
   * This is used to bundle a folder into a single `File` object for processing.
   * The format is: [manifest_length (4 bytes) | manifest (JSON) | file1_length (4 bytes) | file1_data | ...]
   * @param {FileItem[]} files - The list of files to archive.
   * @returns {Promise<File>} A promise that resolves to a single `File` object representing the archive.
   */
  const createArchiveFromFiles = async (files: FileItem[]): Promise<File> => {
    const chunks: Uint8Array[] = [];
    const manifest = {
      version: '1.0',
      files: files.map(item => ({
        path: item.relativePath,
        size: item.file.size,
        lastModified: item.file.lastModified
      }))
    };
    const manifestStr = JSON.stringify(manifest);
    const manifestBytes = new TextEncoder().encode(manifestStr);
    const manifestHeader = new Uint8Array(4);
    const view = new DataView(manifestHeader.buffer);
    view.setUint32(0, manifestBytes.length, true);
    chunks.push(manifestHeader);
    chunks.push(manifestBytes);
    for (const item of files) {
      const fileData = new Uint8Array(await item.file.arrayBuffer());
      const fileHeader = new Uint8Array(4);
      const fileView = new DataView(fileHeader.buffer);
      fileView.setUint32(0, fileData.length, true);
      chunks.push(fileHeader);
      chunks.push(fileData);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    const archiveName = files.length === 1 ? files[0].file.name : 'folder-archive';
    return new File([result], `${archiveName}.archive`, { type: 'application/octet-stream' });
  };

  /**
   * Processes a `FileList` (from a folder input) into an array of `FileItem` objects,
   * preserving the relative path of each file.
   * @param {FileList} files - The list of files from an input element.
   * @returns {FileItem[]} An array of structured file items.
   */
  const processFileList = (files: FileList): FileItem[] => {
    const items: FileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = (file as any).webkitRelativePath || file.name;
      items.push({ file, relativePath });
    }
    return items;
  };

  /**
   * Callback for the `useDropzone` hook. Handles files dropped onto the dropzone.
   * Differentiates between single file and multiple file drops.
   */
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      if (acceptedFiles.length === 1) {
        setFile(acceptedFiles[0]);
        setFileItems([]);
        setIsFolder(false);
      } else {
        const items = acceptedFiles.map(file => ({
          file,
          relativePath: file.name
        }));
        setFileItems(items);
        setFile(null);
        setIsFolder(true);
      }
      setKeys(null);
      setProcessedData(null);
      setProgress({ value: 0, text: '' });
    }
  }, []);

  /** `useDropzone` hook setup. */
  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true
  });

  /**
   * Event handler for the hidden folder selection input.
   */
  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const items = processFileList(files);
      setFileItems(items);
      setFile(null);
      setIsFolder(true);
      setKeys(null);
      setProcessedData(null);
      setProgress({ value: 0, text: '' });
    }
  };
  
  /**
   * Formats a file size in bytes into a human-readable string (KB, MB, GB).
   * @param {number} bytes - The size in bytes.
   * @returns {string} The formatted size string.
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  /**
   * Calculates the total size of the selected file or files.
   * @returns {number} The total size in bytes.
   */
  const getTotalSize = (): number => {
    if (isFolder) {
      return fileItems.reduce((total, item) => total + item.file.size, 0);
    }
    return file?.size || 0;
  };

  /**
   * Safely terminates the current Web Worker and clears the ref.
   * This is crucial for cleanup to prevent memory leaks.
   */
  const cleanupWorker = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  };
  
  /**
   * Main entry point for processing. Called when the user clicks "Encrypt File".
   * It determines whether to use the one-shot worker or the streaming worker
   * based on the file size.
   */
  const handleStartProcessing = async () => {
      // Step 1: Prepare the file to be processed (archive if it's a folder)
      if (!file && fileItems.length === 0) return;
      setActiveStep(2);
      let fileToProcess: File;
      if (isFolder) {
        setProgress({ value: 5, text: 'Creating archive...' });
        fileToProcess = await createArchiveFromFiles(fileItems);
      } else {
        fileToProcess = file!;
      }

      // Step 2: Decide which worker to use based on the size threshold
      if (fileToProcess.size < STREAMING_THRESHOLD) {
        // For small files, use the one-shot worker which processes the entire file in memory.
        handleProcessFileInWorker(fileToProcess);
      } else {
        // For large files, use the streaming worker which only generates keys and a header initially.
        handleGenerateStreamingKeys();
      }
  };

  /**
   * Handles the one-shot encryption process for small files.
   * It creates `EncryptionWorker`, sends the file, and waits for the complete
   * encrypted data blob in return.
   * @param {File} fileToProcess - The file to be encrypted.
   */
  const handleProcessFileInWorker = (fileToProcess: File) => {
    if (!fileToProcess) return;
    setIsProcessing(true);
    setProgress({ value: 0, text: 'Generating secure key...' });
    const worker = new EncryptionWorker();
    workerRef.current = worker;

    // Generate fingerprint and set temporary UI state
    const keyFingerprint = crypto.randomUUID().substring(0, 13);
    setKeys({ secretKey: 'Generating...', nonce: 'Generating...', keyFingerprint });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'progress') {
        setProgress(payload);
      } else if (type === 'success') {
        setProcessedData(payload.processedData);
        // Update the state with the actual keys from the worker, keeping the fingerprint
        setKeys(prev => ({
          ...prev!,
          secretKey: payload.keys.secretKey,
          nonce: payload.keys.nonce,
        }));
        setIsProcessing(false);
        cleanupWorker();
      } else if (type === 'error') {
        setSnackbar({ open: true, message: `Processing failed: ${payload}`, severity: 'error' });
        setIsProcessing(false);
        cleanupWorker();
      }
    };
    worker.onerror = (err) => {
      setSnackbar({ open: true, message: `A critical worker error occurred: ${err.message}`, severity: 'error' });
      setIsProcessing(false);
      cleanupWorker();
    };

    // Pass the fingerprint to the worker
    worker.postMessage({ file: fileToProcess, keyFingerprint, options: { compress: compressFile, compressionLevel } });
  };

  /**
   * Handles the initialization phase for large files streaming.
   * It creates `EncryptionStreamingWorker` and sends an `init` command.
   * The worker returns the keys and the stream header, which are stored in state.
   * The actual file data is not processed at this stage.
   */
  const handleGenerateStreamingKeys = () => {
    setIsProcessing(true);
    setProgress({ value: 0, text: 'Generating secure keys for your data...' });

    const worker = new EncryptionStreamingWorker();
    workerRef.current = worker;

    // This listener handles all messages from the worker.
    worker.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'ready') {
        const keyFingerprint = crypto.randomUUID().substring(0, 13);
        setKeys({ secretKey: 'Generating...', nonce: 'Generating...', keyFingerprint });
        
        worker.postMessage({
          type: 'init',
          payload: {
            compressionLevel,
            keyFingerprint,
            useWebTransport
          }
        });

      } else if (type === 'init-success') {
        setKeys({
          secretKey: payload.hexKey,
          nonce: payload.base64Nonce,
          keyFingerprint: payload.keyFingerprint,
        });
        
        setProcessedData(payload.header);
        setTransportMethod(payload.transportMethod);
        setIsProcessing(false);
        setProgress({ value: 100, text: 'Keys generated. Ready for upload.' });

      } else if (type === 'error') {
        console.error("[FileEncryptionTool] Received 'error' message from worker:", payload);
        setSnackbar({ open: true, message: `Key generation failed: ${payload}`, severity: 'error' });
        setIsProcessing(false);
        cleanupWorker();
      }
    };

    // This listener catches critical, unhandled errors in the worker script itself.
    worker.onerror = (error) => {
      console.error("[FileEncryptionTool] A critical, unhandled worker error occurred:", error);
      setSnackbar({ open: true, message: `A critical worker error occurred: ${error.message}`, severity: 'error' });
      setIsProcessing(false);
      cleanupWorker();
    };
  };

  /**
   * Performs the streaming upload. This is called *after* `handleGenerateStreamingKeys` is complete.
   * It first gets an `uploadId` from the server, then sends a `start-streaming-upload`
   * command to the worker, which then handles the chunk-by-chunk upload process.
   */
  const handlePerformStreamingUpload = async () => {
    // Ensure we have everything we need before starting.
    const fileToProcess = isFolder ? await createArchiveFromFiles(fileItems) : file;
    if (!fileToProcess || !workerRef.current || !processedData) {
      setSnackbar({ open: true, message: 'Cannot start upload: file or worker state is missing.', severity: 'error' });
      return;
    }
    
    setIsProcessing(true);
    setProgress({ value: 0, text: 'Initializing upload...' });

    try {
      const initResponse = await fetch('https://129.114.108.18:8000/api/v1/upload/initialize/', { method: 'POST' });
      if (!initResponse.ok) throw new Error('Server failed to initialize upload.');
      const { uploadId } = await initResponse.json();
      if (!uploadId) throw new Error('Failed to retrieve uploadId from server.');

      const worker = workerRef.current;
      
      worker.onmessage = async (event) => {
          const { type, payload } = event.data;
          if (type === 'chunk-upload-progress') {
              // This message contains progress updates for the current chunk upload.
              // It includes the number of bytes processed and the total bytes expected.
              const { processedBytes, totalBytes } = payload;

              // Update transport method if it changed (e.g., fallback from WebTransport to HTTP)
              if (transportMethod && transportMethod !== transportMethod) {
                  setTransportMethod(transportMethod);
              }
              
              // Prevent division by zero and cap progress at 100.
              const progressValue = totalBytes > 0 ? Math.min((processedBytes / totalBytes) * 100, 100) : 0;
              const progressText = `Uploading... ${formatFileSize(processedBytes)} of ${formatFileSize(totalBytes)}`;
              
              setProgress({ value: progressValue, text: progressText });

          } else if (type === 'all-chunks-sent') {
              setProgress({ value: 100, text: 'Finalizing upload...' });
              const finalFilename = `${fileToProcess.name || 'file'}.gz.enc`;
              const completeResponse = await fetch('https://129.114.108.18:8000/api/v1/upload/complete/', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ uploadId, filename: finalFilename }),
              });
              if (!completeResponse.ok) throw new Error('Failed to finalize upload.');
              
              setSnackbar({ open: true, message: 'Your data is uploaded successfully!', severity: 'success' });
              setActiveStep(3);
              cleanupWorker();
              setIsProcessing(false);
          } else if (type === 'error') {
              throw new Error(payload);
          }
      };
      
      // 2. Safely call the worker now that we've checked our variables.
      console.debug(`[Upload] Sending file to worker: size=${fileToProcess.size}, name=${fileToProcess.name}, type=${fileToProcess.type}`);
      
      // Clone approach depends on file size
      let fileToSend;
      
      // For files over 50MB, don't try to clone the entire file at once
      if (fileToProcess.size > 50 * 1024 * 1024) {
        console.debug(`[Upload] Large file detected (${Math.round(fileToProcess.size/1024/1024)} MB). Using direct file transfer.`);
        // For large files, we'll pass the original file and let the worker handle it in chunks
        fileToSend = fileToProcess;
      } else {
        // For smaller files, create a fresh copy to avoid detached file issues
        console.debug(`[Upload] Small file detected. Creating fresh file object.`);
        try {
          const fileBuffer = await fileToProcess.arrayBuffer();
          fileToSend = new File(
            [fileBuffer], 
            fileToProcess.name, 
            { 
              type: fileToProcess.type || 'application/octet-stream', // Provide default type if missing
              lastModified: fileToProcess.lastModified 
            }
          );
          console.debug(`[Upload] Created fresh file object: size=${fileToSend.size}, name=${fileToSend.name}`);
        } catch (error) {
          console.error(`[Upload] Failed to create fresh file:`, error);
          // Fall back to original file if cloning fails
          console.debug(`[Upload] Falling back to original file object`);
          fileToSend = fileToProcess;
        }
      }
      
      worker.postMessage({ 
          type: 'start-streaming-upload', 
          payload: { 
              file: fileToSend, 
              uploadId,
              header: processedData, // This is now guaranteed to be a Uint8Array
          } 
      });

    } catch (error) {
        setSnackbar({ open: true, message: `Upload failed: ${(error as Error).message}`, severity: 'error' });
        setIsProcessing(false);
    }
  };

  /**
   * Performs the simple, one-shot upload for small files.
   * This is called after `handleProcessFileInWorker` is complete.
   * It takes the complete encrypted data blob and sends it to the server in a single request.
   */
  const handleSimpleUpload = async () => {
    if (!processedData) return;

    setIsProcessing(true);
    setProgress({ value: 0, text: 'Uploading encrypted file...' });

    try {
      const formData = new FormData();
      const fileName = isFolder ? 'folder-archive' : (file?.name || 'file');

      // It takes the encrypted Uint8Array, turns it into a Blob, and gives it a
      // descriptive filename. This is exactly what the server endpoint expects.
      formData.append('file', new Blob([processedData]), `${fileName}.gz.enc`);

      const response = await fetch('https://129.114.108.18:8000/api/v1/upload/', {
        method: 'POST',
        body: formData,
        // The browser automatically sets the Content-Type to multipart/form-data
        // with the correct boundary, so we don't specify it here.
      });

      if (!response.ok) {
        const errorData = await response.json(); // Get the JSON error from Django
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log('Server response:', result); // For debugging

      setSnackbar({ open: true, message: 'Encrypted file uploaded successfully!', severity: 'success' });
      setActiveStep(3); // Move to the 'Complete' step

    } catch (error) {
      setSnackbar({ open: true, message: `Upload failed: ${(error as Error).message}`, severity: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Creates and triggers the download of a `.bbkey` JSON file containing the
   * user's recovery key information.
   */
  const handleDownloadKey = () => {
    if (!keys) return;
    const keyFileData = {
      "//": "ByteBridge Recovery Key. Store this file securely. It is required to decrypt your data.",
      "keyFingerprint": keys.keyFingerprint,
      "secretKey": keys.secretKey,
      "nonce": keys.nonce,
    };
    const fileContent = JSON.stringify(keyFileData, null, 2);
    const blob = new Blob([fileContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bytebridge-recovery-key-${keys.keyFingerprint}.bbkey`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setHasSavedKey(true);
    setSnackbar({ open: true, message: 'Recovery key file downloading...', severity: 'success' });
  };
  
  /**
   * Resets the component's state to its initial values, allowing the user to
   * start a new upload.
   * @param {boolean} [fullReset=true] - If true, resets to the very first step.
   */
  const handleReset = (fullReset = true) => {
    cleanupWorker();
    if (fullReset) {
      setActiveStep(0);
      setSelectedByteBridge('');
    }
    setFile(null);
    setFileItems([]);
    setIsFolder(false);
    setKeys(null);
    setProcessedData(null); 
    setCopiedKey(null);
    setHasSavedKey(false);
    setHasAcknowledgedKey(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Copies a given text string to the user's clipboard and provides UI feedback.
   * @param {string} text - The text to copy.
   * @param {string} keyType - The type of key being copied (for UI feedback).
   */
  const copyToClipboard = (text: string, keyType: string) => {
      navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(keyType);
      setHasSavedKey(true);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  /**
   * Determines the MUI color for a server status chip.
   * @param {string} status - The status string ('online', 'busy', etc.).
   * @returns {'success' | 'warning' | 'error' | 'default'} The corresponding color.
   */
  const getStatusColor = (status: string) => {
      switch (status) {
      case 'online': return 'success';
      case 'busy': return 'warning';
      case 'maintenance': return 'error';
      default: return 'default';
    }
  };

  /**
   * A sub-component for displaying a single sensitive key field with
   * show/hide and copy functionality.
   * @param {KeyFieldProps} props - The label and value for the key.
   */
  const KeyField: React.FC<KeyFieldProps> = ({ label, value }) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const maskedValue = value.includes('...') ? value : value && value.length > 12 ? `${value.substring(0, 6)}...${value.substring(value.length - 6)}` : '***';
    return (
      <Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 'bold' }}>{label}</Typography>
        <KeyDisplay>
          <Typography variant="body2" sx={{ mr: 2 }}>{isRevealed ? value : maskedValue}</Typography>
          <Box>
            <Tooltip title={isRevealed ? 'Hide' : 'Show'}><IconButton size="small" onClick={() => setIsRevealed(!isRevealed)}>{isRevealed ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></Tooltip>
            <Tooltip title={copiedKey === label ? 'Copied!' : 'Copy'}><IconButton size="small" onClick={() => copyToClipboard(value, label)}>{copiedKey === label ? <CheckCircle fontSize="small" color="success" /> : <FileCopy fontSize="small" />}</IconButton></Tooltip>
          </Box>
        </KeyDisplay>
      </Box>
    );
  };

  const WebTransportToggle = () => (
    <Tooltip title="Use WebTransport protocol for faster transfers when available">
        <FormControlLabel
            control={
                <Switch
                    checked={useWebTransport}
                    onChange={(e) => setUseWebTransport(e.target.checked)}
                    color="primary"
                />
            }
            label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <SpeedIcon fontSize="small" />
                    <Typography variant="body2">
                        Use WebTransport
                        {transportMethod && (
                            <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.7 }}>
                                (Currently: {transportMethod})
                            </Typography>
                        )}
                    </Typography>
                </Box>
            }
        />
    </Tooltip>
);
  
  // --- Render Logic ---
  const isUploadReady = hasSavedKey && hasAcknowledgedKey;
  const steps = ['Select ByteBridge', 'Select File', 'Secure & Save Key', 'Complete'];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Card elevation={3} sx={{ borderRadius: 4, p: { xs: 2, sm: 3, md: 4 } }}>
        <CardContent>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, textAlign: 'center' }}>
            Upload and Encrypt Your Data To ByteBridge
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', mt: 1, mb: 4 }}>
            A step-by-step process to securely encrypt and upload your data to ByteBridge.
          </Typography>

          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
            {steps.map((label) => ( <Step key={label}><StepLabel>{label}</StepLabel></Step> ))}
          </Stepper>

          <Box sx={{ minHeight: 350, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {activeStep === 0 && (
              <Fade in={true}>
                <Box>
                  <Typography variant="h6" sx={{ mb: 3, textAlign: 'center' }}>Choose a ByteBridge Server</Typography>
                  <RadioGroup
                    value={selectedByteBridge}
                    onChange={(e) => setSelectedByteBridge(e.target.value)}
                  >
                    <Stack spacing={2}>
                      {byteBridges.map((bridge) => (
                        <ByteBridgeCard
                          key={bridge.id}
                          className={selectedByteBridge === bridge.id ? 'selected' : ''}
                          onClick={() => setSelectedByteBridge(bridge.id)}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Radio value={bridge.id} sx={{ alignSelf: 'flex-start' }} />
                            <Storage color="primary" sx={{ fontSize: 40 }} />
                            <Box sx={{ flexGrow: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography variant="h6" sx={{ fontWeight: 600 }}>{bridge.name}</Typography>
                                <Chip label={bridge.status} size="small" color={getStatusColor(bridge.status)} variant="outlined" />
                              </Box>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                <Language sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                                {bridge.location}
                              </Typography>
                              <Stack direction="row" spacing={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Storage sx={{ fontSize: 16 }} />
                                  <Typography variant="caption">{bridge.capacity}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <AssessmentIcon sx={{ fontSize: 16 }} />
                                  <Typography variant="caption">{bridge.reflection}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Security sx={{ fontSize: 16 }} />
                                  <Typography variant="caption">{bridge.HippaCompliant}</Typography>
                                </Box>
                              </Stack>
                            </Box>
                          </Box>
                        </ByteBridgeCard>
                      ))}
                    </Stack>
                  </RadioGroup>
                </Box>
              </Fade>
            )}

            {activeStep === 1 && (
              <Box {...getRootProps()} sx={{ textAlign: 'center' }}>
                <input {...getInputProps()} />
                <Fade in={!file && fileItems.length === 0} unmountOnExit>
                  <Box>
                    <StyledDropzone isDragActive={isDragActive}>
                      <CloudUpload sx={{ fontSize: 60, color: 'primary.main', mb: 2, opacity: 0.8 }} />
                      <Typography variant="h6">Drag & drop files or a folder here</Typography>
                      <Typography color="text.secondary" sx={{ mt: 1 }}>or</Typography>
                      <Stack direction="row" spacing={2} justifyContent="center" sx={{mt: 2}}>
                        <Button variant="contained" onClick={(e) => { e.stopPropagation(); openFileDialog(); }}>Select Files</Button>
                        <Button variant="outlined" component="label">
                           Select Folder
                           <input type="file" ref={fileInputRef} hidden {...({webkitdirectory: "", directory: ""} as any)} multiple onChange={handleFolderSelect} />
                        </Button>
                      </Stack>
                    </StyledDropzone>
                  </Box>
                </Fade>
                <Fade in={!!file || fileItems.length > 0}>
                  <Box sx={{ mt: 3, mx: 'auto', maxWidth: { xs: '100%', md: '80%' } }}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'left' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {isFolder ? <FolderZip color="primary" /> : <UploadFile color="primary" />}
                        <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                          <Typography variant="body1" sx={{ fontWeight: '500' }} noWrap>{isFolder ? `${fileItems.length} files in folder` : file?.name}</Typography>
                          <Typography variant="body2" color="text.secondary">{formatFileSize(getTotalSize())}</Typography>
                        </Box>
                        <IconButton onClick={(e) => { e.stopPropagation(); handleReset(false); }}><Delete /></IconButton>
                      </Box>
                       {isFolder && fileItems.length > 0 && (
                        <Box sx={{ mt: 2, maxHeight: 150, overflow: 'auto' }}>
                          <List dense>
                            {fileItems.slice(0, 5).map((item, index) => (
                              <ListItem key={index} sx={{ py: 0.5 }}><ListItemIcon sx={{ minWidth: 32 }}><InsertDriveFile fontSize="small" /></ListItemIcon><ListItemText primary={item.relativePath} secondary={formatFileSize(item.file.size)} primaryTypographyProps={{ variant: 'body2', noWrap: true }} secondaryTypographyProps={{ variant: 'caption' }} /></ListItem>
                            ))}
                            {fileItems.length > 5 && <ListItem><ListItemText primary={`... and ${fileItems.length - 5} more files`} primaryTypographyProps={{ variant: 'body2', fontStyle: 'italic' }} /></ListItem>}
                          </List>
                        </Box>
                      )}
                    </Paper>
                  </Box>
                </Fade>
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                  <WebTransportToggle />
                </Box>
              </Box>
            )}

            {activeStep === 2 && (
              <Fade in={true}>
                <Box>
                  <WarningAlert icon={<Lock />} sx={{ mb: 3 }}>
                    <AlertTitle sx={{ fontWeight: 'bold' }}>Your data is encrypted. Save your key!</AlertTitle>
                    You <strong>must</strong> save this recovery key before proceeding. It cannot be recovered if lost.
                  </WarningAlert>
                  <Stack spacing={2.5}>
                    <KeyField label="Secret Recovery Key" value={keys?.secretKey || ''} />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 'bold' }}>Key Fingerprint</Typography>
                      <KeyDisplay>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Fingerprint color="action" /><Typography variant="body2">{keys?.keyFingerprint}</Typography></Box>
                        <Tooltip title="This public ID helps you match the key to its file."><IconButton size="small"><HelpOutline fontSize="small" /></IconButton></Tooltip>
                      </KeyDisplay>
                    </Box>
                    <FormControlLabel
                      control={<Checkbox checked={hasAcknowledgedKey} onChange={(e) => setHasAcknowledgedKey(e.target.checked)} />}
                      label="I understand that I am solely responsible for my recovery key."
                    />
                  </Stack>
                </Box>
              </Fade>
            )}
            
            {activeStep === 3 && (
              <Fade in={true}>
                <Box sx={{ textAlign: 'center' }}>
                  <CheckCircle color="success" sx={{ fontSize: 80, mb: 2 }} />
                  <Typography variant="h5" sx={{ fontWeight: 500 }}>Upload Complete</Typography>
                  <Typography color="text.secondary">Your data has been securely uploaded and verified.</Typography>
                </Box>
              </Fade>
            )}
          </Box>
          
          {isProcessing && (
            <Box sx={{ mt: 2, mb: -2, height: '3em' }}>
              <LinearProgress variant="determinate" value={progress.value} />
              <Typography variant="caption" display="block" sx={{ textAlign: 'center', mt: 1 }}>{progress.text}</Typography>
            </Box>
          )}

          <Divider sx={{ my: 4 }} />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
               {activeStep > 0 && activeStep < 3 && !isProcessing && (
                 <Button onClick={() => setActiveStep(prev => prev - 1)}>Back</Button>
               )}
            </Box>
            <Stack direction="row" justifyContent="flex-end" spacing={2}>
              {activeStep === 0 && <Button variant="contained" size="large" onClick={() => setActiveStep(1)} disabled={!selectedByteBridge}>Next: Select File</Button>}
              {activeStep === 1 && <Button variant="contained" size="large" onClick={handleStartProcessing} disabled={(!file && fileItems.length === 0) || isProcessing}>Next: Encrypt File</Button>}
              
              {/* Corrected logic for Step 2 buttons */}
              {activeStep === 2 && (
                <>
                  <Button variant="outlined" size="large" startIcon={<Download />} onClick={handleDownloadKey} disabled={!keys || isProcessing}>Download Key File</Button>
                  
                  {/* This button now appears once either simple or streaming pre-processing is done */}
                  { (processedData) && (
                    <Tooltip title={!isUploadReady ? "Please save your key and check the box to continue" : ""}>
                      {/* The <span> is crucial for the tooltip to work when the button is disabled */}
                      <span>
                        <Button
                          variant="contained"
                          color="success"
                          size="large"
                          startIcon={<CloudUpload />}
                          onClick={() => {
                            // This logic correctly chooses which upload function to run
                            if (getTotalSize() < STREAMING_THRESHOLD) {
                              handleSimpleUpload(); 
                            } else {
                              handlePerformStreamingUpload();
                            }
                          }}
                          disabled={!isUploadReady || isProcessing}
                        >
                          Upload Now
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </>
              )}

              {activeStep === 3 && <Button variant="contained" size="large" startIcon={<Refresh />} onClick={() => handleReset(true)}>Upload Another File</Button>}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      
      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default FileEncryptionTool;