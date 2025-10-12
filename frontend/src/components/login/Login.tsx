import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, Divider, InputAdornment, IconButton,
  useTheme, useMediaQuery, Grid
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Person, Lock
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

const ANIMATION_CONFIG = {
  NODE_COUNT: 15,
  ANIMATION_SPEED: 0.005,
  CONNECTION_COUNT: 20,
  OPACITY: {
    MIN: 0.2,
    MAX: 0.8,
    BASE: 0.3,
    RANGE: 0.5
  },
  VELOCITY: {
    MAX: 0.5
  },
  RADIUS: {
    MIN: 2,
    MAX: 5
  },
  CANVAS_OPACITY: 0.6
} as const;

const COLORS = {
  upload: 'rgba(33, 150, 243, {opacity})',
  process: 'rgba(66, 165, 245, {opacity})',
  store: 'rgba(100, 181, 246, {opacity})'
} as const;

const BRAND = {
  NAME: 'ByteBridge',
  TAGLINE: 'Visualize, Store, and Analyze Your Data',
  FEATURES: [
    'Secure cloud storage',
    'Interactive visualizations'
  ]
} as const;

const SOCIAL_PROVIDERS = [
  {
    id: 'google',
    name: 'Google',
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, marginRight: 4 }}>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
    hoverColor: '#DB4437'
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, marginRight: 4 }}>
        <path fill="currentColor" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/>
      </svg>
    ),
    hoverColor: '#333'
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, marginRight: 4 }}>
        <path fill="#f25022" d="M1 1h10v10H1z"/>
        <path fill="#00a4ef" d="M13 1h10v10H13z"/>
        <path fill="#7fba00" d="M1 13h10v10H1z"/>
        <path fill="#ffb900" d="M13 13h10v10H13z"/>
      </svg>
    ),
    hoverColor: '#00A4EF'
  },
  {
    id: 'apple',
    name: 'Apple',
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, marginRight: 4 }}>
        <path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
    ),
    hoverColor: '#000'
  }
] as const;

const FORM_VALIDATION = {
  REQUIRED_FIELDS_ERROR: 'Username and password are required'
} as const;

interface DataVisualizationProps {
  nodeCount?: number;
  animationSpeed?: number;
  colors?: {
    upload: string;
    process: string;
    store: string;
  };
}

interface LoginFormProps {
  username: string;
  password: string;
  showPassword: boolean;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isMobile?: boolean;
}

interface SocialLoginButtonsProps {
  onSocialLogin: (provider: string) => void;
  isMobile?: boolean;
}

interface ErrorDisplayProps {
  error: string | null;
}

const DataVisualization: React.FC<DataVisualizationProps> = memo(({
  nodeCount = ANIMATION_CONFIG.NODE_COUNT,
  animationSpeed = ANIMATION_CONFIG.ANIMATION_SPEED,
  colors = COLORS
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctxRef.current = ctx;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Initialize nodes
    const nodes = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX,
      vy: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX,
      radius: Math.random() * (ANIMATION_CONFIG.RADIUS.MAX - ANIMATION_CONFIG.RADIUS.MIN) + ANIMATION_CONFIG.RADIUS.MIN,
      opacity: Math.random() * ANIMATION_CONFIG.OPACITY.RANGE + ANIMATION_CONFIG.OPACITY.BASE,
      type: ['upload', 'process', 'store'][Math.floor(Math.random() * 3)] as 'upload' | 'process' | 'store'
    }));

    // Initialize connections
    const connections = Array.from({ length: Math.min(ANIMATION_CONFIG.CONNECTION_COUNT, nodes.length * 2) }, () => ({
      from: Math.floor(Math.random() * nodes.length),
      to: Math.floor(Math.random() * nodes.length),
      progress: Math.random()
    }));

    const animate = () => {
      const context = ctxRef.current;
      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connections with animated data packets
      connections.forEach(conn => {
        const from = nodes[conn.from];
        const to = nodes[conn.to];

        if (from && to) {
          const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
          gradient.addColorStop(0, `rgba(33, 150, 243, ${0.1 * from.opacity})`);
          gradient.addColorStop(conn.progress, `rgba(33, 150, 243, ${0.3 * from.opacity})`);
          gradient.addColorStop(1, `rgba(33, 150, 243, ${0.1 * to.opacity})`);

          context.strokeStyle = gradient;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();

          // Animated packet
          const packetX = from.x + (to.x - from.x) * conn.progress;
          const packetY = from.y + (to.y - from.y) * conn.progress;

          context.fillStyle = `rgba(33, 150, 243, ${0.8 * from.opacity})`;
          context.beginPath();
          context.arc(packetX, packetY, 2, 0, Math.PI * 2);
          context.fill();

          conn.progress += animationSpeed;
          if (conn.progress > 1) conn.progress = 0;
        }
      });

      // Draw and update nodes
      nodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;

        // Boundary collision
        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;

        node.x = Math.max(0, Math.min(canvas.width, node.x));
        node.y = Math.max(0, Math.min(canvas.height, node.y));

        // Draw node
        const nodeColor = colors[node.type].replace('{opacity}', node.opacity.toString());
        context.fillStyle = nodeColor;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();

        // Pulsing effect
        node.opacity += (Math.random() - 0.5) * 0.02;
        node.opacity = Math.max(ANIMATION_CONFIG.OPACITY.MIN, Math.min(ANIMATION_CONFIG.OPACITY.MAX, node.opacity));
      });

      animationIdRef.current = requestAnimationFrame(animate);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animationIdRef.current) {
          cancelAnimationFrame(animationIdRef.current);
          animationIdRef.current = null;
        }
      } else if (animationIdRef.current === null) {
        animate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    animate();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [nodeCount, animationSpeed, colors]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: ANIMATION_CONFIG.CANVAS_OPACITY
      }}
    />
  );
});

