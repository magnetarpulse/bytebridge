/**
 * @file Sidebar.tsx
 * @description Navigation sidebar component for the dashboard.
 * Provides responsive navigation menu with role-based access control and feature flags.
 * Supports both permanent (desktop) and temporary (mobile) drawer variants.
 */

import React, { useMemo } from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  useTheme,
  Tooltip,
  Divider,
  Typography
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  AccountTree as AccountTreeIcon,
  People as PeopleIcon,
  CloudQueue as CloudIcon,
  InsertDriveFile as FileIcon,
  Settings as SettingsIcon,
  AdminPanelSettings as AdminIcon
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { isFeatureEnabled } from '../../config/features';
import { useCan, PERMISSIONS_CONST } from '../../context/RBACContext';

/**
 * Props for the Sidebar component.
 */
interface SidebarProps {
  /** Controls mobile drawer open/closed state */
  mobileOpen: boolean;
  /** Callback to toggle mobile drawer visibility */
  handleDrawerToggle: () => void;
  /** Drawer variant: permanent (desktop) or temporary (mobile) */
  variant: "permanent" | "persistent" | "temporary";
  /** Whether sidebar is in collapsed state (icons only) */
  collapsed: boolean;
  /** Optional callback to toggle collapsed state */
  toggleCollapse?: () => void;
}

/** Width of expanded sidebar in pixels */
const drawerWidth = 240;

/** Width of collapsed sidebar in pixels (icons only) */
const collapsedDrawerWidth = 72;

/**
 * Sidebar navigation component with responsive behavior and RBAC.
 * 
 * Features:
 * - Responsive drawer that adapts to screen size
 * - Collapsible mode for desktop (icons only)
 * - Role-based menu item filtering
 * - Feature flag integration for conditional items
 * - Active route highlighting
 * - Organized menu sections (Navigation, Resources, Management, Account)
 * 
 * @param props - Component props
 * @returns Responsive sidebar navigation component
 * 
 * @example
 * ```tsx
 * <Sidebar
 *   mobileOpen={false}
 *   handleDrawerToggle={() => {}}
 *   variant="permanent"
 *   collapsed={false}
 * />
 * ```
 */
