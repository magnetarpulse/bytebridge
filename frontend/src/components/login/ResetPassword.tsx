import React, { useState, useCallback, memo } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, InputAdornment,  useTheme, useMediaQuery, Grid
} from '@mui/material';
import { Email, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { requestPasswordReset } from '../../api/authentication';

const BRAND = {
  NAME: 'NeuroController'
} as const;

const FORM_VALIDATION = {
  EMAIL_REQUIRED: 'Email address is required',
  INVALID_EMAIL: 'Please enter a valid email address',
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
} as const;

interface ResetContentProps {
  email: string;
  formError: string;
  isSubmitting: boolean;
  resetEmailSent: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isMobile?: boolean;
}

const ErrorDisplay: React.FC<{ error: string | null }> = memo(({ error }) => {
  if (!error) return null;

  return (
    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
      {error}
    </Alert>
  );
});

ErrorDisplay.displayName = 'ErrorDisplay';


const SuccessMessage: React.FC<{ email: string }> = memo(({ email }) => (
  <Box sx={{ textAlign: 'center' }}>
    <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
      We've sent password reset instructions to {email}
    </Alert>
    <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
      Check your email inbox and follow the instructions to reset your password.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
      If you don't see the email, please check your spam folder.
    </Typography>
    <Button
      component={RouterLink}
      to="/login"
      variant="contained"
      fullWidth
      size="large"
      startIcon={<ArrowBackIcon />}
      sx={{ 
        py: 1.5,
        fontSize: '0.9375rem',
        fontWeight: 600,
        textTransform: 'none'
      }}
    >
      Return to Login
    </Button>
  </Box>
));

SuccessMessage.displayName = 'SuccessMessage';


const ResetForm: React.FC<ResetContentProps> = memo(({
  email,
  formError,
  isSubmitting,
  onEmailChange,
  onSubmit,
  isMobile = false
}) => (
  <>
    <ErrorDisplay error={formError} />
    
    <Box component="form" onSubmit={onSubmit}>
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
        onChange={(e) => onEmailChange(e.target.value)}
        disabled={isSubmitting}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Email color="action" />
              </InputAdornment>
            ),
          }
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
          mb: 3,
          fontSize: '0.9375rem',
          fontWeight: 600,
          textTransform: 'none',
          position: 'relative'
        }}
      >
        {isSubmitting ? 'Sending...' : 'Send Reset Instructions'}
        {isSubmitting && (
          <CircularProgress 
            size={20} 
            color="inherit" 
            sx={{ position: 'absolute', right: 16 }}
          />
        )}
      </Button>
      
      <Box sx={{ textAlign: 'center' }}>
        <Link 
          component={RouterLink}
          to="/login"
          variant="body2"
          sx={{ 
            color: 'primary.main', 
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' }
          }}
        >
          <ArrowBackIcon sx={{ mr: 0.5, fontSize: '1.125rem' }} />
          Back to Login
        </Link>
      </Box>
    </Box>
  </>
));

ResetForm.displayName = 'ResetForm';


const BrandHeader: React.FC<{ isMobile?: boolean }> = memo(({ isMobile = false }) => {
  if (isMobile) {
    return (
      <Box 
        sx={{
          pt: 4,
          pb: 3,
          px: 3,
          textAlign: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Typography 
          variant="h5" 
          fontWeight={700}
          sx={{ color: '#1976d2', mb: 1 }}
        >
          {BRAND.NAME}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Reset Your Password
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Typography 
        variant="h5" 
        fontWeight={700}
        sx={{ mb: 1, color: 'text.primary' }}
      >
        Reset Password
      </Typography>
      <Typography 
        variant="body2" 
        color="text.secondary"
        sx={{ mb: 4 }}
      >
        Enter your email to receive reset instructions
      </Typography>
    </>
  );
});

BrandHeader.displayName = 'BrandHeader';


const Footer: React.FC = memo(() => (
  <Box sx={{ textAlign: 'center' }}>
    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
      © {new Date().getFullYear()} {BRAND.NAME}. All rights reserved.
    </Typography>
  </Box>
));

Footer.displayName = 'Footer';


const MobileResetView: React.FC<ResetContentProps & { resetEmailSent: boolean }> = memo((props) => (
  <Box 
    sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f8fafc',
      px: 2
    }}
  >
    <Container maxWidth="xs">
      <Paper 
        elevation={2}
        sx={{ borderRadius: 3, overflow: 'hidden', backgroundColor: 'background.paper' }}
      >
        <BrandHeader isMobile />
        
        <Box sx={{ p: 3 }}>
          {props.resetEmailSent ? (
            <SuccessMessage email={props.email} />
          ) : (
            <ResetForm {...props} isMobile />
          )}
        </Box>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <Footer />
      </Box>
    </Container>
  </Box>
));

MobileResetView.displayName = 'MobileResetView';


const DesktopResetView: React.FC<ResetContentProps & { resetEmailSent: boolean }> = memo((props) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', backgroundColor: '#f8fafc' }}>
    <Grid container sx={{ flex: 1 }}>
      <Grid 
        size={{ xs: 12, md: 7 }}
        sx={{ 
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Box
          sx={{
            textAlign: 'center',
            px: 6,
            py: 8
          }}
        >
          <Typography 
            variant="h3" 
            fontWeight={700}
            sx={{ color: '#1976d2', mb: 2 }}
          >
            {BRAND.NAME}
          </Typography>
          <Typography 
            variant="h6" 
            color="text.secondary"
            sx={{ mb: 4, maxWidth: 500 }}
          >
            Secure Password Reset
          </Typography>
          <Typography 
            variant="body1" 
            color="text.secondary"
            sx={{ maxWidth: 400, lineHeight: 1.8 }}
          >
            We'll send you an email with instructions to reset your password. Follow the link in the email to create a new password.
          </Typography>
        </Box>
      </Grid>
      
      <Grid 
        size={{ xs: 12, md: 5 }}
        sx={{ 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          backgroundColor: '#ffffff'
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 440 }}>
          <BrandHeader />
          {props.resetEmailSent ? (
            <SuccessMessage email={props.email} />
          ) : (
            <ResetForm {...props} />
          )}
          <Box sx={{ mt: 5 }}>
            <Footer />
          </Box>
        </Box>
      </Grid>
    </Grid>
  </Box>
));

DesktopResetView.displayName = 'DesktopResetView';


const ResetPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setFormError(FORM_VALIDATION.EMAIL_REQUIRED);
      return;
    }
    
    if (!FORM_VALIDATION.EMAIL_REGEX.test(email)) {
      setFormError(FORM_VALIDATION.INVALID_EMAIL);
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);
    
    try {
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
  }, [email]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    if (formError) setFormError('');
  }, [formError]);

  const commonProps = {
    email,
    formError,
    isSubmitting,
    resetEmailSent,
    onEmailChange: handleEmailChange,
    onSubmit: handleSubmit
  };

  return isMobile ? <MobileResetView {...commonProps} /> : <DesktopResetView {...commonProps} />;
};

export default ResetPassword;