DataVisualization.displayName = 'DataVisualization';


const ErrorDisplay: React.FC<ErrorDisplayProps> = memo(({ error }) => {
  if (!error) return null;

  return (
    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
      {error}
    </Alert>
  );
});

ErrorDisplay.displayName = 'ErrorDisplay';


const LoginForm: React.FC<LoginFormProps> = memo(({
  username,
  password,
  showPassword,
  loading,
  onUsernameChange,
  onPasswordChange,
  onTogglePasswordVisibility,
  onSubmit,
  isMobile = false
}) => {
  return (
    <Box component="form" onSubmit={onSubmit}>
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
        onChange={(e) => onUsernameChange(e.target.value)}
        disabled={loading}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Person color="action" />
              </InputAdornment>
            ),
          }
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
        onChange={(e) => onPasswordChange(e.target.value)}
        disabled={loading}
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
                  onClick={onTogglePasswordVisibility}
                  edge="end"
                  size="small"
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
            sx: {
              "& input[type='password']::-ms-reveal": {
                display: "none !important"   // Hide the default reveal button on MSEdge
              },
              "& input::-ms-clear": {
                display: "none !important"   // Hide the default clear button on MSEdge
              },
            }
          }
        }}
        sx={{ mb: 2 }}
      />

      <Box sx={{ 
        display: 'flex', 
        justifyContent: isMobile ? 'flex-end' : 'space-between', 
        alignItems: 'center', 
        mb: isMobile ? 2 : 3 
      }}>
        {!isMobile && <Box />}
        <Link 
          component={RouterLink as any}
          to="/password-reset"
          variant="body2"
          sx={{ 
            color: 'primary.main', 
            fontWeight: 500,
            fontSize: '0.875rem',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' }
          }}
        >
          Forgot password?
        </Link>
      </Box>
      
      <Button
        type="submit"
        fullWidth
        variant="contained"
        size="large"
        disabled={loading}
        sx={{ 
          py: 1.5,
          mb: isMobile ? 2 : 3,
          fontSize: '0.9375rem',
          fontWeight: 600,
          textTransform: 'none',
          position: 'relative'
        }}
      >
        {loading ? 'Signing in...' : 'Sign in'}
        {loading && (
          <CircularProgress 
            size={20} 
            color="inherit" 
            sx={{ position: 'absolute', right: 16 }}
          />
        )}
      </Button>
    </Box>
  );
});

LoginForm.displayName = 'LoginForm';


const SocialLoginButtons: React.FC<SocialLoginButtonsProps> = memo(({ 
  onSocialLogin,
  isMobile = false 
}) => {
  return (
    <>
      <Divider sx={{ my: isMobile ? 2 : 3 }}>
        <Typography 
          variant="body2" 
          color="text.secondary"
          sx={{ fontSize: isMobile ? '0.75rem' : '0.8125rem' }}
        >
          Or continue with
        </Typography>
      </Divider>

      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: 1.5, 
        mb: isMobile ? 2 : 3 
      }}>
        {SOCIAL_PROVIDERS.map((provider) => (
          <Button
            key={provider.id}
            variant="outlined"
            onClick={() => onSocialLogin(provider.id)}
            sx={{
              py: isMobile ? 1 : 1.2,
              textTransform: 'none',
              fontSize: '0.875rem',
              borderColor: 'divider',
              '&:hover': {
                borderColor: provider.hoverColor,
                backgroundColor: `${provider.hoverColor}0A`,
              }
            }}
          >
            {provider.icon}
            {provider.name}
          </Button>
        ))}
      </Box>
    </>
  );
});

