import React, { useState, useEffect } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, Divider, InputAdornment, IconButton,
  useTheme, useMediaQuery, FormControlLabel, Checkbox
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Person, Lock, Email
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import logo from '../../assets/ByteBridgeLightVersionLogo.png'; 

const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { register, loading: authLoading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // Only use local loading state to prevent form disappearing
  const loading = isSubmitting;

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Form validation
    if (!username || !email || !password || !confirmPassword) {
      setFormError('All fields are required');
      return;
    }
    
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    
    if (!agreeToTerms) {
      setFormError('You must agree to the Terms and Privacy Policy');
      return;
    }
    
    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);
    
    try {
      // The register function returns a boolean indicating success/failure
      const success = await register(username, email, password);
      
      if (!success) {
        // If registration failed, the error will be in the context's error state
        // so we don't need to set formError here
        // The error from context will be displayed via the (error || formError) check in the JSX
      }
      // Successful registration will redirect via useEffect when isAuthenticated changes
    } catch (err: any) {
      console.error('Registration error:', err);
      setFormError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePassword = () => {
    setShowPassword(!showPassword);
  };

  const handleToggleConfirmPassword = () => {
    setShowConfirmPassword(!showConfirmPassword);
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
          {/* Top Section with Brand */}
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
              src={logo}
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
                Create an Account
              </Typography>
              <Typography variant="body1">
                Join ByteBridge to get started
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
                id="email"
                label="Email Address"
                name="email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Email color="action" />
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
                autoComplete="new-password"
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
                        onClick={handleTogglePassword}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
                sx={{ mb: 2 }}
              />
              
              <TextField
                margin="normal"
                required
                fullWidth
                name="confirmPassword"
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                        onClick={handleToggleConfirmPassword}
                        edge="end"
                      >
                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
                sx={{ mb: 3 }}
              />
              
              <FormControlLabel
                control={
                  <Checkbox 
                    checked={agreeToTerms}
                    onChange={(e) => setAgreeToTerms(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Typography variant="body2">
                    I agree to the {' '}
                    <Link component={RouterLink} to="/terms" sx={{ color: 'primary.main' }}>
                      Terms of Service
                    </Link>
                    {' '} and {' '}
                    <Link component={RouterLink} to="/privacy" sx={{ color: 'primary.main' }}>
                      Privacy Policy
                    </Link>
                  </Typography>
                }
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
                  position: 'relative',
                  mb: 2
                }}
              >
                {loading ? 'Creating Account...' : 'Create Account'}
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
              
              <Divider sx={{ my: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  OR
                </Typography>
              </Divider>

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Already have an account?{' '}
                  <Link 
                    component={RouterLink} 
                    to="/login" 
                    sx={{ 
                      color: 'primary.main', 
                      fontWeight: 500,
                      textDecoration: 'none',
                      '&:hover': {
                        textDecoration: 'underline'
                      }
                    }}
                  >
                    Sign In
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

export default Register;