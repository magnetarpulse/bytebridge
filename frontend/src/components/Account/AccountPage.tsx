import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Container, 
  Typography, 
  Paper, 
  Tabs, 
  Tab, 
  TextField, 
  Button, 
  Avatar, 
  CircularProgress, 
  Divider, 
  Alert, 
  Card,
  CardContent, 
  Switch,
  FormControlLabel,
  Tooltip,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Pagination
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Person as PersonIcon,
  VpnKey as VpnKeyIcon,
  Notifications as NotificationsIcon,
  Security as SecurityIcon,
  PhotoCamera as PhotoCameraIcon,
  ContentCopy as ContentCopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Key as KeyIcon,
  DeleteOutline as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import api from '../../api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

interface TokenFormData {
  name: string;
  token_type: string;
  days_valid: number;
  is_key_based: boolean;
  password?: string;
  public_key?: string;
  bind_to_ip?: boolean;
  max_uses?: number;
}

interface Token {
  id: string;
  name: string;
  token_value: string;
  token_type: string;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  requires_2fa: boolean;
  is_key_based?: boolean;
  key_algorithm?: string;
  bound_to_ip?: string;
  max_uses?: number;
}

interface TokenViewDialogData {
  tokenId: string;
  tokenName: string;
}

const TabPanel = (props: TabPanelProps) => {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`account-tabpanel-${index}`}
      aria-labelledby={`account-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
};

interface TokenCardProps {
  token: Token;
  onDelete: (tokenId: string) => void;
  onView: (tokenId: string, tokenName: string) => void;
  onCopy: (tokenValue: string) => void;
  canDirectlyCopyToken: (tokenType: string) => boolean;
  needsPasswordToView: (tokenType: string) => boolean;
}

const TokenCard = React.memo(({ 
  token, 
  onDelete, 
  onView, 
  onCopy, 
  canDirectlyCopyToken,
  needsPasswordToView
}: TokenCardProps) => {
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle2">
            {token.name}
          </Typography>
          <Box>
            {/* View Button for protected tokens */}
            {needsPasswordToView(token.token_type) && (
              <Tooltip title="View Token (Requires Password)">
                <IconButton 
                  color="primary" 
                  size="small" 
                  onClick={() => onView(token.id, token.name)}
                  sx={{ mr: 1 }}
                >
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Copy Button for readable tokens */}
            {canDirectlyCopyToken(token.token_type) && token.token_value !== "••••••••" && (
              <Tooltip title="Copy Token">
                <IconButton 
                  color="primary" 
                  size="small" 
                  onClick={() => onCopy(token.token_value)}
                  sx={{ mr: 1 }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Delete Button */}
            <Tooltip title="Delete Token">
              <IconButton 
                color="error" 
                size="small" 
                onClick={() => onDelete(token.id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Type: {token.token_type.toUpperCase()}
        </Typography>
        
        {/* Display token values for read and id_token types */}
        {canDirectlyCopyToken(token.token_type) && token.token_value !== "••••••••" && (
          <Box sx={{ 
            p: 1, 
            backgroundColor: 'background.paper',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            mb: 2,
            maxWidth: '100%',
            overflow: 'auto'
          }}>
            {token.token_value}
          </Box>
        )}
        
        <Box sx={{ 
          display: 'flex', 
          gap: 2, 
          flexWrap: 'wrap', 
          fontSize: '0.875rem',
          color: 'text.secondary', 
          mt: 1 
        }}>
          <Box>
            <strong>Created:</strong> {new Date(token.created_at).toLocaleDateString()}
          </Box>
          <Box>
            <strong>Expires:</strong> {token.expires_at ? new Date(token.expires_at).toLocaleDateString() : 'Never'}
          </Box>
          {token.is_key_based && (
            <Box>
              <strong>Key-Based:</strong> {token.key_algorithm}
            </Box>
          )}
          {token.bound_to_ip && (
            <Box>
              <strong>IP:</strong> {token.bound_to_ip}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
});

const AccountPage: React.FC = () => {
  const { user, getProfile } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
  });
  
  // Security settings
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  
  // Token
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [tokenForm, setTokenForm] = useState<TokenFormData>({
    name: "API Token",
    token_type: "read",
    days_valid: 30,
    is_key_based: false,
    bind_to_ip: false,
    max_uses: 100
  });
  const [userTokens, setUserTokens] = useState<Token[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [newToken, setNewToken] = useState<Token | null>(null);
  const [showTokenValue, setShowTokenValue] = useState(true);

  // Pagination for tokens
  const [page, setPage] = useState(1);
  const tokensPerPage = 3;
  
  // Token View Dialog
  const [viewTokenDialog, setViewTokenDialog] = useState(false);
  const [viewTokenDialogData, setViewTokenDialogData] = useState<TokenViewDialogData>({
    tokenId: '',
    tokenName: ''
  });
  const [viewTokenPassword, setViewTokenPassword] = useState('');
  const [viewTokenLoading, setViewTokenLoading] = useState(false);
  const [viewTokenValue, setViewTokenValue] = useState<string | null>(null);
  const [showViewTokenValue, setShowViewTokenValue] = useState(true);
  
  // Password change
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  
  // Server public key
  const [serverPublicKey, setServerPublicKey] = useState<string | null>(null);
  const [keyAlgorithm, setKeyAlgorithm] = useState<string | null>(null);
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [showPublicKey, setShowPublicKey] = useState(false);

  useEffect(() => {
    const handleBlur = () => {
      // Hide all sensitive information when tab loses focus
      setShowTokenValue(false);
      setShowViewTokenValue(false);
      setShowPublicKey(false);
    };
    
    // Add event listener for when the window loses focus
    window.addEventListener('blur', handleBlur);
    
    // Clean up the event listener when component unmounts
    return () => window.removeEventListener('blur', handleBlur);
  }, []); 
  
  useEffect(() => {
    // Update form when user data changes
    if (user) {
      setProfileForm({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
      });
    }
  }, [user]);

  // Fetch tokens and server public key when tabs are selected
  useEffect(() => {
    if (tabValue === 1) {
      fetchUserTokens();
    } else if (tabValue === 2 && !serverPublicKey) {
      fetchServerPublicKey();
    }
  }, [tabValue]);

  const fetchUserTokens = async () => {
    setLoadingTokens(true);
    try {
      const response = await api.get('/api/token/list/');
      setUserTokens(response.data.tokens);
      // Clear any new token display once we've refreshed the token list
      setNewToken(null);
    } catch (error) {
      console.error('Error fetching user tokens:', error);
      setErrorMessage('Failed to retrieve your API tokens.');
    } finally {
      setLoadingTokens(false);
    }
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const { currentTokens, totalPages } = React.useMemo(() => {
    const indexOfLastToken = page * tokensPerPage;
    const indexOfFirstToken = indexOfLastToken - tokensPerPage;
    const current = userTokens.slice(indexOfFirstToken, indexOfLastToken);
    const total = Math.ceil(userTokens.length / tokensPerPage);
    return { currentTokens: current, totalPages: total };
  }, [userTokens, page, tokensPerPage]);

  const fetchServerPublicKey = async () => {
    setIsLoadingKey(true);
    try {
      const response = await api.get('/api/auth/public-key/');
      setServerPublicKey(response.data.public_key);
      setKeyAlgorithm(response.data.algorithm);
    } catch (error) {
      console.error('Error fetching server public key:', error);
      setErrorMessage('Failed to retrieve server public key.');
    } finally {
      setIsLoadingKey(false);
    }
  };
  
  // Format public key for display
  const formatPublicKey = (key: string | null): string => {
    if (!key) return 'No key available';
    
    // Show only first and last few characters if not fully visible
    if (!showPublicKey) {
      return `${key.substring(0, 8)}...${key.substring(key.length - 8)}`;
    }
    
    // Add spaces for readability
    const formattedKey = key.replace(/(.{4})/g, '$1 ').trim();
    return formattedKey;
  };

  // Format token value for display
  const formatTokenValue = (token: string | null): string => {
    if (!token) return 'No token available';
    
    if (!showTokenValue) {
      return '•'.repeat(16);
    }
    
    return token;
  };

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccessMessage('');
    setErrorMessage('');
    
    try {
      // Simulate API call for now
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Here you would make an actual API call to update the profile
      // const response = await api.put('/users/profile/', profileForm);
      
      setSuccessMessage('Profile updated successfully!');
      // Refresh user data
      await getProfile();
    } catch (error) {
      console.error('Error updating profile:', error);
      setErrorMessage('Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccessMessage('');
    setErrorMessage('');
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage('New passwords do not match.');
      setLoading(false);
      return;
    }
    
    try {
      // Simulate API call for now
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Here you would make an actual API call to change the password
      // const response = await api.post('/users/change-password/', passwordForm);
      
      setSuccessMessage('Password changed successfully!');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error) {
      console.error('Error changing password:', error);
      setErrorMessage('Failed to change password. Please ensure your current password is correct.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateToken = async () => {
    setLoading(true);
    setNewToken(null);
    setErrorMessage('');
    
    try {
      const response = await api.post('/api/token/create/', tokenForm);
      if (response.data.success) {
        setNewToken(response.data.token);
        setSuccessMessage('New API token created successfully!');
        // await fetchUserTokens(); // Refresh the token list
      } else {
        setErrorMessage(response.data.error || 'Failed to create token');
      }
    } catch (error: any) {
      console.error('Error creating token:', error);
      setErrorMessage(
        error.response?.data?.error || 
        'Failed to create token. Please check your permissions and try again.'
      );
    } finally {
      setLoading(false);
      setShowTokenDialog(false);
    }
  };

  const handleCopyTokenToClipboard = React.useCallback((tokenValue: string) => {
    navigator.clipboard.writeText(tokenValue);
    setSuccessMessage('Token copied to clipboard!');
    
    if (newToken) {
      setTimeout(() => {
        setNewToken(null);
        fetchUserTokens();
      }, 1500);
    }
  }, [newToken]);

  const handleDeleteToken = async (tokenId: string) => {
    try {
      await api.delete(`/api/token/delete/${tokenId}/`);
      setSuccessMessage('Token deleted successfully');
      await fetchUserTokens(); 
    } catch (error) {
      console.error('Error deleting token:', error);
      setErrorMessage('Failed to delete token');
    }
  };

  const handleViewToken = async () => {
    setViewTokenLoading(true);
    setErrorMessage('');
    
    try {
      const response = await api.post('/api/token/view/verify/', {
        token_id: viewTokenDialogData.tokenId,
        password: viewTokenPassword
      });
      
      if (response.data.token_value) {
        setViewTokenValue(response.data.token_value);
      } else {
        setErrorMessage('Failed to retrieve token value');
      }
    } catch (error: any) {
      console.error('Error viewing token:', error);
      setErrorMessage(
        error.response?.data?.error || 
        'Failed to view token. Please check your password and try again.'
      );
    } finally {
      setViewTokenLoading(false);
      setViewTokenPassword(''); // Clear password for security
    }
  };

  const openViewTokenDialog = (tokenId: string, tokenName: string) => {
    setViewTokenDialogData({
      tokenId,
      tokenName
    });
    setViewTokenValue(null);
    setViewTokenPassword('');
    setViewTokenDialog(true);
  };

  const closeViewTokenDialog = () => {
    setViewTokenDialog(false);
    setViewTokenValue(null);
    setViewTokenPassword('');
  };

  const openCreateTokenDialog = () => {
    setTokenForm({
      name: "API Token",
      token_type: "read",
      days_valid: 30,
      is_key_based: false,
      bind_to_ip: false,
      max_uses: 100
    });
    setShowTokenDialog(true);
  };

  // Determine if a token needs password verification to view
  const needsPasswordToView = React.useCallback((tokenType: string): boolean => {
    return tokenType === 'admin_token' || tokenType === 'write';
  }, []);

  // Determine if a token can be directly copied (read or id_token)
  const canDirectlyCopyToken = React.useCallback((tokenType: string): boolean => {
    return tokenType === 'read' || tokenType === 'id_token';
  }, []);

  return (
    <Container maxWidth="lg">
      <Box sx={{ pt: 4, pb: 6 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card sx={{ mb: 3 }}>
              <CardContent sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                textAlign: 'center' 
              }}>
                <Avatar 
                  sx={{ 
                    width: 100, 
                    height: 120, 
                    mb: 2,
                    bgcolor: 'primary.main'
                  }}
                >
                  {user?.firstName?.[0] || user?.username?.[0] || <PersonIcon fontSize="large" />}
                </Avatar>
                <Typography variant="h6">
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}` 
                    : user?.username}
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {user?.email}
                </Typography>
                <Button 
                  variant="outlined" 
                  startIcon={<PhotoCameraIcon />}
                  size="small"
                  sx={{ mt: 1 }}
                >
                  Change Avatar
                </Button>
              </CardContent>
            </Card>
            
            <Paper elevation={1}>
              <Tabs
                orientation="vertical"
                variant="fullWidth"
                value={tabValue}
                onChange={handleTabChange}
                aria-label="account settings tabs"
                sx={{ borderRight: 1, borderColor: 'divider' }}
              >
                <Tab icon={<PersonIcon />} label="Profile" />
                <Tab icon={<VpnKeyIcon />} label="API Tokens" />
                <Tab icon={<SecurityIcon />} label="Security" />
                <Tab icon={<NotificationsIcon />} label="Notifications" />
              </Tabs>
            </Paper>
          </Grid>
          
          <Grid size={{ xs: 12, md: 9 }}>
            <Paper elevation={2}>
              {(successMessage || errorMessage) && (
                <Box sx={{ p: 2 }}>
                  {successMessage && (
                    <Alert severity="success" onClose={() => setSuccessMessage('')}>
                      {successMessage}
                    </Alert>
                  )}
                  {errorMessage && (
                    <Alert severity="error" onClose={() => setErrorMessage('')}>
                      {errorMessage}
                    </Alert>
                  )}
                </Box>
              )}
              
              <TabPanel value={tabValue} index={0}>
                <Typography variant="h6" gutterBottom>
                  Account Information
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Box component="form" onSubmit={handleProfileSubmit}>
                  <Grid container spacing={3}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        required
                        fullWidth
                        label="First Name"
                        value={profileForm.firstName}
                        onChange={(e) => setProfileForm({...profileForm, firstName: e.target.value})}
                        disabled={loading}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        required
                        fullWidth
                        label="Last Name"
                        value={profileForm.lastName}
                        onChange={(e) => setProfileForm({...profileForm, lastName: e.target.value})}
                        disabled={loading}
                      />
                    </Grid>
                    <Grid size={12}>
                      <TextField
                        required
                        fullWidth
                        label="Email Address"
                        type="email"
                        value={profileForm.email}
                        onChange={(e) => setProfileForm({...profileForm, email: e.target.value})}
                        disabled={loading}
                      />
                    </Grid>
                    <Grid size={12}>
                      <TextField
                        fullWidth
                        label="Username"
                        value={user?.username || ''}
                        disabled
                        helperText="Username cannot be changed"
                      />
                    </Grid>
                    <Grid size={12}>
                      <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        disabled={loading}
                        sx={{ mr: 2 }}
                      >
                        {loading ? <CircularProgress size={24} /> : 'Save Changes'}
                      </Button>
                      <Button variant="outlined">
                        Cancel
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </TabPanel>
              
              <TabPanel value={tabValue} index={1}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    API Tokens
                  </Typography>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<AddIcon />}
                    onClick={openCreateTokenDialog}
                  >
                    Create New Token
                  </Button>
                </Box>
                <Divider sx={{ mb: 3 }} />
                
                <Typography variant="body2" paragraph color="text.secondary">
                  API tokens are used to authenticate with the ByteBridge API. Different token types provide different levels of access.
                </Typography>
                
                {/* New token display */}
                {newToken && (
                  <Box sx={{ mb: 4 }}>
                    <Alert 
                      severity="info" 
                      sx={{ mb: 2 }}
                      action={
                        <IconButton 
                          size="small" 
                          onClick={() => setShowTokenValue(!showTokenValue)}
                        >
                          {showTokenValue ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      }
                    >
                      <Typography variant="subtitle2">
                        Your new token is ready for use. Copy it to your clipboard.
                      </Typography>
                    </Alert>
                    
                    <Card variant="outlined" sx={{ mb: 2, backgroundColor: 'background.paperElevated' }}>
                      <CardContent>
                        <Typography variant="subtitle2" gutterBottom>
                          {newToken.name} ({newToken.token_type.toUpperCase()})
                        </Typography>
                        
                        <Box sx={{ 
                          p: 1.5, 
                          backgroundColor: 'background.paper',
                          borderRadius: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.9rem',
                          mb: 2
                        }}>
                          {formatTokenValue(newToken.token_value)}
                        </Box>
                        
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Button
                            variant="contained"
                            size="small"
                            onClick={() => handleCopyTokenToClipboard(newToken.token_value)}
                            startIcon={<ContentCopyIcon />}
                          >
                            Copy to Clipboard
                          </Button>
                        </Box>
                      </CardContent>
                    </Card>
                  </Box>
                )}
                
                {/* Token list with pagination */}
                {loadingTokens ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : userTokens.length > 0 ? (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Your Active Tokens
                    </Typography>
                    
                    {currentTokens.map(token => (
                      <TokenCard
                        key={token.id}
                        token={token}
                        onDelete={handleDeleteToken}
                        onView={openViewTokenDialog}
                        onCopy={handleCopyTokenToClipboard}
                        canDirectlyCopyToken={canDirectlyCopyToken}
                        needsPasswordToView={needsPasswordToView}
                      />
                    ))}
                    
                    {/* Pagination controls */}
                    {totalPages > 1 && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                        <Pagination 
                          count={totalPages} 
                          page={page} 
                          onChange={handlePageChange} 
                          color="primary" 
                        />
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Alert severity="info" sx={{ mb: 3 }}>
                    You don't have any API tokens yet. Create one to get started.
                  </Alert>
                )}
                
                {/* Create token dialog */}
                <Dialog open={showTokenDialog} onClose={() => setShowTokenDialog(false)}>
                  <DialogTitle>Create API Token</DialogTitle>
                  <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                      Configure your API token settings. Different token types provide different levels of access.
                    </DialogContentText>
                    
                    <Grid container spacing={2}>
                      <Grid size={12}>
                        <TextField
                          fullWidth
                          label="Token Name"
                          value={tokenForm.name}
                          onChange={(e) => setTokenForm({...tokenForm, name: e.target.value})}
                          margin="normal"
                          variant="outlined"
                        />
                      </Grid>
                      
                      <Grid size={12}>
                        <FormControl fullWidth margin="normal">
                          <InputLabel>Token Type</InputLabel>
                          <Select
                            value={tokenForm.token_type}
                            onChange={(e) => setTokenForm({...tokenForm, token_type: e.target.value})}
                            label="Token Type"
                          >
                            <MenuItem value="id_token">Identity Token</MenuItem>
                            <MenuItem value="read">Read Only</MenuItem>
                            <MenuItem value="write">Read/Write</MenuItem>
                            <MenuItem value="admin_token">Admin Token</MenuItem>
                          </Select>
                          <FormHelperText>
                            {tokenForm.token_type === 'id_token' && "Basic identity verification"}
                            {tokenForm.token_type === 'read' && "Can only read data, not modify"}
                            {tokenForm.token_type === 'write' && "Can read and modify data"}
                            {tokenForm.token_type === 'admin_token' && "Full administrative access (restricted)"}
                          </FormHelperText>
                        </FormControl>
                      </Grid>
                      
                      <Grid size={12}>
                        <FormControl fullWidth margin="normal">
                          <InputLabel>Valid For (Days)</InputLabel>
                          <Select
                            value={tokenForm.days_valid}
                            onChange={(e) => setTokenForm({...tokenForm, days_valid: Number(e.target.value)})}
                            label="Valid For (Days)"
                          >
                            <MenuItem value={1}>1 Day</MenuItem>
                            <MenuItem value={7}>7 Days</MenuItem>
                            <MenuItem value={30}>30 Days</MenuItem>
                            <MenuItem value={90}>90 Days</MenuItem>
                            <MenuItem value={365}>365 Days</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      
                      {(tokenForm.token_type === 'admin_token' || tokenForm.token_type === 'write') && (
                        <Grid size={12}>
                          <TextField
                            fullWidth
                            type="password"
                            label="Current Password"
                            value={tokenForm.password || ''}
                            onChange={(e) => setTokenForm({...tokenForm, password: e.target.value})}
                            margin="normal"
                            variant="outlined"
                            required
                          />
                          <FormHelperText>
                            Required for creating admin or write tokens
                          </FormHelperText>
                        </Grid>
                      )}
                      
                      <Grid size={12}>
                        <FormControlLabel
                          control={
                            <Switch 
                              checked={tokenForm.is_key_based || false}
                              onChange={(e) => setTokenForm({...tokenForm, is_key_based: e.target.checked})}
                            />
                          }
                          label="Use Key-Based Authentication"
                        />
                        <FormHelperText>
                          More secure, but requires setting up a public key
                        </FormHelperText>
                      </Grid>
                      
                      {tokenForm.is_key_based && (
                        <Grid size={12}>
                          <TextField
                            fullWidth
                            multiline
                            rows={4}
                            label="Public Key"
                            value={tokenForm.public_key || ''}
                            onChange={(e) => setTokenForm({...tokenForm, public_key: e.target.value})}
                            margin="normal"
                            variant="outlined"
                            placeholder="Paste your public key here"
                            required
                          />
                        </Grid>
                      )}
                      
                      {tokenForm.token_type === 'admin_token' && (
                        <>
                          <Grid size={12}>
                            <FormControlLabel
                              control={
                                <Switch 
                                  checked={tokenForm.bind_to_ip}
                                  onChange={(e) => setTokenForm({...tokenForm, bind_to_ip: e.target.checked})}
                                />
                              }
                              label="Bind to Current IP Address"
                            />
                            <FormHelperText>
                              The token can only be used from your current IP address
                            </FormHelperText>
                          </Grid>
                          
                          <Grid size={12}>
                            <TextField
                              fullWidth
                              type="number"
                              label="Maximum Uses"
                              value={tokenForm.max_uses || 100}
                              onChange={(e) => setTokenForm({...tokenForm, max_uses: parseInt(e.target.value)})}
                              margin="normal"
                              variant="outlined"
                              inputProps={{ min: 1, max: 1000 }}
                            />
                            <FormHelperText>
                              Limit how many times this token can be used
                            </FormHelperText>
                          </Grid>
                        </>
                      )}
                    </Grid>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setShowTokenDialog(false)} color="inherit">Cancel</Button>
                    <Button 
                      onClick={handleCreateToken} 
                      color="primary" 
                      variant="contained"
                      disabled={loading || (tokenForm.is_key_based && !tokenForm.public_key) || 
                                ((tokenForm.token_type === 'admin_token' || tokenForm.token_type === 'write') && !tokenForm.password)}
                    >
                      {loading ? <CircularProgress size={24} /> : 'Create Token'}
                    </Button>
                  </DialogActions>
                </Dialog>
                
                {/* View token dialog */}
                <Dialog open={viewTokenDialog} onClose={closeViewTokenDialog}>
                  <DialogTitle>View Token Value</DialogTitle>
                  <DialogContent>
                    {!viewTokenValue ? (
                      <>
                        <DialogContentText>
                          For security reasons, you need to verify your password to view this token.
                        </DialogContentText>
                        <TextField
                          autoFocus
                          margin="dense"
                          label="Password"
                          type="password"
                          fullWidth
                          variant="outlined"
                          value={viewTokenPassword}
                          onChange={(e) => setViewTokenPassword(e.target.value)}
                          sx={{ mt: 2 }}
                          disabled={viewTokenLoading}
                        />
                      </>
                    ) : (
                      <>
                        <DialogContentText sx={{ mb: 2 }}>
                          Here is your token value for <strong>{viewTokenDialogData.tokenName}</strong>.
                        </DialogContentText>
                        
                        <Box sx={{ 
                          p: 2, 
                          backgroundColor: 'background.paperElevated',
                          borderRadius: 1,
                          position: 'relative',
                          mb: 2
                        }}>
                          <Typography 
                            variant="body2"
                            component="div"
                            sx={{ 
                              fontFamily: 'monospace',
                              wordBreak: 'break-all',
                              pr: 4
                            }}
                          >
                            {showViewTokenValue ? viewTokenValue : '•'.repeat(16)}
                          </Typography>
                          
                          <IconButton
                            size="small"
                            onClick={() => setShowViewTokenValue(!showViewTokenValue)}
                            sx={{ position: 'absolute', top: 8, right: 8 }}
                          >
                            {showViewTokenValue ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </Box>
                      </>
                    )}
                  </DialogContent>
                  <DialogActions>
                    {!viewTokenValue ? (
                      <>
                        <Button onClick={closeViewTokenDialog} color="inherit">Cancel</Button>
                        <Button 
                          onClick={handleViewToken}
                          color="primary" 
                          variant="contained"
                          disabled={!viewTokenPassword || viewTokenLoading}
                        >
                          {viewTokenLoading ? <CircularProgress size={24} /> : 'View Token'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={closeViewTokenDialog} color="inherit">Close</Button>
                        <Button 
                          color="primary"
                          variant="contained"
                          startIcon={<ContentCopyIcon />}
                          onClick={() => handleCopyTokenToClipboard(viewTokenValue)}
                        >
                          Copy to Clipboard
                        </Button>
                      </>
                    )}
                  </DialogActions>
                </Dialog>
              </TabPanel>
              
              <TabPanel value={tabValue} index={2}>
                <Typography variant="h6" gutterBottom>
                  Security Settings
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                {/* Server Public Key Section */}
                <Box sx={{ mb: 4 }}>
                  <Typography variant="subtitle1" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                    <KeyIcon sx={{ mr: 1 }} /> Server Public Key
                  </Typography>
                  
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    This is the public key used to verify the server's identity. Use this to authenticate the server in your applications.
                  </Typography>
                  
                  <Box sx={{ 
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 2,
                    position: 'relative',
                    bgcolor: 'background.paperElevated',
                    fontFamily: 'monospace',
                    mb: 2
                  }}>
                    {isLoadingKey ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <>
                        <Typography 
                          variant="body2" 
                          component="div"
                          sx={{ 
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                            lineHeight: 1.6
                          }}
                        >
                          {formatPublicKey(serverPublicKey)}
                        </Typography>
                        
                        <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                          <Tooltip title={showPublicKey ? "Hide full key" : "Show full key"}>
                            <IconButton 
                              size="small" 
                              onClick={() => setShowPublicKey(!showPublicKey)}
                              sx={{ mr: 1 }}
                            >
                              {showPublicKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copy public key">
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                if (serverPublicKey) {
                                  navigator.clipboard.writeText(serverPublicKey);
                                  setSuccessMessage('Public key copied to clipboard!');
                                }
                              }}
                              disabled={!serverPublicKey}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </>
                    )}
                  </Box>
                  
                  {keyAlgorithm && (
                    <Typography variant="body2" color="text.secondary">
                      Algorithm: <strong>{keyAlgorithm.toUpperCase()}</strong>
                    </Typography>
                  )}
                </Box>
                
                <Divider sx={{ my: 3 }} />
                
                <Box sx={{ mb: 4 }}>
                  <FormControlLabel
                    control={
                      <Switch 
                        checked={twoFactorEnabled} 
                        onChange={(e) => setTwoFactorEnabled(e.target.checked)} 
                      />
                    }
                    label="Enable Two-Factor Authentication"
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Add an extra layer of security to your account by requiring a verification code in addition to your password.
                  </Typography>
                </Box>
                
                <Typography variant="h6" gutterBottom>
                  Change Password
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Box component="form" onSubmit={handlePasswordSubmit}>
                  <Grid container spacing={3}>
                    <Grid size={12}>
                      <TextField
                        required
                        fullWidth
                        type="password"
                        label="Current Password"
                        value={passwordForm.currentPassword}
                        onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                        disabled={loading}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        required
                        fullWidth
                        type="password"
                        label="New Password"
                        value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                        disabled={loading}
                        helperText="Password must be at least 8 characters"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        required
                        fullWidth
                        type="password"
                        label="Confirm New Password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                        disabled={loading}
                        error={passwordForm.newPassword !== passwordForm.confirmPassword && passwordForm.confirmPassword !== ''}
                        helperText={passwordForm.newPassword !== passwordForm.confirmPassword && passwordForm.confirmPassword !== '' ? 'Passwords do not match' : ''}
                      />
                    </Grid>
                    <Grid size={12}>
                      <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        disabled={loading || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
                      >
                        {loading ? <CircularProgress size={24} /> : 'Change Password'}
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </TabPanel>
              
              <TabPanel value={tabValue} index={3}>
                <Typography variant="h6" gutterBottom>
                  Notification Settings
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch 
                        checked={emailNotificationsEnabled} 
                        onChange={(e) => setEmailNotificationsEnabled(e.target.checked)} 
                      />
                    }
                    label="Email Notifications"
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
                    Receive email notifications about account activity, updates, and security alerts.
                  </Typography>
                </Box>
                
                <Typography variant="subtitle1" gutterBottom>
                  Notification Types
                </Typography>
                
                <Box>
                  {[
                    { id: 'security', label: 'Security Alerts', defaultChecked: true },
                    { id: 'updates', label: 'Product Updates', defaultChecked: true },
                    { id: 'usage', label: 'Usage Reports', defaultChecked: false },
                    { id: 'newsletter', label: 'Newsletter', defaultChecked: false },
                  ].map((item) => (
                    <FormControlLabel
                      key={item.id}
                      control={<Switch defaultChecked={item.defaultChecked} disabled={!emailNotificationsEnabled} />}
                      label={item.label}
                      sx={{ display: 'block', mb: 1 }}
                    />
                  ))}
                </Box>
                
                <Button 
                  variant="contained" 
                  color="primary"
                  sx={{ mt: 3 }}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} /> : 'Save Notification Settings'}
                </Button>
              </TabPanel>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </Container>
  );
};

export default AccountPage;