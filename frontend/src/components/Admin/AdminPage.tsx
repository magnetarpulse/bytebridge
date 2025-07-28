import React, { useState, useEffect } from 'react';
import {
  Box, 
  Typography, 
  Container, 
  Paper, 
  Grid, 
  Card, 
  CardContent, 
  CardActions, 
  Button, 
  Chip, 
  CircularProgress, 
  Alert,
  IconButton,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
  Divider
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CloudQueue as CloudIcon,
  CloudDownload as CloudDownloadIcon,
  Lock as LockIcon,
  Visibility as ReadOnlyIcon,  
  Edit as EditIcon,
  Explore as ExploreIcon,
} from '@mui/icons-material';  
import GroupsIcon from '@mui/icons-material/Groups';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';

import api from '../../api';
import { useAuth } from '../../context/AuthenticationContext';
import ByteBridgeExplorer from './ByteBridgeExplorer';

// TypeScript interfaces
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
  is_self_registered: boolean;
  last_heartbeat?: string;
  status: 'online' | 'offline' | 'maintenance' | 'error';
  storage_used: number;
  active_connections: number;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`bytebridge-tabpanel-${index}`}
      aria-labelledby={`bytebridge-tab-${index}`}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
};

const AdminPage: React.FC = () => {
  const TeamIcon = SupervisorAccountIcon;
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState<boolean>(false);
  const [byteBridges, setByteBridges] = useState<ByteBridgeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [mainView, setMainView] = useState(0); // 0 for management, 1 for explorer
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<ByteBridgeInstance | null>(null);

  const handleMainViewChange = (_: React.SyntheticEvent, newValue: number) => {
    setMainView(newValue);
  };

  // Verify if the user is an admin
  useEffect(() => {
    const verifyAdminAccess = async () => {
      if (user) {
        const isAdmin = Boolean(
          user.isAdmin || user.is_superuser || user.is_staff
        );
        
        setIsVerifiedAdmin(isAdmin);
        
        if (!isAdmin) {
          setError('You do not have admin permissions to access ByteBridge Management.');
        }
      } else {
        setIsVerifiedAdmin(false);
      }
    };
    
    verifyAdminAccess();
  }, [user]);

  // Only fetch ByteBridge instances if the user is an admin
  useEffect(() => {
    if (isVerifiedAdmin) {
      fetchMyByteBridges();
    }
  }, [isVerifiedAdmin]);

  // Fetch only the user's ByteBridge instances
  const fetchMyByteBridges = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/admin/my-bytebridges/');
      setByteBridges(response.data.bytebridges);
    } catch (err) {
      setError('Failed to load your ByteBridge instances. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle tab change
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Open delete confirmation dialog
  const handleOpenDeleteDialog = (instance: ByteBridgeInstance) => {
    setSelectedInstance(instance);
    setDeleteDialogOpen(true);
  };

  // Close delete dialog
  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setSelectedInstance(null);
  };

  // Delete ByteBridge instance
  const handleDeleteInstance = async () => {
    if (!selectedInstance) return;
    
    try {
      await api.delete(`/api/admin/bytebridges/${selectedInstance.id}/delete/`);
      // Remove the deleted instance from state
      setByteBridges(byteBridges.filter(b => b.id !== selectedInstance.id));
      setDeleteDialogOpen(false);
      setSelectedInstance(null);
    } catch (err) {
      setError('Failed to delete ByteBridge instance. Please try again.');
    }
  };

  // Get resources from ByteBridge
  const handleGetResources = async (instance: ByteBridgeInstance) => {
    try {
      // Logic to fetch resources from the ByteBridge instance
      console.log(`Fetching resources from ByteBridge: ${instance.name}`);
      // await api.get(`/api/admin/bytebridges/${instance.id}/resources/`);
      // Handle the response as needed
    } catch (err) {
      setError('Failed to fetch resources from ByteBridge. Please try again.');
    }
  };

  // Helper to format the last heartbeat time
  const formatLastHeartbeat = (timestamp?: string) => {
    if (!timestamp) return 'Never';
    
    const heartbeatTime = new Date(timestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - heartbeatTime.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    if (diffMinutes < 120) return '1 hour ago';
    
    return `${Math.floor(diffMinutes / 60)} hours ago`;
  };

  // Helper to format bytes to human-readable format
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Filter ByteBridges based on tab
  const filteredByteBridges = React.useMemo(() => {
    if (tabValue === 0) {
      // All of my ByteBridges
      return byteBridges;
    } else if (tabValue === 1) {
      // Private ByteBridges - not public, not community, not team
      return byteBridges.filter(bridge => !bridge.is_public && !bridge.is_community && !bridge.team_id);
    } else if (tabValue === 2) {
      // Public ByteBridges - read-only, available to everyone
      return byteBridges.filter(bridge => bridge.is_public && !bridge.is_community);
    } else if (tabValue === 3) {
      // Community ByteBridges - read-write, available to community
      return byteBridges.filter(bridge => bridge.is_community);
    } else if (tabValue === 4) {
      // Team ByteBridges
      return byteBridges.filter(bridge => bridge.team_id);
    }
    return byteBridges;
  }, [byteBridges, tabValue]);

  // Helper function to render ByteBridge cards
  function renderByteBridgeList(instances: ByteBridgeInstance[]) {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
        </Box>
      );
    }

    if (instances.length === 0) {
      return (
        <Alert severity="info" sx={{ my: 2 }}>
          No ByteBridge instances found in this category.
        </Alert>
      );
    }

    return (
      <Grid container spacing={3}>
        {instances.map(instance => (
          <Grid size={{ xs: 12, md: 6, lg: 4 }} key={instance.id}>
            <Card sx={{ 
              height: '100%', 
              display: 'flex', 
              flexDirection: 'column',
              boxShadow: instance.status === 'online' ? '0 0 0 2px #4caf50' : undefined
            }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                  <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                    <CloudIcon sx={{ mr: 1 }} />
                    {instance.name}
                  </Typography>
                  <Chip 
                    size="small" 
                    label={instance.status.toUpperCase()} 
                    color={instance.status === 'online' ? 'success' : 
                           instance.status === 'offline' ? 'default' :
                           instance.status === 'maintenance' ? 'warning' : 'error'} 
                  />
                </Box>
                
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  {instance.is_community ? (
                    <Tooltip title="Community ByteBridge: Anyone can read and write">
                      <Chip size="small" icon={<GroupsIcon />} label="Community" color="secondary" />
                    </Tooltip>
                  ) : instance.is_public ? (
                    <Tooltip title="Public ByteBridge: Read-only access for everyone">
                      <Chip size="small" icon={<ReadOnlyIcon />} label="Public (Read-only)" />
                    </Tooltip>
                  ) : (
                    <Tooltip title="Private ByteBridge: Only you have access">
                      <Chip size="small" icon={<LockIcon />} label="Private" />
                    </Tooltip>
                  )}
                  
                  {instance.team_id && (
                    <Tooltip title={`Team: ${instance.team_name}`}>
                      <Chip size="small" icon={<TeamIcon />} label="Team" />
                    </Tooltip>
                  )}

                  {/* Show more descriptive access level chips */}
                  {instance.is_community ? (
                    <Tooltip title="Anyone can read and write">
                      <Chip size="small" icon={<EditIcon />} label="Read/Write" color="primary" />
                    </Tooltip>
                  ) : instance.is_public && (
                    <Tooltip title="Anyone can read, only you can write">
                      <Chip size="small" icon={<ReadOnlyIcon />} label="Read" color="info" />
                    </Tooltip>
                  )}
                </Box>
              
                {instance.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {instance.description}
                  </Typography>
                )}
                
                <Divider sx={{ my: 1 }} />
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="body2">
                    <strong>Host:</strong> {instance.host}:{instance.port}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Type:</strong> {instance.instance_type.charAt(0).toUpperCase() + instance.instance_type.slice(1)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Storage Used:</strong> {formatBytes(instance.storage_used)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Active Connections:</strong> {instance.active_connections}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last Heartbeat:</strong> {formatLastHeartbeat(instance.last_heartbeat)}
                  </Typography>
                </Box>
              </CardContent>
              
              <CardActions>
                <Button 
                  startIcon={<CloudDownloadIcon />}
                  size="small" 
                  onClick={() => handleGetResources(instance)}
                  disabled={instance.status !== 'online'}
                >
                  Get Resources
                </Button>
                <IconButton 
                  color="error" 
                  size="small"
                  onClick={() => handleOpenDeleteDialog(instance)}
                  aria-label="delete"
                >
                  <DeleteIcon />
                </IconButton>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  }

  return (
    <Container maxWidth="xl">
      <Box sx={{ mt: 3, mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          ByteBridge Management
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your ByteBridge connections and explore their resources
        </Typography>
        
        {user && (
          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
              Logged in as:
            </Typography>
            <Chip 
              size="small"
              label={`${user.username} ${user.is_superuser ? '(Admin)' : user.is_staff ? '(Staff)' : ''}`}
              color={user.is_superuser ? 'primary' : user.is_staff ? 'secondary' : 'default'}
              variant="outlined"
            />
          </Box>
        )}
      </Box>

      {/* Authentication and authorization checks */}
      {!isAuthenticated && !authLoading && (
        <Alert severity="error" sx={{ mb: 3 }}>
          You must be logged in to access ByteBridge Management.
        </Alert>
      )}
      
      {isAuthenticated && !isVerifiedAdmin && !authLoading && (
        <Alert severity="error" sx={{ mb: 3 }}>
          You don't have admin permissions to access this section.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Only show content if authenticated and admin */}
      {(isAuthenticated && isVerifiedAdmin && !authLoading) && (
        <>
          {/* Main navigation tabs */}
          <Paper sx={{ mb: 4 }}>
            <Tabs
              value={mainView}
              onChange={handleMainViewChange}
              aria-label="ByteBridge main views"
              centered
            >
              <Tab 
                label="Management" 
                icon={<CloudIcon />} 
                iconPosition="start"
              />
              <Tab 
                label="Explorer" 
                icon={<ExploreIcon />} 
                iconPosition="start"
              />
            </Tabs>
          </Paper>

          {/* Management View */}
          {mainView === 0 && (
            <Paper sx={{ mb: 4 }}>
              <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs 
                  value={tabValue} 
                  onChange={handleTabChange} 
                  aria-label="ByteBridge tabs"
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  <Tab label="All My ByteBridges" />
                  <Tab label="Private" icon={<LockIcon />} iconPosition="start" />
                  <Tab label="Public" icon={<ReadOnlyIcon />} iconPosition="start" />
                  <Tab label="Community" icon={<GroupsIcon />} iconPosition="start" />
                  <Tab label="Team" icon={<TeamIcon />} iconPosition="start" />
                </Tabs>
              </Box>

              <TabPanel value={tabValue} index={0}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">All My ByteBridges</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={fetchMyByteBridges}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
                {renderByteBridgeList(filteredByteBridges)}
              </TabPanel>

              <TabPanel value={tabValue} index={1}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Private ByteBridges</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={fetchMyByteBridges}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
                {renderByteBridgeList(filteredByteBridges)}
              </TabPanel>

              <TabPanel value={tabValue} index={2}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Public ByteBridges</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={fetchMyByteBridges}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
                {renderByteBridgeList(filteredByteBridges)}
              </TabPanel>

              <TabPanel value={tabValue} index={3}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Community ByteBridges</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={fetchMyByteBridges}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
                {renderByteBridgeList(filteredByteBridges)}
              </TabPanel>

              <TabPanel value={tabValue} index={4}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Team ByteBridges</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={fetchMyByteBridges}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Box>
                {renderByteBridgeList(filteredByteBridges)}
              </TabPanel>
            </Paper>
          )}

          {mainView === 1 && (
            <ByteBridgeExplorer />
          )}

          {/* Delete confirmation dialog */}
          <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Are you sure you want to delete the ByteBridge "{selectedInstance?.name}"? 
                This will disconnect it from the system and remove all associated records.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDeleteDialog} color="primary">
                Cancel
              </Button>
              <Button onClick={handleDeleteInstance} color="error" variant="contained">
                Delete
              </Button>
            </DialogActions>
          </Dialog>
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

export default AdminPage;