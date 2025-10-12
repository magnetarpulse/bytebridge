import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Paper, Alert, 
  CircularProgress, Link, Divider, InputAdornment, IconButton,
  useTheme, useMediaQuery, FormControlLabel, Checkbox, Grid
} from '@mui/material';
import { 
  Visibility, VisibilityOff, Person, Lock, Email
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

const ANIMATION_CONFIG = {
  NODE_COUNT: 12,
  ANIMATION_SPEED: 0.005,
  CONNECTION_COUNT: 18,
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
  store: 'rgba(100, 181, 246, {opacity})',
  user: 'rgba(13, 71, 161, {opacity})',
  manager: 'rgba(25, 118, 210, {opacity})'
} as const;

const BRAND = {
  NAME: 'NeuroController',
  TAGLINE: 'Interact with Various Data Sources Seamlessly',
  FEATURES: [
    'Connect to various ByteBridge instances',
    'Preview data from multiple sources',
  ]
} as const;

const STATUS_MESSAGES = [
  'Storing data',
  'Processing',
  'Received data',
  'Syncing',
  'Visualizing',
  'Analyzing',
  'Caching',
  'Indexing',
  'Compressing',
  'Encrypting'
];

const NODE_TYPE_LABELS = {
  upload: 'Uploading',
  process: 'Processing',
  store: 'Storing',
  user: 'User',
  manager: 'NeuroController'
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


interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  type: 'upload' | 'process' | 'store' | 'user' | 'manager';
  connectionProgress?: number;
  pulsePhase?: number;
  id: string;
}

interface Connection {
  from: number;
  to: number;
  progress: number;
  throughManager?: boolean;
}

interface StatusMessage {
  id: string;
  nodeId: string;
  text: string;
  age: number;
  maxAge: number;
}

interface DataVisualizationProps {
  nodeCount?: number;
  animationSpeed?: number;
  colors?: {
    upload: string;
    process: string;
    store: string;
    user: string;
    manager: string;
  };
}

interface SocialLoginButtonsProps {
  onSocialLogin: (provider: string) => void;
  isMobile?: boolean;
}


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
          Or register with
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


const DataVisualization: React.FC<DataVisualizationProps> = memo(({
  nodeCount = ANIMATION_CONFIG.NODE_COUNT,
  animationSpeed = ANIMATION_CONFIG.ANIMATION_SPEED,
  colors = COLORS
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const connectionsRef = useRef<Connection[]>([]);
  const timeRef = useRef(0);
  const userNodeRef = useRef<Node | null>(null);
  const managerNodeRef = useRef<Node | null>(null);
  const statusMessagesRef = useRef<StatusMessage[]>([]);
  const lastDataFlowRef = useRef(0);
  const lastConnectionChangeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Initialize manager (NeuroController) node at center
    managerNodeRef.current = {
      id: 'manager',
      x: canvas.width * 0.5,
      y: canvas.height * 0.5,
      vx: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX * 0.2,
      vy: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX * 0.2,
      radius: 8,
      opacity: 0.85,
      type: 'manager',
      pulsePhase: 0
    };

    // Initialize regular nodes (ByteBridge instances)
    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      id: `node-${i}`,
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX,
      vy: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX,
      radius: Math.random() * (ANIMATION_CONFIG.RADIUS.MAX - ANIMATION_CONFIG.RADIUS.MIN) + ANIMATION_CONFIG.RADIUS.MIN,
      opacity: Math.random() * ANIMATION_CONFIG.OPACITY.RANGE + ANIMATION_CONFIG.OPACITY.BASE,
      type: ['upload', 'process', 'store'][Math.floor(Math.random() * 3)] as 'upload' | 'process' | 'store',
      pulsePhase: Math.random() * Math.PI * 2,
      connectionProgress: Math.random()
    }));
    nodesRef.current = nodes;

    // Initialize peer-to-peer connections (majority) and occasional manager connections
    const connections = Array.from({ length: ANIMATION_CONFIG.CONNECTION_COUNT }, () => {
      const throughManager = Math.random() < 0.15; 
      return {
        from: Math.floor(Math.random() * nodes.length),
        to: Math.floor(Math.random() * nodes.length),
        progress: Math.random(),
        throughManager
      };
    });
    connectionsRef.current = connections;

    const drawStatusMessage = (msg: StatusMessage) => {
      const node = [...nodesRef.current, userNodeRef.current, managerNodeRef.current]
        .find(n => n?.id === msg.nodeId);
      if (!node) return;

      const opacity = msg.age < 20
        ? msg.age / 20
        : msg.age > msg.maxAge - 30
          ? (msg.maxAge - msg.age) / 30
          : 1;

      const context = ctxRef.current;
      if (!context) return;

      context.save();
      context.globalAlpha = opacity; 
      const yOffset = Math.sin(msg.age * 0.05) * 2; 
      context.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const metrics = context.measureText(msg.text);
      const padding = 7;
      const bgWidth = metrics.width + padding * 2;
      const bgHeight = 20;
      const bgX = node.x - bgWidth / 2;
      const bgY = node.y - node.radius - 28 + yOffset; 

      context.shadowColor = 'rgba(0, 0, 0, 0.1)';
      context.shadowBlur = 8;
      context.shadowOffsetY = 2;

      const gradient = context.createLinearGradient(bgX, bgY, bgX, bgY + bgHeight);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#f8fafc');
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
      context.fill();

      context.strokeStyle = 'rgba(33, 150, 243, 0.2)';
      context.lineWidth = 1;
      context.stroke();

      context.shadowColor = 'transparent';
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;

      const textGradient = context.createLinearGradient(bgX, bgY, bgX + bgWidth, bgY);
      textGradient.addColorStop(0, '#455a64');
      textGradient.addColorStop(1, '#546e7a');
      context.fillStyle = textGradient;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(msg.text, node.x, bgY + bgHeight / 2);

      context.restore();
    };

    const drawNodeLabel = (node: Node) => {
      const context = ctxRef.current;
      if (!context) return;
      const label = NODE_TYPE_LABELS[node.type];
      context.save();
      context.globalAlpha = 0.4; 
      context.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const metrics = context.measureText(label);
      const padding = 5;
      const bgWidth = metrics.width + padding * 2;
      const bgHeight = 16;
      const bgX = node.x - bgWidth / 2;
      const bgY = node.y + node.radius + 8;

      // Subtle background
      context.fillStyle = 'rgba(255, 255, 255, 0.85)';
      context.beginPath();
      context.roundRect(bgX, bgY, bgWidth, bgHeight, 3);
      context.fill();

      // Subtle border
      context.strokeStyle = 'rgba(100, 100, 100, 0.15)';
      context.lineWidth = 0.5;
      context.stroke();

      // Text
      context.fillStyle = 'rgba(80, 80, 80, 0.8)';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, node.x, bgY + bgHeight / 2);

      context.restore();
    };

    const drawPermanentLabel = (x: number, y: number, text: string) => {
      const context = ctxRef.current;
      if (!context) return;

      context.save();
      context.globalAlpha = 1.0;

      // Calculate text metrics and position background
      context.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const metrics = context.measureText(text);
      const padding = 7;
      const bgWidth = metrics.width + padding * 2;
      const bgHeight = 20;
      const bgX = x - bgWidth / 2;
      // Position consistently relative to the node (e.g., below for manager, above for user)
      const bgY = y - 10 - bgHeight; 
      
      // Draw background with subtle shadow
      context.shadowColor = 'rgba(0, 0, 0, 0.1)';
      context.shadowBlur = 8;
      context.shadowOffsetY = 2;

      const gradient = context.createLinearGradient(bgX, bgY, bgX, bgY + bgHeight);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#f8fafc');
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
      context.fill();

      // Draw subtle border
      context.strokeStyle = 'rgba(33, 150, 243, 0.2)';
      context.lineWidth = 1;
      context.stroke();

      // Reset shadow for text
      context.shadowColor = 'transparent';
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;

      // Draw text with subtle gradient
      const textGradient = context.createLinearGradient(bgX, bgY, bgX + bgWidth, bgY);
      textGradient.addColorStop(0, '#455a64');
      textGradient.addColorStop(1, '#546e7a');
      context.fillStyle = textGradient;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, x, bgY + bgHeight / 2);

      context.restore();
    };

    const createDataFlow = () => {
      if (!managerNodeRef.current) return;
      const eligibleNodes = nodesRef.current.filter(n =>
        ['upload', 'process', 'store'].includes(n.type)
      );
      const count = Math.random() > 0.5 ? Math.floor(Math.random() * 2) + 2 : 2;
      const selectedNodes = [...eligibleNodes]
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(count, eligibleNodes.length));

      selectedNodes.forEach((node, idx) => {
        const message = STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)];
        statusMessagesRef.current.push({
          id: `msg-${Date.now()}-${idx}`,
          nodeId: node.id,
          text: message,
          age: 0,
          maxAge: 140 + Math.random() * 40
        });
      });
    };

    const animate = () => {
      const context = ctxRef.current;
      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);

      const managerNode = managerNodeRef.current;

      // Randomly change connection patterns every 180 frames (3 seconds at 60fps)
      if (timeRef.current - lastConnectionChangeRef.current > 180) {
        connectionsRef.current.forEach(conn => {
          // Randomly reassign some connections
          if (Math.random() < 0.3) { 
            conn.from = Math.floor(Math.random() * nodesRef.current.length);
            conn.to = Math.floor(Math.random() * nodesRef.current.length);
            conn.throughManager = Math.random() < 0.15;
            conn.progress = 0;
          }
        });
        lastConnectionChangeRef.current = timeRef.current;
      }

      // Draw hub connections, all nodes connected to manager
      if (managerNode) {
        nodesRef.current.forEach(node => {
          const gradient = context.createLinearGradient(node.x, node.y, managerNode.x, managerNode.y);
          gradient.addColorStop(0, `rgba(33, 150, 243, ${0.15 * node.opacity})`);
          gradient.addColorStop(1, `rgba(25, 118, 210, ${0.15 * managerNode.opacity})`);
          context.strokeStyle = gradient;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(managerNode.x, managerNode.y);
          context.stroke();
        });
      }

      // Draw peer-to-peer and manager-routed connections
      connectionsRef.current.forEach(conn => {
        const from = nodesRef.current[conn.from];
        const to = nodesRef.current[conn.to];
        if (!from || !to || conn.from === conn.to) return;

        if (conn.throughManager && managerNode) {
          // Connection through manager (two segments), purple
          const progressToManager = conn.progress < 0.5 ? conn.progress * 2 : 1;
          const progressFromManager = conn.progress >= 0.5 ? (conn.progress - 0.5) * 2 : 0;

          // First leg: from -> manager
          const gradient1 = context.createLinearGradient(from.x, from.y, managerNode.x, managerNode.y);
          gradient1.addColorStop(0, `rgba(156, 39, 176, ${0.2 * from.opacity})`);
          gradient1.addColorStop(progressToManager, `rgba(156, 39, 176, ${0.5 * from.opacity})`);
          gradient1.addColorStop(1, `rgba(123, 31, 162, ${0.2 * managerNode.opacity})`);
          context.strokeStyle = gradient1;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(managerNode.x, managerNode.y);
          context.stroke();

          // Packet on first leg
          if (progressToManager < 1) {
            const packet1X = from.x + (managerNode.x - from.x) * progressToManager;
            const packet1Y = from.y + (managerNode.y - from.y) * progressToManager;
            const packetGlow = context.createRadialGradient(packet1X, packet1Y, 0, packet1X, packet1Y, 5);
            packetGlow.addColorStop(0, 'rgba(156, 39, 176, 0.8)');
            packetGlow.addColorStop(1, 'rgba(156, 39, 176, 0)');
            context.fillStyle = packetGlow;
            context.beginPath();
            context.arc(packet1X, packet1Y, 5, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = 'rgba(156, 39, 176, 1)';
            context.beginPath();
            context.arc(packet1X, packet1Y, 2.5, 0, Math.PI * 2);
            context.fill();
          }

          // Second leg: manager -> to
          if (progressFromManager > 0) {
            const gradient2 = context.createLinearGradient(managerNode.x, managerNode.y, to.x, to.y);
            gradient2.addColorStop(0, `rgba(123, 31, 162, ${0.2 * managerNode.opacity})`);
            gradient2.addColorStop(progressFromManager, `rgba(156, 39, 176, ${0.5 * to.opacity})`);
            gradient2.addColorStop(1, `rgba(156, 39, 176, ${0.2 * to.opacity})`);
            context.strokeStyle = gradient2;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(managerNode.x, managerNode.y);
            context.lineTo(to.x, to.y);
            context.stroke();

            // Packet on second leg
            const packet2X = managerNode.x + (to.x - managerNode.x) * progressFromManager;
            const packet2Y = managerNode.y + (to.y - managerNode.y) * progressFromManager;
            const packetGlow = context.createRadialGradient(packet2X, packet2Y, 0, packet2X, packet2Y, 5);
            packetGlow.addColorStop(0, 'rgba(156, 39, 176, 0.8)');
            packetGlow.addColorStop(1, 'rgba(156, 39, 176, 0)');
            context.fillStyle = packetGlow;
            context.beginPath();
            context.arc(packet2X, packet2Y, 5, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = 'rgba(156, 39, 176, 1)';
            context.beginPath();
            context.arc(packet2X, packet2Y, 2.5, 0, Math.PI * 2);
            context.fill();
          }
        } else {
          // Direct peer-to-peer connection (main traffic), blue
          const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
          gradient.addColorStop(0, `rgba(33, 150, 243, ${0.2 * from.opacity})`);
          gradient.addColorStop(conn.progress, `rgba(33, 150, 243, ${0.4 * from.opacity})`);
          gradient.addColorStop(1, `rgba(33, 150, 243, ${0.2 * to.opacity})`);
          context.strokeStyle = gradient;
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();

          // Animated packet
          const packetX = from.x + (to.x - from.x) * conn.progress;
          const packetY = from.y + (to.y - from.y) * conn.progress;
          const packetGradient = context.createRadialGradient(packetX, packetY, 0, packetX, packetY, 4);
          packetGradient.addColorStop(0, `rgba(33, 150, 243, ${0.9 * from.opacity})`);
          packetGradient.addColorStop(1, `rgba(33, 150, 243, 0)`);
          context.fillStyle = packetGradient;
          context.beginPath();
          context.arc(packetX, packetY, 4, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = `rgba(33, 150, 243, ${0.95 * from.opacity})`;
          context.beginPath();
          context.arc(packetX, packetY, 2, 0, Math.PI * 2);
          context.fill();
        }

        conn.progress += animationSpeed * (0.8 + Math.random() * 0.4);
        if (conn.progress > 1) conn.progress = 0;
      });

      // Draw user node connection if it exists
      if (userNodeRef.current && managerNode && timeRef.current > 60) {
        const userNode = userNodeRef.current;
        const progress = Math.min(1, (userNode.connectionProgress || 0) + 0.015);
        userNode.connectionProgress = progress;
        const gradient = context.createLinearGradient(
          userNode.x, userNode.y, managerNode.x, managerNode.y
        );
        gradient.addColorStop(0, `rgba(13, 71, 161, ${0.5 * progress})`);
        gradient.addColorStop(progress * 0.5, `rgba(13, 71, 161, ${0.8 * progress})`);
        gradient.addColorStop(progress, `rgba(13, 71, 161, ${0.9 * progress})`);
        gradient.addColorStop(1, `rgba(25, 118, 210, ${0.4 * progress})`);
        context.strokeStyle = gradient;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(userNode.x, userNode.y);
        context.lineTo(managerNode.x, managerNode.y);
        context.stroke();

        if (progress === 1) {
          const packetProgress = (timeRef.current % 60) / 60;
          const packetX = userNode.x + (managerNode.x - userNode.x) * packetProgress;
          const packetY = userNode.y + (managerNode.y - userNode.y) * packetProgress;

          for (let i = 0; i < 4; i++) {
            const trailProgress = Math.max(0, packetProgress - i * 0.04);
            const trailX = userNode.x + (managerNode.x - userNode.x) * trailProgress;
            const trailY = userNode.y + (managerNode.y - userNode.y) * trailProgress;
            const trailOpacity = (1 - i * 0.25) * (trailProgress > 0 ? 1 : 0);
            context.fillStyle = `rgba(13, 71, 161, ${trailOpacity * 0.4})`;
            context.beginPath();
            context.arc(trailX, trailY, 2.5 + i * 0.5, 0, Math.PI * 2);
            context.fill();
          }

          context.fillStyle = 'rgba(13, 71, 161, 1)';
          context.beginPath();
          context.arc(packetX, packetY, 3.5, 0, Math.PI * 2);
          context.fill();

          const glowGradient = context.createRadialGradient(packetX, packetY, 0, packetX, packetY, 7);
          glowGradient.addColorStop(0, 'rgba(13, 71, 161, 0.5)');
          glowGradient.addColorStop(1, 'rgba(13, 71, 161, 0)');
          context.fillStyle = glowGradient;
          context.beginPath();
          context.arc(packetX, packetY, 7, 0, Math.PI * 2);
          context.fill();
        }
      }

      // Draw and update regular nodes
      nodesRef.current.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;

        // Keep nodes in bounds with padding
        const padding = 60;
        if (node.x < padding || node.x > canvas.width - padding) node.vx *= -1;
        if (node.y < padding || node.y > canvas.height - padding) node.vy *= -1;
        node.x = Math.max(padding, Math.min(canvas.width - padding, node.x));
        node.y = Math.max(padding, Math.min(canvas.height - padding, node.y));

        const nodeColor = colors[node.type].replace('{opacity}', node.opacity.toString());
        context.fillStyle = nodeColor;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();

        // Draw permanent subtle label
        drawNodeLabel(node);

        node.opacity += (Math.random() - 0.5) * 0.02;
        node.opacity = Math.max(ANIMATION_CONFIG.OPACITY.MIN, Math.min(ANIMATION_CONFIG.OPACITY.MAX, node.opacity));
      });

      // Draw manager node (NeuroController)
      if (managerNode) {
        managerNode.x += managerNode.vx;
        managerNode.y += managerNode.vy;
        if (managerNode.x < canvas.width * 0.3 || managerNode.x > canvas.width * 0.7) managerNode.vx *= -1;
        if (managerNode.y < canvas.height * 0.3 || managerNode.y > canvas.height * 0.7) managerNode.vy *= -1;
        managerNode.x = Math.max(canvas.width * 0.3, Math.min(canvas.width * 0.7, managerNode.x));
        managerNode.y = Math.max(canvas.height * 0.3, Math.min(canvas.height * 0.7, managerNode.y));

        const pulse = Math.sin(timeRef.current * 0.03) * 0.25 + 0.85;
        const outerGlow = context.createRadialGradient(
          managerNode.x, managerNode.y, 0,
          managerNode.x, managerNode.y, managerNode.radius + 8
        );
        outerGlow.addColorStop(0, `rgba(25, 118, 210, ${0.4 * pulse})`);
        outerGlow.addColorStop(0.5, `rgba(25, 118, 210, ${0.2 * pulse})`);
        outerGlow.addColorStop(1, 'rgba(25, 118, 210, 0)');
        context.fillStyle = outerGlow;
        context.beginPath();
        context.arc(managerNode.x, managerNode.y, managerNode.radius + 8, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = `rgba(25, 118, 210, ${0.6 * pulse})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(managerNode.x, managerNode.y, managerNode.radius + 3, 0, Math.PI * 2);
        context.stroke();

        const managerColor = colors.manager.replace('{opacity}', (managerNode.opacity * 1.1).toString());
        context.fillStyle = managerColor;
        context.beginPath();
        context.arc(managerNode.x, managerNode.y, managerNode.radius * pulse, 0, Math.PI * 2);
        context.fill();

        drawPermanentLabel(managerNode.x, managerNode.y, 'NeuroController');
      }

      // Draw user node
      if (userNodeRef.current) {
        const userNode = userNodeRef.current;
        userNode.x += userNode.vx;
        userNode.y += userNode.vy;

        // Keep user node in bounds with padding
        const padding = 80;
        if (userNode.x < padding || userNode.x > canvas.width - padding) userNode.vx *= -1;
        if (userNode.y < padding || userNode.y > canvas.height - padding) userNode.vy *= -1;
        userNode.x = Math.max(padding, Math.min(canvas.width - padding, userNode.x));
        userNode.y = Math.max(padding, Math.min(canvas.height - padding, userNode.y));

        const glowOpacity = Math.sin(timeRef.current * 0.06) * 0.4 + 0.7;
        const glow = context.createRadialGradient(
          userNode.x, userNode.y, 0,
          userNode.x, userNode.y, userNode.radius + 12
        );
        glow.addColorStop(0, `rgba(13, 71, 161, ${glowOpacity * 0.6})`);
        glow.addColorStop(0.4, `rgba(13, 71, 161, ${glowOpacity * 0.4})`);
        glow.addColorStop(1, 'rgba(13, 71, 161, 0)');
        context.fillStyle = glow;
        context.beginPath();
        context.arc(userNode.x, userNode.y, userNode.radius + 12, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = `rgba(13, 71, 161, ${glowOpacity * 0.7})`;
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(userNode.x, userNode.y, userNode.radius + 6, 0, Math.PI * 2);
        context.stroke();

        context.strokeStyle = `rgba(13, 71, 161, ${glowOpacity * 0.9})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(userNode.x, userNode.y, userNode.radius + 3, 0, Math.PI * 2);
        context.stroke();

        const userColor = colors.user.replace('{opacity}', '1');
        context.fillStyle = userColor;
        context.beginPath();
        context.arc(userNode.x, userNode.y, userNode.radius + 2, 0, Math.PI * 2);
        context.fill();

        drawPermanentLabel(userNode.x, userNode.y, 'Connecting...');
      }

      for (let i = statusMessagesRef.current.length - 1; i >= 0; i--) {
        const msg = statusMessagesRef.current[i];
        msg.age++;
        if (msg.age >= msg.maxAge) {
          statusMessagesRef.current.splice(i, 1);
        } else {
          drawStatusMessage(msg);
        }
      }

      timeRef.current++;
      if (timeRef.current === 60 && !userNodeRef.current) {
        userNodeRef.current = {
          id: 'user',
          x: canvas.width * 0.15,
          y: canvas.height * 0.5,
          vx: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX * 0.5,
          vy: (Math.random() - 0.5) * ANIMATION_CONFIG.VELOCITY.MAX * 0.5,
          radius: 7,
          opacity: 1,
          type: 'user',
          connectionProgress: 0,
          pulsePhase: 0
        };
      }
      if (managerNode && timeRef.current - lastDataFlowRef.current > 120) {
        createDataFlow();
        lastDataFlowRef.current = timeRef.current;
      }
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


const ErrorDisplay: React.FC<{ error: string | null }> = memo(({ error }) => {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
      {error}
    </Alert>
  );
});

ErrorDisplay.displayName = 'ErrorDisplay';


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
          Create an account to get started
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
        Create account
      </Typography>
      <Typography 
        variant="body2" 
        color="text.secondary"
        sx={{ mb: 4 }}
      >
        Join {BRAND.NAME} to get started
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


const SignInLink: React.FC = memo(() => (
  <Box sx={{ textAlign: 'center' }}>
    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
      Already have an account?{' '}
      <Link 
        component={RouterLink as any} 
        to="/login" 
        sx={{ 
          color: 'primary.main', 
          fontWeight: 600,
          textDecoration: 'none',
          '&:hover': { textDecoration: 'underline' }
        }}
      >
        Sign in
      </Link>
    </Typography>
  </Box>
));

SignInLink.displayName = 'SignInLink';


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


const RegistrationForm: React.FC<{
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isMobile?: boolean;
  onSocialLogin: (provider: string) => void; 
}> = memo((props) => (
  <Box component="form" onSubmit={props.onSubmit}>
    <TextField
      margin="normal"
      required
      fullWidth
      id="username"
      label="Username"
      name="username"
      autoComplete="username"
      autoFocus
      value={props.username}
      onChange={(e) => props.onUsernameChange(e.target.value)}
      disabled={props.loading}
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
      id="email"
      label="Email Address"
      name="email"
      autoComplete="email"
      type="email"
      value={props.email}
      onChange={(e) => props.onEmailChange(e.target.value)}
      disabled={props.loading}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Email color="action" />
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
      type={props.showPassword ? 'text' : 'password'}
      id="password"
      autoComplete="new-password"
      value={props.password}
      onChange={(e) => props.onPasswordChange(e.target.value)}
      disabled={props.loading}
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
                onClick={props.onTogglePassword}
                edge="end"
                size="small"
              >
                {props.showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
          sx: {
            "& input[type='password']::-ms-reveal": {
              display: "none !important"
            },
            "& input::-ms-clear": {
              display: "none !important"
            },
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
      type={props.showConfirmPassword ? 'text' : 'password'}
      id="confirmPassword"
      autoComplete="new-password"
      value={props.confirmPassword}
      onChange={(e) => props.onConfirmPasswordChange(e.target.value)}
      disabled={props.loading}
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
                onClick={props.onToggleConfirmPassword}
                edge="end"
                size="small"
              >
                {props.showConfirmPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
          sx: {
            "& input[type='password']::-ms-reveal": {
              display: "none !important"
            },
            "& input::-ms-clear": {
              display: "none !important"
            },
          }
        }
      }}
      sx={{ mb: 2 }}
    />
    <SocialLoginButtons onSocialLogin={props.onSocialLogin} isMobile={props.isMobile} />
    <FormControlLabel
      control={
        <Checkbox 
          id="terms"
          name="terms"
          color="primary"
          disabled={props.loading}
        />
      }
      label={
        <Typography variant="body2">
          I agree to the{' '}
          <Link 
            component={RouterLink as any} 
            to="/terms" 
            sx={{ 
              color: 'primary.main',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' }
            }}
          >
            Terms of Service
          </Link>
          {' '}and{' '}
          <Link 
            component={RouterLink as any} 
            to="/privacy" 
            sx={{ 
              color: 'primary.main',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' }
            }}
          >
            Privacy Policy
          </Link>
        </Typography>
      }
      sx={{ mb: props.isMobile ? 2 : 3 }}
    />
    <Button
      type="submit"
      fullWidth
      variant="contained"
      size="large"
      disabled={props.loading}
      sx={{ 
        py: 1.5,
        mb: props.isMobile ? 2 : 3,
        fontSize: '0.9375rem',
        fontWeight: 600,
        textTransform: 'none',
        position: 'relative'
      }}
    >
      {props.loading ? 'Creating account...' : 'Create account'}
      {props.loading && (
        <CircularProgress 
          size={20} 
          color="inherit" 
          sx={{ position: 'absolute', right: 16 }}
        />
      )}
    </Button>
  </Box>
));

RegistrationForm.displayName = 'RegistrationForm';


const MobileRegisterView: React.FC<{
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  loading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
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
          <RegistrationForm {...props} isMobile onSocialLogin={props.onSocialLogin} /> {/* Pass onSocialLogin */}
          <SignInLink />
        </Box>
      </Paper>
      <Box sx={{ mt: 3 }}>
        <Footer />
      </Box>
    </Container>
  </Box>
));

