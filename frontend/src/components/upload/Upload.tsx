/**
 * @file Upload.tsx
 * @description Refactored UI/UX for professional appearance with a dedicated Terms of Service step.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';

import {
  Box, Button, Card, CardContent, Container, Divider, IconButton,
  Paper, Typography, Tooltip, LinearProgress, Alert, AlertTitle, Snackbar, Fade,
  FormControlLabel, List, ListItem, ListItemText, ListItemIcon, Checkbox,
  Stepper, Step, StepLabel, Stack, RadioGroup, Radio, Chip, Switch, CloudUpload, 
  Lock, FileCopy, CheckCircle, Delete, UploadFile, Refresh,
  InsertDriveFile, FolderZip, Download, Visibility, VisibilityOff, Fingerprint, HelpOutline,
  Storage, Security, Language, Pause, PlayArrow, EngineeringIcon, AssessmentIcon, HttpsIcon, styled
} from './components/mui-icons';

import { WorkerManager } from '../../lib/workers/upload-manager';
import type { WorkerConfig } from '../../lib/workers/upload-web-worker';
import { getApiUrl } from '../../config/api';
import { Logger, LogLevel } from '../../lib/logger/logger';

// Styled Components
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

// Interfaces
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

const UploadInterface: React.FC = () => {
  // State
  const [activeStep, setActiveStep] = useState(0);
  const [selectedByteBridge, setSelectedByteBridge] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [isFolder, setIsFolder] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ value: 0, text: '' });
  const [keys, setKeys] = useState<KeyData | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false, message: '', severity: 'success',
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [hasAgreedToTerms, setHasAgreedToTerms] = useState(false);
  const [useWebTransport, setUseWebTransport] = useState<boolean>(false);
  const [workerCount, setWorkerCount] = useState<number>(4);
  const [canResume, setCanResume] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [resumableUploadId, setResumableUploadId] = useState<string | null>(null);

  const managerRef = useRef<WorkerManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loggerRef = useRef<Logger>(new Logger('Upload', LogLevel.INFO));

  const MULTI_WORKER_THRESHOLD = 20 * 1024 * 1024; // 20MB

  // Data
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

  // Helper Functions
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

  const processFileList = (files: FileList): FileItem[] => {
    const items: FileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = (file as any).webkitRelativePath || file.name;
      items.push({ file, relativePath });
    }
    return items;
  };

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
      setProgress({ value: 0, text: '' });
      setCanResume(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true
  });

  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const items = processFileList(files);
      setFileItems(items);
      setFile(null);
      setIsFolder(true);
      setKeys(null);
      setProgress({ value: 0, text: '' });
      setCanResume(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getTotalSize = (): number => {
    if (isFolder) {
      return fileItems.reduce((total, item) => total + item.file.size, 0);
    }
    return file?.size || 0;
  };

  const cleanupManager = async () => {
    if (managerRef.current) {
      await managerRef.current.cleanup();
      managerRef.current = null;
    }
  };

  // Main Processing Logic
  const handlePrepareUpload = async () => {
    setActiveStep(2);
  };
  
  const handleProceedToUpload = async () => {
    if (!file && fileItems.length === 0) return;

    const logger = loggerRef.current;
    
    try {
      logger.info('Generating new encryption keys');
      const keyFingerprint = crypto.randomUUID().substring(0, 13);
      const masterKey = new Uint8Array(32);
      crypto.getRandomValues(masterKey);

      setKeys({ 
        secretKey: Array.from(masterKey).map(b => b.toString(16).padStart(2, '0')).join(''),
        keyFingerprint 
      });

      logger.info('Requesting upload session from server');
      const initResponse = await fetch(getApiUrl('/api/v1/upload/initialize/'), { 
        method: 'POST' 
      });
      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        logger.error('Server initialization failed', { status: initResponse.status, statusText: initResponse.statusText, errorText });
        throw new Error(`Server failed to initialize upload: ${initResponse.status} ${initResponse.statusText}`);
      }
      const response = await initResponse.json();
      setResumableUploadId(response.uploadId);
      setActiveStep(3);
    } catch (error) {
      logger.error('Failed to prepare upload', { error });
      setSnackbar({ open: true, message: `Failed to prepare upload: ${(error as Error).message}`, severity: 'error' });
    }
  };
  
  useEffect(() => {
    const startUploadProcess = async () => {
      if (!file && fileItems.length === 0) return;
      
      let fileToProcess: File;
      if (isFolder) {
        setProgress({ value: 5, text: 'Creating archive...' });
        fileToProcess = await createArchiveFromFiles(fileItems);
      } else {
        fileToProcess = file!;
      }
      
      await handleUpload(fileToProcess);
    };

    if (activeStep === 3 && keys && resumableUploadId && !isProcessing && !isPaused) {
      startUploadProcess();
    }
  }, [activeStep, keys, resumableUploadId, isProcessing, isPaused]);


  const handleUpload = async (fileToProcess: File, resume: boolean = false) => {
    const logger = loggerRef.current;
    
    if (!keys || !resumableUploadId) {
        setSnackbar({ open: true, message: 'Encryption keys or upload session is missing.', severity: 'error' });
        setActiveStep(1);
        return;
    }
    
    try {
      logger.info('Starting upload process', { fileName: fileToProcess.name, fileSize: fileToProcess.size, resume });
      setIsProcessing(true);
      setProgress({ value: 0, text: 'Initializing encryption...' });
      const masterKey = new Uint8Array(keys.secretKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      if(resume) setSnackbar({ open: true, message: 'Resuming upload...', severity: 'info' });
      const workerConfig: WorkerConfig = { useWebTransport, maxConcurrentUploads: 4, chunkSize: { min: 1 * 1024 * 1024, max: 8 * 1024 * 1024, initial: 2 * 1024 * 1024, }, uploadTimeout: 120_000, promiseStaleTimeout: 300_000, retryConfig: { maxRetries: 3, baseDelay: 1000, maxDelay: 10000, }, backpressure: { threshold: 5, delayMultiplier: 100, }, adaptiveChunkSizing: { enabled: true, historySize: 5, increaseThreshold: 1.3, decreaseThreshold: 0.7, adjustmentFactor: 1.5, }, batchNotification: { timeoutMs: 5, minChunksForFlush: 10, largeChunkThreshold: 100 * 1024, }, enableDetailedLogging: false, logLevel: 1, };
      const effectiveWorkerCount = fileToProcess.size >= MULTI_WORKER_THRESHOLD ? workerCount : 1;
      const manager = new WorkerManager({ masterKey, keyFingerprint: keys.keyFingerprint, useWebTransport, httpEndpoint: getApiUrl('/api/v1/upload/chunk/'), workerConfig, workerCount: effectiveWorkerCount, enableCheckpoints: true, });
      managerRef.current = manager;
      setProgress({ value: 10, text: `Initializing ${effectiveWorkerCount} worker(s)...` });
      await manager.initialize();
      if (!resume) { const canResumeUpload = await manager.canResumeUpload(resumableUploadId); setCanResume(canResumeUpload); }
      setProgress({ value: 30, text: resume ? 'Resuming upload...' : 'Starting upload...' });
      await manager.startUpload(fileToProcess, resumableUploadId, (progressUpdate) => { const { processedBytes, totalBytes, workersActive, chunksCompleted, totalChunks } = progressUpdate; const progressValue = totalBytes > 0 ? Math.min((processedBytes / totalBytes) * 100, 100) : 0; let progressText = `Uploading... ${formatFileSize(processedBytes)} of ${formatFileSize(totalBytes)}`; if (effectiveWorkerCount > 1) { progressText += ` (${workersActive} workers active)`; } if (chunksCompleted && totalChunks) { progressText += ` - ${chunksCompleted}/${totalChunks} chunks`; } setProgress({ value: progressValue, text: progressText }); }, resume );
      setProgress({ value: 100, text: 'Finalizing upload...' });
      const finalFilename = `${fileToProcess.name || 'file'}.lz4.enc`;
      const completeResponse = await fetch(getApiUrl('/api/v1/upload/complete/'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: resumableUploadId, filename: finalFilename }), });
      if (!completeResponse.ok) { const errorText = await completeResponse.text(); throw new Error(`Failed to finalize upload: ${completeResponse.status} ${completeResponse.statusText}`); }
      setSnackbar({ open: true, message: 'Upload completed successfully!', severity: 'success' });
      setIsPaused(false); setResumableUploadId(null); setActiveStep(4);
    } catch (error) {
      logger.error('Upload failed', { error, message: (error as Error).message, stack: (error as Error).stack, fileName: fileToProcess.name, fileSize: fileToProcess.size });
      setSnackbar({ open: true, message: `Upload failed: ${(error as Error).message}`, severity: 'error' });
    } finally {
      setIsProcessing(false); await cleanupManager();
    }
  };

  const handleDownloadKey = () => {
    if (!keys) return;
    const keyFileData = { "//": "ByteBridge Recovery Key. Store this file securely. It is required to decrypt your data.", "keyFingerprint": keys.keyFingerprint, "secretKey": keys.secretKey, "version": 2, "algorithm": "XChaCha20-Poly-1305 (Stateless)", "compression": "LZ4" };
    const fileContent = JSON.stringify(keyFileData, null, 2);
    const blob = new Blob([fileContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `bytebridge-recovery-key-${keys.keyFingerprint}.bbkey`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Recovery key file downloading...', severity: 'success' });
  };

  const handleReset = async (fullReset = true) => {
    await cleanupManager();
    if (fullReset) { setActiveStep(0); setSelectedByteBridge(''); }
    setFile(null); setFileItems([]); setIsFolder(false); setKeys(null); setCopiedKey(null);
    setHasAgreedToTerms(false); setCanResume(false); setIsPaused(false); setResumableUploadId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const handleBack = () => {
    if (activeStep === 3 && isProcessing && !isPaused) {
      handlePauseUpload();
    }
    setActiveStep(prev => prev - 1);
  };

  const handlePauseUpload = async () => {
    if (managerRef.current) {
      await managerRef.current.pauseUpload();
      setIsPaused(true);
      setSnackbar({ open: true, message: 'Upload paused. You can resume later.', severity: 'info' });
    }
  };

  const handleResumeUpload = async () => {
    if (!file && fileItems.length === 0) return;
    setIsPaused(false);
    let fileToProcess: File;
    if (isFolder) fileToProcess = await createArchiveFromFiles(fileItems);
    else fileToProcess = file!;
    await handleUpload(fileToProcess, true);
  };

  const copyToClipboard = (text: string, keyType: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(keyType);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'success';
      case 'busy': return 'warning';
      case 'maintenance': return 'error';
      default: return 'default';
    }
  };

  const KeyField: React.FC<KeyFieldProps> = ({ label, value }) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const maskedValue = value && value.length > 12 ? `${value.substring(0, 6)}...${value.substring(value.length - 6)}` : '***';
    return (<Box><Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 'bold' }}>{label}</Typography><KeyDisplay><Typography variant="body2" sx={{ mr: 2 }}>{isRevealed ? value : maskedValue}</Typography><Box><Tooltip title={isRevealed ? 'Hide' : 'Show'}><IconButton size="small" onClick={() => setIsRevealed(!isRevealed)}>{isRevealed ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></Tooltip><Tooltip title={copiedKey === label ? 'Copied!' : 'Copy'}><IconButton size="small" onClick={() => copyToClipboard(value, label)}>{copiedKey === label ? <CheckCircle fontSize="small" color="success" /> : <FileCopy fontSize="small" />}</IconButton></Tooltip>{label === 'Encryption Key' && <Tooltip title="Download"><IconButton size="small" onClick={handleDownloadKey}><Download fontSize="small" /></IconButton></Tooltip>}</Box></KeyDisplay></Box>);
  };

  const steps = ['Select ByteBridge', 'Select File', 'Terms of Service', 'Upload', 'Complete'];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Card elevation={3} sx={{ borderRadius: 4, p: { xs: 2, sm: 3, md: 4 } }}>
        <CardContent>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, textAlign: 'center' }}>
            Upload and Encrypt Your Data To ByteBridge
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', mt: 1, mb: 4 }}>
            ByteBridge implements Zero-Knowledge Encryption to ensure only you can access your data.
          </Typography>

          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
            {steps.map((label) => ( <Step key={label}><StepLabel>{label}</StepLabel></Step> ))}
          </Stepper>

          <Box sx={{ minHeight: 350, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {activeStep === 0 && (
              <Fade in={true}>
                <Box>
                  <Typography variant="h6" sx={{ mb: 3, textAlign: 'center' }}>Choose a ByteBridge Server</Typography>
                  <RadioGroup value={selectedByteBridge} onChange={(e) => setSelectedByteBridge(e.target.value)}>
                    <Stack spacing={2}>
                      {byteBridges.map((bridge) => (
                        <ByteBridgeCard key={bridge.id} className={selectedByteBridge === bridge.id ? 'selected' : ''} onClick={() => setSelectedByteBridge(bridge.id)}>
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
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Storage sx={{ fontSize: 16 }} /><Typography variant="caption">{bridge.capacity}</Typography></Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><AssessmentIcon sx={{ fontSize: 16 }} /><Typography variant="caption">{bridge.reflection}</Typography></Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Security sx={{ fontSize: 16 }} /><Typography variant="caption">{bridge.HippaCompliant}</Typography></Box>
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
                      <Typography variant="h6">Drag and drop files or a folder here</Typography>
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
                              <ListItem key={index} sx={{ py: 0.5 }}>
                                <ListItemIcon sx={{ minWidth: 32 }}><InsertDriveFile fontSize="small" /></ListItemIcon>
                                <ListItemText primary={item.relativePath} secondary={formatFileSize(item.file.size)} primaryTypographyProps={{ variant: 'body2', noWrap: true }} secondaryTypographyProps={{ variant: 'caption' }} />
                              </ListItem>
                            ))}
                            {fileItems.length > 5 && <ListItem><ListItemText primary={`... and ${fileItems.length - 5} more files`} primaryTypographyProps={{ variant: 'body2', fontStyle: 'italic' }} /></ListItem>}
                          </List>
                        </Box>
                      )}
                    </Paper>
                    {(file || fileItems.length > 0) && (
                      <Paper variant="outlined" sx={{ mt: 3, p: 2.5, backgroundColor: 'background.default' }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600, color: 'text.primary' }}>Upload Configuration</Typography>
                        <Stack spacing={2}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <HttpsIcon fontSize="small" color="action" />
                              <Typography variant="body2">WebTransport Protocol</Typography>
                              <Tooltip title="Use WebTransport for faster transfers (experimental)"><HelpOutline fontSize="small" color="action" sx={{ ml: 0.5, cursor: 'help' }} /></Tooltip>
                            </Box>
                            <Switch checked={useWebTransport} onChange={(e) => setUseWebTransport(e.target.checked)} color="primary" size="small"/>
                          </Box>
                          <Divider />
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <EngineeringIcon fontSize="small" color="action" />
                              <Typography variant="body2">Parallel Upload Workers</Typography>
                              <Tooltip title={`Multiple workers enabled for files larger than ${MULTI_WORKER_THRESHOLD / 1024 / 1024}MB`}><HelpOutline fontSize="small" color="action" sx={{ ml: 0.5, cursor: 'help' }} /></Tooltip>
                            </Box>
                            <Chip label={getTotalSize() >= MULTI_WORKER_THRESHOLD ? `${workerCount} workers` : '1 worker'} size="small" variant="outlined"/>
                          </Box>
                          {getTotalSize() >= MULTI_WORKER_THRESHOLD && (
                            <Box sx={{ pl: 4 }}>
                              <Stack direction="row" spacing={1}>
                                {[2, 4, 6, 8].map(count => (
                                  <Button key={count} size="small" variant={workerCount === count ? 'contained' : 'outlined'} onClick={() => setWorkerCount(count)} sx={{ minWidth: 40, height: 32 }}>{count}</Button>
                                ))}
                              </Stack>
                            </Box>
                          )}
                        </Stack>
                      </Paper>
                    )}
                  </Box>
                </Fade>
              </Box>
            )}

            {activeStep === 2 && (
              <Fade in={true}>
                <Box>
                  <Typography variant="h6" sx={{ mb: 2, textAlign: 'center' }}>Terms of Service & Agreements</Typography>
                  <Paper variant="outlined" sx={{ p: 3, maxHeight: 300, overflow: 'auto', mb: 3 }}>
                    <Typography variant="body1" sx={{ fontWeight: 'bold', mb: 2, color: 'text.primary' }}>
                      I understand that I am solely responsible for my recovery key and will saved it securely.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      By proceeding, you acknowledge the statement above. The recovery key generated in the next step is the *only* way to decrypt and access your uploaded data. If you lose this key, your data will be irrecoverable. ByteBridge does not store your key and cannot help you recover it.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum diam nisl sit amet erat. Duis semper. Duis arcu massa, scelerisque vitae, consequat in, pretium a, enim. Pellentesque congue. Ut in risus volutpat libero pharetra tempor.
                    </Typography>
                  </Paper>
                  <FormControlLabel
                    control={<Checkbox checked={hasAgreedToTerms} onChange={(e) => setHasAgreedToTerms(e.target.checked)} />}
                    label="I have read, understood, and agree to the terms above."
                  />
                </Box>
              </Fade>
            )}

            {activeStep === 3 && (
              <Fade in={true}>
                <Box>
                  <Paper 
                    variant="outlined" 
                    sx={{ p: 3, mb: 3, backgroundColor: 'background.default', borderLeft: 4, borderLeftColor: 'primary.main' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                      <Lock color="primary" sx={{ mt: 0.5 }} />
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                          Important: Save Your Recovery Key
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Upload is in progress. Your key is required to decrypt your data. 
                          Store it securely now.
                        </Typography>
                      </Box>
                    </Box>
                  </Paper>

                  <Stack spacing={3}>
                    <KeyField label="Encryption Key" value={keys?.secretKey || ''} />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 'bold' }}>Key Fingerprint</Typography>
                      <KeyDisplay>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Fingerprint color="action" /><Typography variant="body2">{keys?.keyFingerprint}</Typography></Box>
                        <Tooltip title="Used to identify the key."><IconButton size="small"><HelpOutline fontSize="small" /></IconButton></Tooltip>
                      </KeyDisplay>
                    </Box>
                  </Stack>
                </Box>
              </Fade>
            )}
            
            {activeStep === 4 && (
              <Fade in={true}>
                <Box sx={{ textAlign: 'center' }}>
                  <CheckCircle color="success" sx={{ fontSize: 80, mb: 2 }} />
                  <Typography variant="h5" sx={{ fontWeight: 500 }}>Upload Complete</Typography>
                  <Typography color="text.secondary">Your data has been securely uploaded and verified.</Typography>
                </Box>
              </Fade>
            )}
          </Box>
          
          {isProcessing && activeStep === 3 && (
            <Box sx={{ mt: 4, mb: -2 }}>
              <LinearProgress variant="determinate" value={progress.value} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                <Typography variant="caption" sx={{ flex: 1 }}>{progress.text}{isPaused ? ' (Paused)' : ''}</Typography>
                {managerRef.current && (
                  <IconButton size="small" color="primary" onClick={isPaused ? handleResumeUpload : handlePauseUpload} sx={{ ml: 2 }}>
                    {isPaused ? <PlayArrow /> : <Pause />}
                  </IconButton>
                )}
              </Box>
            </Box>
          )}
          {isPaused && activeStep === 3 && (
            <Alert severity="info" sx={{ mt: 4, mb: -2 }}>
              <AlertTitle>Upload Paused</AlertTitle>
              Your upload has been paused. You can go back or resume when ready.
            </Alert>
          )}

          <Divider sx={{ my: 4 }} />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
               {activeStep > 0 && activeStep < 4 && (
                 <Button onClick={handleBack} disabled={isProcessing && !isPaused}>Back</Button>
               )}
            </Box>
            <Stack direction="row" justifyContent="flex-end" spacing={2}>
              {activeStep === 0 && <Button variant="contained" size="large" onClick={() => setActiveStep(1)} disabled={!selectedByteBridge}>Next: Select File</Button>}
              {activeStep === 1 && <Button variant="contained" size="large" onClick={handlePrepareUpload} disabled={(!file && fileItems.length === 0)}>Next: Review Terms</Button>}
              {activeStep === 2 && <Button variant="contained" size="large" onClick={handleProceedToUpload} disabled={!hasAgreedToTerms}>Agree & Start Upload</Button>}
              {activeStep === 4 && <Button variant="contained" size="large" startIcon={<Refresh />} onClick={() => handleReset(true)}>Upload Another File</Button>}
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

export default UploadInterface;