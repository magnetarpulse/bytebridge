import React from 'react';
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

interface SidebarProps {
  mobileOpen: boolean;
  handleDrawerToggle: () => void;
  variant: "permanent" | "persistent" | "temporary";
  collapsed: boolean; 
  toggleCollapse?: () => void; 
}

const drawerWidth = 240;
const collapsedDrawerWidth = 72;

const Sidebar: React.FC<SidebarProps> = ({ 
  mobileOpen, 
  handleDrawerToggle,
  variant,
  collapsed
}) => {
  const location = useLocation();
  const theme = useTheme();

  const navigationItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  ];

  const resourceItems = [
    { text: 'ByteBridges', icon: <CloudIcon />, path: '/dashboard/bytebridges' },
    { text: 'DataStores', icon: <StorageIcon />, path: '/dashboard/datastores' },
    { text: 'Repositories', icon: <AccountTreeIcon />, path: '/dashboard/repositories' },
    { text: 'Files', icon: <FileIcon />, path: '/dashboard/files' },
    { text: 'File Upload', icon: <CloudUploadIcon />, path: '/dashboard/upload' },
  ];
  
  const managementItems = [
    { text: 'Teams', icon: <PeopleIcon />, path: '/dashboard/teams' },
    { text: 'Admin', icon: <AdminIcon />, path: '/dashboard/admin' },
  ];
  
  const accountItems = [
    { text: 'Account', icon: <SettingsIcon />, path: '/dashboard/account' },
  ];

  // Helper function to render menu items
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

  // Helper function to render section headers
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