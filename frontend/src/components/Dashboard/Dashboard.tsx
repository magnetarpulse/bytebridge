/**
 * @file Dashboard.tsx
 * @description Main dashboard layout component that provides the application shell
 * including the top navigation bar, collapsible sidebar, and content routing area.
 * Implements role-based access control and feature flag checks for route visibility.
 */

import React, { useState, Suspense, lazy, useCallback } from 'react';
import { 
  AppBar, Toolbar, Typography,
  IconButton, Tooltip, useMediaQuery, Box,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import Brightness4Icon from '@mui/icons-material/Brightness4';  
import Brightness7Icon from '@mui/icons-material/Brightness7';  
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchIcon from '@mui/icons-material/Search';
import Badge from '@mui/material/Badge';
import { Routes, Route } from 'react-router-dom';

// Custom components
import UserMenu from './UserMenu';
import Sidebar from './Sidebar';
import { useTheme } from '../../context/ThemeContext';
import FullPageSpinner from '../common/FullPageSpinner';
import { isFeatureEnabled } from '../../config/features';
import { useCan, PERMISSIONS_CONST } from '../../context/RBACContext';

/**
 * Lazy-loaded page components for code-splitting optimization.
 * Each route is loaded on-demand to reduce initial bundle size.
 */
const DashboardHome = lazy(() => import('../../pages/DashboardHome'));
const Teams = lazy(() => import('../../pages/Teams'));
const AccountPage = lazy(() => import('../Account/AccountPage'));
const AdminPage = lazy(() => import('../Admin/AdminPage'));
// const Upload = lazy(() => import('../Admin/Upload.legacy'));
const Upload = lazy(() => import('../upload/Upload'));
const NotFound = lazy(() => import('../../pages/NotFound'));

/**
 * Main dashboard component that provides the application layout shell.
 * 
 * Features:
 * - Responsive layout with collapsible sidebar
 * - Role-based access control for admin and upload routes
 * - Feature flag support for conditional route rendering
 * - Theme switching between light and dark modes
 * - Persistent sidebar state across sessions
 * - Code-split routes for optimal performance
 * 
 * @returns Dashboard layout with routing, navigation, and content area
 * 
 * @example
 * ```tsx
 * <Dashboard />
 * ```
 */
const Dashboard: React.FC = () => {
  /** Current theme mode and toggle function from ThemeContext */
  const { mode, toggleMode } = useTheme();
  
  /** MUI theme instance for responsive breakpoint checks */
  const muiTheme = useMuiTheme();
  
  /** True when viewport is large or above (desktop view) */
  const isLgUp = useMediaQuery(muiTheme.breakpoints.up('lg'));
  
  /** Controls mobile sidebar drawer open/closed state */
  const [mobileOpen, setMobileOpen] = useState(false);
  
  /** Permission check: user can access admin routes */
  const canAccessAdmin = useCan(PERMISSIONS_CONST.ADMIN);
  
  /** Permission check: user can access upload functionality */
  const canUpload = useCan(PERMISSIONS_CONST.UPLOAD);
  
  /**
   * Sidebar collapsed state, persisted to localStorage.
   * Initializes from localStorage on mount to maintain user preference.
   */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const storedValue = localStorage.getItem('sidebarCollapsed');
    return storedValue ? storedValue === 'true' : false;
  });
  
  /**
   * Toggles mobile sidebar drawer visibility.
   * Memoized to prevent unnecessary re-renders of child components.
   */
  const handleDrawerToggle = useCallback(() => {
    setMobileOpen(prev => !prev);
  }, []);
  
  /**
   * Toggles desktop sidebar between collapsed and expanded states.
   * Persists the new state to localStorage for consistency across sessions.
   * Memoized to prevent unnecessary re-renders of child components.
   */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const newState = !prev;
      localStorage.setItem('sidebarCollapsed', String(newState));
      return newState;
    });
  }, []);
  
  return (
    <Box sx={{ 
      display: 'flex', 
      minHeight: '100vh',
      backgroundColor: theme => theme.palette.mode === 'light' ? '#f5f5f5' : '#121212'
    }}>
      <AppBar 
        position="fixed" 
        sx={{ 
          zIndex: theme => theme.zIndex.drawer + 1,
          backgroundColor: 'background.paper',
          color: 'text.primary', 
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
        }}
        elevation={0}
      >
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          {/* Left section: Toggle button and menu */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              color="inherit"
              aria-label="toggle sidebar"
              edge="start"
              onClick={toggleSidebar}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
            
            <Typography 
              variant="h6" 
              component="div" 
              sx={{ 
                fontWeight: 600, 
                display: 'flex', 
                alignItems: 'center' 
              }}
            >
              ByteBridge Dashboard
            </Typography>
          </Box>
          
          {/* Right section: Controls */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Search">
              <IconButton color="inherit" size="medium">
                <SearchIcon />
              </IconButton>
            </Tooltip>
            
            <Tooltip title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
              <IconButton onClick={toggleMode} color="inherit" size="medium">
                {mode === 'light' ? <Brightness4Icon /> : <Brightness7Icon />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Notifications">
              <IconButton color="inherit" size="medium">
                <Badge badgeContent={4} color="error">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            
            {/* User menu with avatar */}
            <UserMenu />
          </Box>
        </Toolbar>
      </AppBar>
      
      {/* Pass collapsed state */}
      <Sidebar 
        mobileOpen={mobileOpen}
        handleDrawerToggle={handleDrawerToggle}
        variant={isLgUp ? "permanent" : "temporary"}
        collapsed={sidebarCollapsed}
        toggleCollapse={toggleSidebar}
      />
      
      {/* Main content with routes */}
      <Box 
        component="main" 
        sx={{ 
          flexGrow: 1, 
          p: 3, 
          width: '100%',
          mt: '64px', 
          overflow: 'auto'
        }}
      >
        <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route path="/" element={<DashboardHome />} />
            {isFeatureEnabled('teams') && <Route path="/teams/*" element={<Teams />} />}
            {isFeatureEnabled('admin') && canAccessAdmin && <Route path="/admin/*" element={<AdminPage />} />}
            <Route path="/account/*" element={<AccountPage />} />
            {isFeatureEnabled('upload') && canUpload && <Route path="/upload" element={<Upload />} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Box>
    </Box>
  );
};

export default Dashboard;