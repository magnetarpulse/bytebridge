import React, { useState, useEffect, useCallback, memo } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, InputAdornment, IconButton,
  useTheme, useMediaQuery, Grid
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Lock, CheckCircle,
  ArrowBack as ArrowBackIcon 
} from '@mui/icons-material';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { validateResetToken, completePasswordReset } from '../../api/authentication';

const BRAND = {
  NAME: 'NeuroController'
} as const;

const FORM_VALIDATION = {
  REQUIRED_FIELDS_ERROR: 'Both fields are required',
  PASSWORDS_MISMATCH: 'Passwords do not match',
  MIN_LENGTH_ERROR: 'Password must be at least 8 characters long',
  MIN_LENGTH: 8
} as const;

interface ErrorDisplayProps {
  error: string | null;
}

interface PasswordFieldsProps {
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  isSubmitting: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
}

interface SuccessStateProps {
  onNavigateToLogin: () => void;
}

interface InvalidTokenProps {
  onNavigateToReset: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = memo(({ error }) => {
  if (!error) return null;

  return (
    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
      {error}
    </Alert>
  );
});

ErrorDisplay.displayName = 'ErrorDisplay';


const PasswordFields: React.FC<PasswordFieldsProps> = memo(({
  password,
  confirmPassword,
  showPassword,
  showConfirmPassword,
  isSubmitting,
  onPasswordChange,
  onConfirmPasswordChange,
  onTogglePassword,
  onToggleConfirmPassword
}) => (
  <>
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
      onChange={(e) => onPasswordChange(e.target.value)}
      disabled={isSubmitting}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Lock color="action" />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label="toggle password visibility"
                onClick={onTogglePassword}
                edge="end"
                size="small"
              >
                {showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
          sx: {
            "& input[type='password']::-ms-reveal": {
              display: "none !important"
            },
            "& input::-ms-clear": {
              display: "none !important"
            }
          }
        }
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
      onChange={(e) => onConfirmPasswordChange(e.target.value)}
      disabled={isSubmitting}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Lock color="action" />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label="toggle password visibility"
                onClick={onToggleConfirmPassword}
                edge="end"
                size="small"
              >
                {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
          sx: {
            "& input[type='password']::-ms-reveal": {
              display: "none !important"
            },
            "& input::-ms-clear": {
              display: "none !important"
            }
          }
        }
      }}
      sx={{ mb: 3 }}
    />
  </>
));

PasswordFields.displayName = 'PasswordFields';


const SuccessState: React.FC<SuccessStateProps> = memo(({ onNavigateToLogin }) => (
  <Box sx={{ textAlign: 'center' }}>
    <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
      <CheckCircle sx={{ fontSize: 60, color: 'success.main' }} />
    </Box>
    <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
      Your password has been successfully reset!
    </Alert>
    <Typography variant="body1" sx={{ mb: 4, color: 'text.primary' }}>
      You can now log in with your new password.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
      Redirecting to login in a few seconds...
    </Typography>
    <Button
      onClick={onNavigateToLogin}
      variant="contained"
      fullWidth
      size="large"
      sx={{ 
        py: 1.5,
        fontSize: '0.9375rem',
        fontWeight: 600,
        textTransform: 'none'
      }}
    >
      Go to Login Now
    </Button>
  </Box>
));

SuccessState.displayName = 'SuccessState';


const InvalidToken: React.FC<InvalidTokenProps> = memo(({ onNavigateToReset }) => (
  <Box sx={{ textAlign: 'center' }}>
    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
      Your password reset link is invalid or has expired.
    </Alert>
    <Typography variant="body1" sx={{ mb: 4, color: 'text.primary' }}>
      Please request a new password reset link to continue.
    </Typography>
    <Button
      onClick={onNavigateToReset}
      variant="contained"
      fullWidth
      size="large"
      sx={{ 
        py: 1.5,
        fontSize: '0.9375rem',
        fontWeight: 600,
        textTransform: 'none'
      }}
    >
      Request New Reset Link
    </Button>
  </Box>
));

InvalidToken.displayName = 'InvalidToken';