MobileRegisterView.displayName = 'MobileRegisterView';


const DesktopRegisterView: React.FC<{
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  loading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
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
          <RegistrationForm {...props} onSocialLogin={props.onSocialLogin} /> {/* Pass onSocialLogin */}
          <SignInLink />
          <Box sx={{ mt: 5 }}>
            <Footer />
          </Box>
        </Box>
      </Grid>
    </Grid>
  </Box>
));

DesktopRegisterView.displayName = 'DesktopRegisterView';


const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, error, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const loading = isSubmitting;

  // Mock social login handler
  const handleSocialLogin = useCallback((provider: string) => {
    console.log(`Social registration with ${provider}, this is a placeholder.`);
    // TODO: Trigger the OAuth flow
  }, []);

  const displayError = formError || error;

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password || !confirmPassword) {
      setFormError('All fields are required');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
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
      const success = await register(username, email, password);
      if (!success) {
        // Error will be displayed via context error state
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      setFormError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [username, email, password, confirmPassword, register]);

  const commonProps = {
    username,
    email,
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    loading,
    error: displayError,
    onUsernameChange: setUsername,
    onEmailChange: setEmail,
    onPasswordChange: setPassword,
    onConfirmPasswordChange: setConfirmPassword,
    onTogglePassword: () => setShowPassword(!showPassword),
    onToggleConfirmPassword: () => setShowConfirmPassword(!showConfirmPassword),
    onSubmit: handleSubmit,
    onSocialLogin: handleSocialLogin 
  };

  return isMobile ? <MobileRegisterView {...commonProps} /> : <DesktopRegisterView {...commonProps} />;
};

export default Register;