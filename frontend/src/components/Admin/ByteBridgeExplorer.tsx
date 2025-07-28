import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Container,
  Paper,
  Breadcrumbs,
  Link,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Divider,
  List,
  ListItem,
  ListItemText,
  TablePagination
} from '@mui/material';
import {
  NavigateNext as NavigateNextIcon,
  Storage as StorageIcon,
  CloudQueue as CloudIcon,
  InsertDriveFile as FileIcon,
  Refresh as RefreshIcon,
  ArrowBack as BackIcon,
  Info as InfoIcon,
  AccountTree as RepositoryIcon,
} from '@mui/icons-material';

import api from '../../api';
import { useAuth } from '../../context/AuthenticationContext';

interface ByteBridgeInstance {
  id: string;
  name: string;
  instance_identifier: string;
  description: string;
  host: string;
  port: number;
  owner_id: string;
  owner_username: string;
  team_id?: string;
  team_name?: string;
  is_public: boolean;
  is_community: boolean;
  created_at: string;
  updated_at: string;
  instance_type: 'standard' | 'small' | 'large';
  status: 'online' | 'offline' | 'maintenance' | 'error';
}

interface Datastore {
  id: string;
  name: string;
  bucket_count: number;
  permission_type: string;
  created_at: string;
}

interface Repository {
  id: string;
  name: string;
  object_count: number;
  permission_type: string;
  created_at: string;
}

interface ByteBridgeFile {
  id: string;
  name: string;
  size: number;
  content_type: string;
  last_modified: string;
  [key: string]: any; 
}