const BrandHeader: React.FC<{ isMobile?: boolean; isComplete?: boolean; isValidToken?: boolean | null }> = memo(({ 
  isMobile = false, 
  isComplete = false,
  isValidToken = true 
}) => {
  const title = isComplete ? 'Password Reset Complete' : 'Reset Password';
  const subtitle = isComplete 
    ? 'Your password has been successfully reset' 
    : isValidToken 
      ? 'Enter your new password below'
      : 'Invalid or expired reset link';

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
          {title}
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
        {title}
      </Typography>
      <Typography 
        variant="body2" 
        color="text.secondary"
        sx={{ mb: 4 }}
      >
        {subtitle}
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


const MobileResetConfirmView: React.FC<{
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  formError: string;
  isSubmitting: boolean;
  isComplete: boolean;
  isValidToken: boolean | null;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onNavigateToLogin: () => void;
  onNavigateToReset: () => void;
}> = memo((props) => (
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
        <BrandHeader isMobile isComplete={props.isComplete} isValidToken={props.isValidToken} />
        
        <Box sx={{ p: 3 }}>
          {props.isComplete ? (
            <SuccessState onNavigateToLogin={props.onNavigateToLogin} />
          ) : !props.isValidToken ? (
            <InvalidToken onNavigateToReset={props.onNavigateToReset} />
          ) : (
            <>
              <ErrorDisplay error={props.formError} />
              <Box component="form" onSubmit={props.onSubmit}>
                <PasswordFields
                  password={props.password}
                  confirmPassword={props.confirmPassword}
                  showPassword={props.showPassword}
                  showConfirmPassword={props.showConfirmPassword}
                  isSubmitting={props.isSubmitting}
                  onPasswordChange={props.onPasswordChange}
                  onConfirmPasswordChange={props.onConfirmPasswordChange}
                  onTogglePassword={props.onTogglePassword}
                  onToggleConfirmPassword={props.onToggleConfirmPassword}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  size="large"
                  disabled={props.isSubmitting}
                  sx={{ 
                    py: 1.5,
                    mb: 3,
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    textTransform: 'none',
                    position: 'relative'
                  }}
                >
                  {props.isSubmitting ? 'Resetting Password...' : 'Reset Password'}
                  {props.isSubmitting && (
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
          )}
        </Box>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <Footer />
      </Box>
    </Container>
  </Box>
));

MobileResetConfirmView.displayName = 'MobileResetConfirmView';


const DesktopResetConfirmView: React.FC<{
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  formError: string;
  isSubmitting: boolean;
  isComplete: boolean;
  isValidToken: boolean | null;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onNavigateToLogin: () => void;
  onNavigateToReset: () => void;
}> = memo((props) => (
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
            Create a strong new password to secure your account. Your password must be at least 8 characters long.
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
          <BrandHeader isComplete={props.isComplete} isValidToken={props.isValidToken} />
          
          {props.isComplete ? (
            <SuccessState onNavigateToLogin={props.onNavigateToLogin} />
          ) : !props.isValidToken ? (
            <InvalidToken onNavigateToReset={props.onNavigateToReset} />
          ) : (
            <>
              <ErrorDisplay error={props.formError} />
              <Box component="form" onSubmit={props.onSubmit}>
                <PasswordFields
                  password={props.password}
                  confirmPassword={props.confirmPassword}
                  showPassword={props.showPassword}
                  showConfirmPassword={props.showConfirmPassword}
                  isSubmitting={props.isSubmitting}
                  onPasswordChange={props.onPasswordChange}
                  onConfirmPasswordChange={props.onConfirmPasswordChange}
                  onTogglePassword={props.onTogglePassword}
                  onToggleConfirmPassword={props.onToggleConfirmPassword}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  size="large"
                  disabled={props.isSubmitting}
                  sx={{ 
                    py: 1.5,
                    mb: 3,
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    textTransform: 'none',
                    position: 'relative'
                  }}
                >
                  {props.isSubmitting ? 'Resetting Password...' : 'Reset Password'}
                  {props.isSubmitting && (
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
          )}
          
          <Box sx={{ mt: 5 }}>
            <Footer />
          </Box>
        </Box>
      </Grid>
    </Grid>
  </Box>
));

DesktopResetConfirmView.displayName = 'DesktopResetConfirmView';


const ConfirmPasswordReset: React.FC = () => {
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
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
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
        const result = await validateResetToken(uidb64, cleanToken);
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

  const handleTogglePassword = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  const handleToggleConfirmPassword = useCallback(() => {
    setShowConfirmPassword(prev => !prev);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password || !confirmPassword) {
      setFormError(FORM_VALIDATION.REQUIRED_FIELDS_ERROR);
      return;
    }
    
    if (password !== confirmPassword) {
      setFormError(FORM_VALIDATION.PASSWORDS_MISMATCH);
      return;
    }
    
    if (password.length < FORM_VALIDATION.MIN_LENGTH) {
      setFormError(FORM_VALIDATION.MIN_LENGTH_ERROR);
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
  }, [password, confirmPassword, uidb64, cleanToken, navigate]);

  if (isValidating) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const commonProps = {
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    formError,
    isSubmitting,
    isComplete,
    isValidToken,
    onPasswordChange: setPassword,
    onConfirmPasswordChange: setConfirmPassword,
    onTogglePassword: handleTogglePassword,
    onToggleConfirmPassword: handleToggleConfirmPassword,
    onSubmit: handleSubmit,
    onNavigateToLogin: () => navigate('/login'),
    onNavigateToReset: () => navigate('/password-reset')
  };

  return isMobile ? <MobileResetConfirmView {...commonProps} /> : <DesktopResetConfirmView {...commonProps} />;
};

export default ConfirmPasswordReset;