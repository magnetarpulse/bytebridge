import React, { useState, useEffect } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, Divider, InputAdornment, IconButton,
  useTheme, useMediaQuery
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Person,
  Lock
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import LogoLightMode from '../../assets/ByteBridgeLightVersionLogo.png'; 
import LogoDarkMode from '../../assets/ByteBridgeLightVersionLogo.png';
import { useTheme as useCustomTheme } from '../../context/ThemeContext';


const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const { login, loading: authLoading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { mode } = useCustomTheme();
  const currentLogo = mode === 'light' ? LogoLightMode : LogoDarkMode;
  const loading = isSubmitting;

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simple form validation
    if (!username || !password) {
      setFormError('Username and password are required');
      return;
    }
    
    setFormError('');
    setIsSubmitting(true); 
    
    try {
      await login(username, password);
      // Don't navigate here, the useEffect will handle redirection if successful
    } catch (err) {
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <Box 
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.palette.grey[50],
        pt: 4,
        pb: 8
      }}
    >
      <Container maxWidth="sm">
        <Paper 
          elevation={3} 
          sx={{ 
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {/* Top Section with Logo */}
          <Box 
            sx={{
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              py: 2, 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              position: 'relative' 
            }}
          >
            <Box
              component="img"
              src={currentLogo} 
              alt="NeuroController Logo"
              sx={{ 
                height: 120, 
                width: 'auto',
                mb: 1, 
                objectFit: 'contain',
                maxWidth: '80%'
              }}
            />
            <Box sx={{ textAlign: 'center', mt: -5 }}> 
              <Typography variant="h4" fontWeight="bold" gutterBottom>
                ByteBridge
              </Typography>
              <Typography variant="body1">
                Sign in to continue to your dashboard
              </Typography>
            </Box>
          </Box>

          {/* Form Section */}
          <Box sx={{ p: isMobile ? 3 : 5 }}>
            {(error || formError) && (
              <Alert severity="error" sx={{ mb: 3, width: '100%' }}>
                {formError || error}
              </Alert>
            )}
            
            <Box component="form" onSubmit={handleSubmit}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="username"
                label="Username"
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Person color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 2 }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={handleTogglePasswordVisibility}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
                sx={{ mb: 3 }}
              />
              
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={loading || authLoading}  
                sx={{ 
                  py: 1.5,
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  borderRadius: 2,
                  position: 'relative'
                }}
              >
                {loading ? 'Signing In...' : 'Sign In'}
                {(loading || authLoading) && (
                  <CircularProgress 
                    size={24} 
                    color="inherit" 
                    sx={{ 
                      position: 'absolute',
                      right: theme.spacing(2)
                    }}
                  />
                )}
              </Button>
              
              <Box sx={{ mt: 3, textAlign: 'center' }}>
                <Link 
                  component={RouterLink}
                  to="/password-reset"
                  variant="body2"
                  sx={{ 
                    color: 'primary.main', 
                    fontWeight: 500,
                    textDecoration: 'none',
                    '&:hover': {
                      textDecoration: 'underline'
                    }
                  }}
                >
                  Forgot password?
                </Link>
              </Box>

              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  OR
                </Typography>
              </Divider>

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Don't have an account?{' '}
                  <Link 
                    component={RouterLink} 
                    to="/register" 
                    sx={{ 
                      color: 'primary.main', 
                      fontWeight: 500,
                      textDecoration: 'none',
                      '&:hover': {
                        textDecoration: 'underline'
                      }
                    }}
                  >
                    Register
                  </Link>
                </Typography>
              </Box>
            </Box>
          </Box>
        </Paper>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            &copy; {new Date().getFullYear()} NeuroController. All rights reserved.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default LoginPage;