// Helper function to format bytes to human-readable format
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Main ByteBridge Explorer component
const ByteBridgeExplorer: React.FC = () => {
  const { isAuthenticated, user, refreshToken, loading: authLoading } = useAuth();
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Navigation state
  const [instances, setInstances] = useState<ByteBridgeInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<ByteBridgeInstance | null>(null);
  const [datastores, setDatastores] = useState<Datastore[]>([]);
  const [selectedDatastore, setSelectedDatastore] = useState<Datastore | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepository, setSelectedRepository] = useState<Repository | null>(null);
  const [files, setFiles] = useState<ByteBridgeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ByteBridgeFile | null>(null);
  
  // Modal state
  const [fileDetailsOpen, setFileDetailsOpen] = useState(false);
  
  // Navigation level
  // 0: Instances, 1: DataStores, 2: Repositories, 3: Files, 4: File Details
  const [navigationLevel, setNavigationLevel] = useState(0);
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(11);

  useEffect(() => {
    const verifyAdminAccess = async () => {
      if (user) {
        const isAdmin = Boolean(
          user.isAdmin || user.is_superuser || user.is_staff
        );
        
        setIsVerifiedAdmin(isAdmin);
        
        if (!isAdmin) {
          setError('You do not have admin permissions to access ByteBridge Explorer.');
        }
      } else {
        setIsVerifiedAdmin(false);
      }
    };
    
    verifyAdminAccess();
  }, [user]);
  
  // Fetch instances on component mount
  useEffect(() => {
    fetchInstances();
  }, []);
  
  // Reset pagination when changing views
  useEffect(() => {
    setPage(0);
  }, [navigationLevel, selectedInstance, selectedDatastore, selectedRepository]);
  
  // Reset data when changing levels
  useEffect(() => {
    if (navigationLevel === 0) {
      setSelectedInstance(null);
      setDatastores([]);
    }
    if (navigationLevel === 1) {
      setSelectedDatastore(null);
      setRepositories([]);
    }
    if (navigationLevel === 2) {
      setSelectedRepository(null);
      setFiles([]); 
    }
    if (navigationLevel === 3) {
      setSelectedFile(null); 
    }
  }, [navigationLevel]);
  
  // When the component unmounts, reset all states
  // to avoid memory leaks and stale data
  useEffect(() => {
    return () => {
      setInstances([]);
      setDatastores([]);
      setRepositories([]);
      setFiles([]); 
      setSelectedInstance(null);
      setSelectedDatastore(null);
      setSelectedRepository(null);
      setSelectedFile(null); 
      setError(null);
    };
  }, []);
  
  // Handle pagination change
  const handlePageChange = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };
  
  // Fetch instances
  const fetchInstances = async () => {
    setLoading(true);
    setError(null);
    try {
      // Attempt the API call
      const response = await api.get('/api/admin/my-bytebridges/');
      setInstances(response.data.bytebridges);
      setNavigationLevel(0);
    } catch (err: any) {
      // If it's an authorization error (401), try to refresh the token once
      if (err.response && err.response.status === 401) {
        try {
          const newToken = await refreshToken();
          if (newToken) {
            // If token refresh succeeded, retry the request
            const response = await api.get('/api/admin/my-bytebridges/');
            setInstances(response.data.bytebridges);
            setNavigationLevel(0);
            return;
          }
        } catch (refreshErr) {
          // If token refresh failed, set auth-related error
          setError('Your session has expired. Please log in again.');
          return;
        }
      }
      
      // For other errors
      setError('Failed to load ByteBridge instances. Please try again.');
    } finally {
      setLoading(false);
    }
  };  
  
  // Fetch DataStores for selected instance
  const fetchDatastores = async (instance: ByteBridgeInstance) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/explorer/${instance.instance_identifier}/datastores/`);
      setDatastores(response.data.datastores || []);
      setSelectedInstance(instance);
      setNavigationLevel(1);
    } catch (err: any) {
      // Handle token refresh for 401 errors
      if (err.response && err.response.status === 401) {
        try {
          const newToken = await refreshToken();
          if (newToken) {
            // If token refresh succeeded, retry the request
            const response = await api.get(`/api/explorer/${instance.instance_identifier}/datastores/`);
            setDatastores(response.data.datastores || []);
            setSelectedInstance(instance);
            setNavigationLevel(1);
            return;
          }
        } catch (refreshErr) {
          setError('Your session has expired. Please log in again.');
          return;
        }
      }
      
      setError('Failed to load DataStores. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch Repositories (Buckets) for selected DataStore
  const fetchRepositories = async (datastore: Datastore) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/explorer/${selectedInstance?.instance_identifier}/datastores/${datastore.id}/buckets/`);
      setRepositories(response.data.buckets || []);
      setSelectedDatastore(datastore);
      setNavigationLevel(2);
    } catch (err: any) {
      // Handle token refresh for 401 errors
      if (err.response && err.response.status === 401) {
        try {
          const newToken = await refreshToken();
          if (newToken) {
            // If token refresh succeeded, retry the request
            const response = await api.get(`/api/explorer/${selectedInstance?.instance_identifier}/datastores/${datastore.id}/buckets/`);
            setRepositories(response.data.buckets || []);
            setSelectedDatastore(datastore);
            setNavigationLevel(2);
            return;
          }
        } catch (refreshErr) {
          setError('Your session has expired. Please log in again.');
          return;
        }
      }
      
      setError('Failed to load Repositories. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch Files for selected Repository
  const fetchFiles = async (repository: Repository) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/explorer/${selectedInstance?.instance_identifier}/buckets/${repository.id}/objects/`);
      setFiles(response.data.objects || []); 
      setSelectedRepository(repository);
      setNavigationLevel(3);
    } catch (err: any) {
      // Handle token refresh for 401 errors
      if (err.response && err.response.status === 401) {
        try {
          const newToken = await refreshToken();
          if (newToken) {
            // If token refresh succeeded, retry the request
            const response = await api.get(`/api/explorer/${selectedInstance?.instance_identifier}/buckets/${repository.id}/objects/`);
            setFiles(response.data.objects || []);
            setSelectedRepository(repository);
            setNavigationLevel(3);
            return;
          }
        } catch (refreshErr) {
          setError('Your session has expired. Please log in again.');
          return;
        }
      }
      
      setError('Failed to load Files. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // View File details
  const viewFileDetails = (file: ByteBridgeFile) => {
    setSelectedFile(file);
    setFileDetailsOpen(true);
  };
  
  // Navigate back
  const handleBack = () => {
    if (navigationLevel > 0) {
      setNavigationLevel(navigationLevel - 1);
    }
  };
  
  // Render breadcrumbs
  const renderBreadcrumbs = () => {
    return (
      <Breadcrumbs 
        separator={<NavigateNextIcon fontSize="small" />} 
        aria-label="breadcrumb"
        sx={{ mb: 3 }}
      >
        <Link 
          color="inherit" 
          href="#" 
          onClick={(e) => {
            e.preventDefault();
            setNavigationLevel(0);
          }}
        >
          Instances
        </Link>
        
        {selectedInstance && (navigationLevel >= 1) && (
          <Link 
            color="inherit" 
            href="#" 
            onClick={(e) => {
              e.preventDefault();
              setNavigationLevel(1);
            }}
          >
            {selectedInstance.name}
          </Link>
        )}
        
        {selectedDatastore && (navigationLevel >= 2) && (
          <Link 
            color="inherit" 
            href="#" 
            onClick={(e) => {
              e.preventDefault();
              setNavigationLevel(2);
            }}
          >
            {selectedDatastore.name}
          </Link>
        )}
        
        {selectedRepository && (navigationLevel >= 3) && (
          <Typography color="text.primary">{selectedRepository.name}</Typography>
        )}
      </Breadcrumbs>
    );
  };
  
  // Render ByteBridge instances view with pagination
  const renderInstances = () => {
    if (loading) {
      return <CircularProgress />;
    }
    
    if (instances.length === 0) {
      return (
        <Alert severity="info">
          No ByteBridge instances found. Please check your connections.
        </Alert>
      );
    }
    
    // Paginate instances
    const paginatedInstances = instances.slice(
      page * rowsPerPage, 
      page * rowsPerPage + rowsPerPage
    );
    
    return (
      <>
        <Grid container spacing={3}>
          {paginatedInstances.map(instance => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={instance.id}>
              <Card 
                sx={{ 
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6
                  },
                  boxShadow: instance.status === 'online' ? '0 0 0 2px #4caf50' : undefined
                }}
                onClick={() => fetchDatastores(instance)}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <CloudIcon sx={{ mr: 1, color: 'primary.main' }} />
                      <Typography variant="h6">{instance.name}</Typography>
                    </Box>
                    <Chip 
                      size="small" 
                      label={instance.status.toUpperCase()} 
                      color={instance.status === 'online' ? 'success' : 
                            instance.status === 'offline' ? 'default' :
                            instance.status === 'maintenance' ? 'warning' : 'error'} 
                    />
                  </Box>
                  
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {instance.description || 'No description available'}
                  </Typography>
                  
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      <strong>Host:</strong> {instance.host}:{instance.port}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Type:</strong> {instance.instance_type.charAt(0).toUpperCase() + instance.instance_type.slice(1)}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
        
        {instances.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={instances.length}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[11, 22, 33]}
            sx={{ mt: 2 }}
          />
        )}
      </>
    );
  };
  
  // Render DataStores view with pagination
  const renderDatastores = () => {
    if (loading) {
      return <CircularProgress />;
    }
    
    if (datastores.length === 0) {
      return (
        <Alert severity="info">
          No DataStores found in this instance.
        </Alert>
      );
    }
    
    // Paginate DataStores
    const paginatedDatastores = datastores.slice(
      page * rowsPerPage, 
      page * rowsPerPage + rowsPerPage
    );
    
    return (
      <>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Instance: <strong>{selectedInstance?.name}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedInstance?.host}:{selectedInstance?.port}
          </Typography>
        </Box>
        
        <TableContainer component={Paper} elevation={2}>
          <Table aria-label="datastores table">
            <TableHead sx={{ bgcolor: 'primary.main' }}>
              <TableRow>
                <TableCell sx={{ color: 'white' }}>Name</TableCell>
                <TableCell sx={{ color: 'white' }}>Repositories</TableCell>
                <TableCell sx={{ color: 'white' }}>Permission Type</TableCell>
                <TableCell sx={{ color: 'white' }}>Created At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedDatastores.map((datastore) => (
                <TableRow 
                  key={datastore.id}
                  hover
                  onClick={() => fetchRepositories(datastore)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <StorageIcon sx={{ mr: 1, color: 'primary.main' }} />
                      {datastore.name}
                    </Box>
                  </TableCell>
                  <TableCell>{datastore.bucket_count}</TableCell>
                  <TableCell>
                    <Chip 
                      size="small" 
                      label={datastore.permission_type} 
                      color={
                        datastore.permission_type === 'private' ? 'default' :
                        datastore.permission_type === 'public' ? 'primary' : 
                        datastore.permission_type === 'shared' ? 'secondary' : 'default'
                      } 
                    />
                  </TableCell>
                  <TableCell>{new Date(datastore.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        
        {datastores.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={datastores.length}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[11, 22, 33]}
            sx={{ mt: 2 }}
          />
        )}
      </>
    );
  };
  
  // Render Repositories view with pagination
  const renderRepositories = () => {
    if (loading) {
      return <CircularProgress />;
    }
    
    if (repositories.length === 0) {
      return (
        <Alert severity="info">
          No Repositories found in this DataStore.
        </Alert>
      );
    }
    
    // Paginate Repositories
    const paginatedRepositories = repositories.slice(
      page * rowsPerPage, 
      page * rowsPerPage + rowsPerPage
    );
    
    return (
      <>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            DataStore: <strong>{selectedDatastore?.name}</strong>
          </Typography>
        </Box>
        
        <TableContainer component={Paper} elevation={2}>
          <Table aria-label="repositories table">
            <TableHead sx={{ bgcolor: 'primary.main' }}>
              <TableRow>
                <TableCell sx={{ color: 'white' }}>Name</TableCell>
                <TableCell sx={{ color: 'white' }}>Objects</TableCell>
                <TableCell sx={{ color: 'white' }}>Permission Type</TableCell>
                <TableCell sx={{ color: 'white' }}>Created At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedRepositories.map((repository) => (
                <TableRow 
                  key={repository.id}
                  hover
                  onClick={() => fetchFiles(repository)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <RepositoryIcon sx={{ mr: 1, color: 'info.main' }} />
                      {repository.name}
                    </Box>
                  </TableCell>
                  <TableCell>{repository.object_count}</TableCell>
                  <TableCell>
                    <Chip 
                      size="small" 
                      label={repository.permission_type} 
                      color={
                        repository.permission_type === 'private' ? 'default' :
                        repository.permission_type === 'public' ? 'primary' : 
                        repository.permission_type === 'shared' ? 'secondary' : 'default'
                      } 
                    />
                  </TableCell>
                  <TableCell>{new Date(repository.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        
        {repositories.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={repositories.length}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[11, 22, 33]}
            sx={{ mt: 2 }}
          />
        )}
      </>
    );
  };
  
  // Render Files view with pagination
  const renderFiles = () => {
    if (loading) {
      return <CircularProgress />;
    }
    
    if (files.length === 0) {
      return (
        <Alert severity="info">
          No Files found in this Repository.
        </Alert>
      );
    }
    
    // Paginate Files
    const paginatedFiles = files.slice(
      page * rowsPerPage, 
      page * rowsPerPage + rowsPerPage
    );
    
    return (
      <>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Repository: <strong>{selectedRepository?.name}</strong>
          </Typography>
        </Box>
        
        <TableContainer component={Paper} elevation={2}>
          <Table aria-label="files table">
            <TableHead sx={{ bgcolor: 'primary.main' }}>
              <TableRow>
                <TableCell sx={{ color: 'white' }}>Name</TableCell>
                <TableCell sx={{ color: 'white' }}>Size</TableCell>
                <TableCell sx={{ color: 'white' }}>Content Type</TableCell>
                <TableCell sx={{ color: 'white' }}>Last Modified</TableCell>
                <TableCell sx={{ color: 'white' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedFiles.map((file) => (
                <TableRow 
                  key={file.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <FileIcon sx={{ mr: 1, color: 'text.secondary' }} />
                      {file.name}
                    </Box>
                  </TableCell>
                  <TableCell>{formatBytes(file.size)}</TableCell>
                  <TableCell>{file.content_type}</TableCell>
                  <TableCell>{new Date(file.last_modified).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      startIcon={<InfoIcon />}
                      onClick={(e) => {
                        e.stopPropagation();
                        viewFileDetails(file);
                      }}
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        
        {files.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={files.length}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[11, 22, 33]}
            sx={{ mt: 2 }}
          />
        )}
      </>
    );
  };
  
  // Render File details modal
  const renderFileDetailsModal = () => {
    if (!selectedFile) return null;
    
    return (
      <Dialog 
        open={fileDetailsOpen} 
        onClose={() => setFileDetailsOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <FileIcon sx={{ mr: 1 }} />
            {selectedFile.name}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom>Basic Information</Typography>
              <List dense>
                <ListItem>
                  <ListItemText 
                    primary="ID" 
                    secondary={selectedFile.id} 
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Size" 
                    secondary={formatBytes(selectedFile.size)} 
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Content Type" 
                    secondary={selectedFile.content_type} 
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText 
                    primary="Last Modified" 
                    secondary={new Date(selectedFile.last_modified).toLocaleString()} 
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                  />
                </ListItem>
              </List>
            </Grid>
            
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom>Extended Metadata</Typography>
              <List dense>
                {Object.entries(selectedFile)
                  .filter(([key]) => !['id', 'name', 'size', 'content_type', 'last_modified'].includes(key))
                  .map(([key, value]) => (
                    <ListItem key={key}>
                      <ListItemText 
                        primary={key.replace(/_/g, ' ')} 
                        secondary={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                      />
                    </ListItem>
                  ))}
              </List>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFileDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    );
  };
  
  // Main render function
  return (
    <Container maxWidth="xl">
      <Box sx={{ mt: 3, mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          ByteBridge Explorer
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Explore your ByteBridge resources, DataStores, Repositories, and Files
        </Typography>
      </Box> 
      
      {!isAuthenticated && !authLoading && (
        <Alert severity="error" sx={{ mb: 3 }}>
          You must be logged in to access ByteBridge Explorer.
        </Alert>
      )}
      
      {isAuthenticated && !isVerifiedAdmin && !authLoading && (
        <Alert severity="error" sx={{ mb: 3 }}>
          You don't have admin permissions to access this section.
        </Alert>
      )}
      
      {/* Only render content if authenticated and admin */}
      {(isAuthenticated && isVerifiedAdmin) && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          
          <Paper sx={{ p: 3, mb: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {navigationLevel > 0 && (
                  <IconButton onClick={handleBack} sx={{ mr: 1 }}>
                    <BackIcon />
                  </IconButton>
                )}
                {renderBreadcrumbs()}
              </Box>
              
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button 
                  startIcon={<RefreshIcon />} 
                  variant="outlined"
                  onClick={() => {
                    switch (navigationLevel) {
                      case 0:
                        fetchInstances();
                        break;
                      case 1:
                        selectedInstance && fetchDatastores(selectedInstance);
                        break;
                      case 2:
                        selectedDatastore && fetchRepositories(selectedDatastore);
                        break;
                      case 3:
                        selectedRepository && fetchFiles(selectedRepository);
                        break;
                    }
                  }}
                >
                  Refresh
                </Button>
              </Box>
            </Box>
            
            <Divider sx={{ mb: 3 }} />
            
            {navigationLevel === 0 && renderInstances()}
            {navigationLevel === 1 && renderDatastores()}
            {navigationLevel === 2 && renderRepositories()}
            {navigationLevel === 3 && renderFiles()}
          </Paper>
          
          {renderFileDetailsModal()}
        </>
      )}
      
      {authLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
        </Box>
      )}
    </Container>
  );
};

export default ByteBridgeExplorer;