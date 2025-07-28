import React, { useState } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, InputAdornment,
  useTheme, useMediaQuery
} from '@mui/material';
import { Email, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { requestPasswordReset } from '../../api/authentication';
import logo from '../../assetsByteBridgeLightVersionLogo.png'; 

const PasswordReset: React.FC = () => {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simple email validation
    if (!email) {
      setFormError('Email address is required');
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);
    
    try {
      // Use the actual API
      const result = await requestPasswordReset(email);
      
      if (result.success) {
        setResetEmailSent(true);
      } else {
        setFormError(result.error || 'Failed to send reset email. Please try again.');
      }
    } catch (err: any) {
      console.error('Password reset error:', err);
      setFormError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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
                Reset Password
              </Typography>
              <Typography variant="body1">
                Enter your email to receive reset instructions
              </Typography>
            </Box>
          </Box>

          {/* Form Section */}
          <Box sx={{ p: isMobile ? 3 : 5 }}>
            {resetEmailSent ? (
              <Box sx={{ textAlign: 'center' }}>
                <Alert severity="success" sx={{ mb: 3 }}>
                  We've sent instructions to reset your password to {email}
                </Alert>
                <Typography variant="body1" paragraph>
                  Check your email inbox and follow the instructions to reset your password.
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  If you don't see the email in your inbox, please check your spam folder.
                </Typography>
                <Button
                  component={RouterLink}
                  to="/login"
                  variant="contained"
                  color="primary"
                  sx={{ mt: 2 }}
                  startIcon={<ArrowBackIcon />}
                >
                  Return to Login
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
                    id="email"
                    label="Email Address"
                    name="email"
                    autoComplete="email"
                    autoFocus
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Email color="action" />
                        </InputAdornment>
                      ),
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
                    {isSubmitting ? 'Sending...' : 'Send Reset Instructions'}
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

export default PasswordReset;