SocialLoginButtons.displayName = 'SocialLoginButtons';


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
          Sign in to access your dashboard
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
        Welcome back
      </Typography>
      <Typography 
        variant="body2" 
        color="text.secondary"
        sx={{ mb: 4 }}
      >
        Sign in to access your dashboard
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


const SignUpLink: React.FC = memo(() => (
  <Box sx={{ textAlign: 'center' }}>
    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
      Don't have an account?{' '}
      <Link 
        component={RouterLink as any} 
        to="/register" 
        sx={{ 
          color: 'primary.main', 
          fontWeight: 600,
          textDecoration: 'none',
          '&:hover': { textDecoration: 'underline' }
        }}
      >
        Create account
      </Link>
    </Typography>
  </Box>
));

SignUpLink.displayName = 'SignUpLink';


const VisualizationSection: React.FC = memo(() => (
  <Grid size={{ xs: 12, md: 7 }} sx={{ position: 'relative', overflow: 'hidden', backgroundColor: '#ffffff' }}>
    <DataVisualization />
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        px: 6,
        py: 8
      }}
    >
      <Typography 
        variant="h3" 
        fontWeight={700}
        sx={{ color: '#1976d2', mb: 2, textAlign: 'center' }}
      >
        {BRAND.NAME}
      </Typography>
      <Typography 
        variant="h6" 
        color="text.secondary"
        sx={{ mb: 4, textAlign: 'center', maxWidth: 500 }}
      >
        {BRAND.TAGLINE}
      </Typography>
      <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
        {BRAND.FEATURES.map((feature, index) => (
          <Typography key={index} variant="body1" sx={{ mb: 1 }}>
            ✓ {feature}
          </Typography>
        ))}
      </Box>
    </Box>
  </Grid>
));

VisualizationSection.displayName = 'VisualizationSection';


const MobileLoginView: React.FC<{
  username: string;
  password: string;
  showPassword: boolean;
  loading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onSocialLogin: (provider: string) => void;
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
        <BrandHeader isMobile />
        
        <Box sx={{ p: 3 }}>
          <ErrorDisplay error={props.error} />
          <LoginForm {...props} isMobile />
          <SocialLoginButtons onSocialLogin={props.onSocialLogin} isMobile />
          <SignUpLink />
        </Box>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <Footer />
      </Box>
    </Container>
  </Box>
));

MobileLoginView.displayName = 'MobileLoginView';


const DesktopLoginView: React.FC<{
  username: string;
  password: string;
  showPassword: boolean;
  loading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onSocialLogin: (provider: string) => void;
}> = memo((props) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', backgroundColor: '#f8fafc' }}>
    <Grid container sx={{ flex: 1 }}>
      <VisualizationSection />
      
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
          <ErrorDisplay error={props.error} />
          <LoginForm {...props} />
          <SocialLoginButtons onSocialLogin={props.onSocialLogin} />
          <SignUpLink />
          <Box sx={{ mt: 5 }}>
            <Footer />
          </Box>
        </Box>
      </Grid>
    </Grid>
  </Box>
));

DesktopLoginView.displayName = 'DesktopLoginView';


const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { login, loading: authLoading, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  const loading = isSubmitting || authLoading;
  const displayError = formError || error;

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      setFormError(FORM_VALIDATION.REQUIRED_FIELDS_ERROR);
      return;
    }
    
    setFormError('');
    setIsSubmitting(true);
    
    try {
      await login(username, password);
    } catch (err) {
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [username, password, login]);

  const handleTogglePasswordVisibility = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  const handleSocialLogin = useCallback((provider: string) => {
    console.log(`Social login with ${provider} - Mock implementation`);
  }, []);

  const commonProps = {
    username,
    password,
    showPassword,
    loading,
    error: displayError,
    onUsernameChange: setUsername,
    onPasswordChange: setPassword,
    onTogglePasswordVisibility: handleTogglePasswordVisibility,
    onSubmit: handleSubmit,
    onSocialLogin: handleSocialLogin
  };

  return isMobile ? <MobileLoginView {...commonProps} /> : <DesktopLoginView {...commonProps} />;
};

export default LoginPage;