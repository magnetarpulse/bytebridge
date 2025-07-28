import React, { useState, useEffect } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, InputAdornment, IconButton,
  useTheme, useMediaQuery
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Lock, CheckCircle,
  ArrowBack as ArrowBackIcon 
} from '@mui/icons-material';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { validateResetToken, completePasswordReset } from '../../api/authentication';
import logo from '../../assets/ByteBridgeLightVersionLogo.png'; 

const ResetPasswordConfirm: React.FC = () => {
  const { uidb64, token } = useParams<{ uidb64: string; token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const cleanToken = token ? token.replace(/\/$/, '') : '';

  // Validate the token when component mounts
  useEffect(() => {
    const checkToken = async () => {
      if (!uidb64 || !cleanToken) {
        setIsValidToken(false);
        setIsValidating(false);
        return;
      }
  
      try {
        console.log("Validating token:", uidb64, cleanToken);
        const result = await validateResetToken(uidb64, cleanToken);
        console.log("Token validation result:", result);
        setIsValidToken(result.success);
      } catch (error) {
        console.error('Token validation error:', error);
        setIsValidToken(false);
      } finally {
        setIsValidating(false);
      }
    };
  
    checkToken();
  }, [uidb64, cleanToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Form validation
    if (!password || !confirmPassword) {
      setFormError('Both fields are required');
      return;
    }
    
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    
    // Password strength validation
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long');
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);
    
    try {
      if (!uidb64 || !cleanToken) {
        throw new Error('Invalid reset link');
      }
      
      const result = await completePasswordReset(uidb64, cleanToken, password, confirmPassword);
      
      if (result.success) {
        setIsComplete(true);
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } else {
        setFormError(result.error || 'Failed to reset password. Please try again.');
      }
    } catch (err: any) {
      console.error('Password reset error:', err);
      setFormError(err instanceof Error ? err.message: 'Failed to reset password. Please try again.');
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

  // Show loading during token validation
  if (isValidating) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

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
                {isComplete ? 'Password Reset Complete' : 'Reset Password'}
              </Typography>
              <Typography variant="body1">
                {isComplete 
                  ? 'Your password has been successfully reset' 
                  : isValidToken 
                    ? 'Enter your new password below'
                    : 'Invalid or expired reset link'
                }
              </Typography>
            </Box>
          </Box>

          {/* Form Section */}
          <Box sx={{ p: isMobile ? 3 : 5 }}>
            {isComplete ? (
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
                  <CheckCircle sx={{ fontSize: 60, color: 'success.main' }} />
                </Box>
                <Alert severity="success" sx={{ mb: 3 }}>
                  Password successfully reset! You can now log in with your new password.
                </Alert>
                <Typography variant="body2" color="text.secondary" paragraph>
                  You will be redirected to the login page in a few seconds...
                </Typography>
                <Button
                  component={RouterLink}
                  to="/login"
                  variant="contained"
                  color="primary"
                  sx={{ mt: 2 }}
                >
                  Login Now
                </Button>
              </Box>
            ) : !isValidToken ? (
              <Box sx={{ textAlign: 'center' }}>
                <Alert severity="error" sx={{ mb: 3 }}>
                  Your password reset link is invalid or has expired.
                </Alert>
                <Typography variant="body1" paragraph>
                  Please request a new password reset link.
                </Typography>
                <Button
                  component={RouterLink}
                  to="/password-reset"
                  variant="contained"
                  color="primary"
                  sx={{ mt: 2 }}
                >
                  Request New Reset Link
                </Button>
              </Box>
            ) : (
              <>
                {formError && (
                  <Alert severity="error" sx={{ mb: 3, width: '100%' }}>
                    {formError}
                  </Alert>
                )}
                
                <Box component="form" onSubmit={handleSubmit}>
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="password"
                    label="New Password"
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                  
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    size="large"
                    disabled={isSubmitting}
                    sx={{ 
                      py: 1.5,
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      borderRadius: 2,
                      position: 'relative',
                      mb: 2
                    }}
                  >
                    {isSubmitting ? 'Resetting Password...' : 'Reset Password'}
                    {isSubmitting && (
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
                      to="/login"
                      variant="body2"
                      sx={{ 
                        color: 'primary.main', 
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textDecoration: 'none',
                        '&:hover': {
                          textDecoration: 'underline'
                        }
                      }}
                    >
                      <ArrowBackIcon fontSize="small" sx={{ mr: 0.5 }} />
                      Back to Login
                    </Link>
                  </Box>
                </Box>
              </>
            )}
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

export default ResetPasswordConfirm;