const Sidebar: React.FC<SidebarProps> = ({ 
  mobileOpen, 
  handleDrawerToggle,
  variant,
  collapsed
}) => {
  /** Current route location for active state detection */
  const location = useLocation();
  
  /** MUI theme instance for styling */
  const theme = useTheme();
  
  /** Permission check: user can access admin functionality */
  const canAccessAdmin = useCan(PERMISSIONS_CONST.ADMIN);
  
  /** Permission check: user can access upload functionality */
  const canUpload = useCan(PERMISSIONS_CONST.UPLOAD);

  /**
   * Primary navigation items (always visible).
   * Memoized to prevent unnecessary re-renders.
   */
  const navigationItems = useMemo(() => [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  ], []);

  /**
   * Resource management navigation items.
   * Conditionally includes upload based on feature flags and permissions.
   * Memoized with canUpload dependency to update when permissions change.
   */
  const resourceItems = useMemo(() => {
    const items = [
      { text: 'ByteBridges', icon: <CloudIcon />, path: '/dashboard/bytebridges' },
      { text: 'DataStores', icon: <StorageIcon />, path: '/dashboard/datastores' },
      { text: 'Repositories', icon: <AccountTreeIcon />, path: '/dashboard/repositories' },
      { text: 'Files', icon: <FileIcon />, path: '/dashboard/files' },
    ];
    
    if (isFeatureEnabled('upload') && canUpload) {
      items.push({ text: 'File Upload', icon: <CloudUploadIcon />, path: '/dashboard/upload' });
    }
    
    return items;
  }, [canUpload]);
  
  /**
   * Management section navigation items.
   * Filtered based on feature flags and user permissions.
   * Memoized with canAccessAdmin dependency to update when permissions change.
   */
  const managementItems = useMemo(() => {
    const items = [];
    
    if (isFeatureEnabled('teams')) {
      items.push({ text: 'Teams', icon: <PeopleIcon />, path: '/dashboard/teams' });
    }
    
    if (isFeatureEnabled('admin') && canAccessAdmin) {
      items.push({ text: 'Admin', icon: <AdminIcon />, path: '/dashboard/admin' });
    }
    
    return items;
  }, [canAccessAdmin]);
  
  /**
   * Account section navigation items (always visible).
   * Memoized to prevent unnecessary re-renders.
   */
  const accountItems = useMemo(() => [
    { text: 'Account', icon: <SettingsIcon />, path: '/dashboard/account' },
  ], []);

  /**
   * Renders a list of navigation menu items with active state highlighting.
   * 
   * @param items - Array of navigation items to render
   * @returns Array of rendered ListItem components
   */
  const renderMenuItems = (items: Array<{text: string, icon: React.ReactElement, path: string}>) => {
    return items.map((item) => {
      const isActive = location.pathname === item.path || 
                      (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
                      
      return (
        <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
          <Tooltip title={collapsed ? item.text : ""} placement="right">
            <ListItemButton 
              component={Link}
              to={item.path}
              selected={isActive}
              sx={{
                minHeight: 48,
                borderRadius: 1.5,
                justifyContent: collapsed ? 'center' : 'initial',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                  },
                  '& .MuiListItemIcon-root': {
                    color: 'primary.contrastText',
                  }
                }
              }}
            >
              <ListItemIcon sx={{ 
                minWidth: 0, 
                mr: collapsed ? 0 : 2, 
                justifyContent: 'center'
              }}>
                {item.icon}
              </ListItemIcon>
              
              {!collapsed && <ListItemText 
                primary={item.text} 
                primaryTypographyProps={{ 
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500 
                }} 
              />}
            </ListItemButton>
          </Tooltip>
        </ListItem>
      );
    });
  };

  /**
   * Renders a section header for menu groups.
   * Hidden when sidebar is collapsed to maintain clean icon-only layout.
   * 
   * @param title - Section title to display
   * @returns Section header Typography component or null if collapsed
   */
  const renderSectionHeader = (title: string) => {
    if (collapsed) return null;
    
    return (
      <Typography 
        variant="overline" 
        sx={{ 
          px: 2, 
          pt: 2, 
          pb: 0.5, 
          fontSize: '11px',
          fontWeight: 500,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 1,
          display: 'block' 
        }}
      >
        {title}
      </Typography>
    );
  };

  const drawer = (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column',
      height: '100%'
    }}>
      <Toolbar />
      
      {/* Navigation Section */}
      <List component="nav" sx={{ px: collapsed ? 0.5 : 1.5, pt: 1 }}>
        {renderMenuItems(navigationItems)}
      </List>
      
      <Divider sx={{ my: 1 }} />
      
      {/* Resources Section */}
      {renderSectionHeader('Resources')}
      <List component="nav" sx={{ px: collapsed ? 0.5 : 1.5, pt: collapsed ? 1 : 0 }}>
        {renderMenuItems(resourceItems)}
      </List>
      
      <Divider sx={{ my: 1 }} />
      
      {/* Resource Management Section */}
      {renderSectionHeader('Resource Management')}
      <List component="nav" sx={{ px: collapsed ? 0.5 : 1.5, pt: collapsed ? 1 : 0 }}>
        {renderMenuItems(managementItems)}
      </List>
      
      {/* Spacer to push account to bottom */}
      <Box sx={{ flexGrow: 1 }} />
      
      <Divider sx={{ my: 1 }} />
      
      {/* Account Section - at bottom */}
      <List component="nav" sx={{ px: collapsed ? 0.5 : 1.5, pb: 2 }}>
        {renderMenuItems(accountItems)}
      </List>
    </Box>
  );

  /** Current sidebar width based on collapsed state */
  const currentWidth = collapsed ? collapsedDrawerWidth : drawerWidth;

  return (
    <Box
      component="nav"
      sx={{ 
        width: { lg: currentWidth }, 
        flexShrink: { lg: 0 },
        transition: theme => theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
      }}
    >
      {/* Mobile drawer */}
      <Drawer
        variant={variant}
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{
          keepMounted: true, 
        }}
        sx={{
          display: { xs: 'block', lg: 'none' },
          '& .MuiDrawer-paper': { 
            boxSizing: 'border-box', 
            width: drawerWidth,
            borderRight: `1px solid ${theme.palette.divider}`
          },
        }}
      >
        {drawer}
      </Drawer>
      
      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', lg: 'block' },
          '& .MuiDrawer-paper': { 
            boxSizing: 'border-box', 
            width: currentWidth,
            overflow: collapsed ? 'visible' : 'auto',
            transition: theme => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            borderRight: `1px solid ${theme.palette.divider}`
          },
        }}
        open
      >
        {drawer}
      </Drawer>
    </Box>
  );
};

export default Sidebar;