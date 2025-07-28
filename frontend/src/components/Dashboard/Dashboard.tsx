import React, { useState, useEffect } from 'react';
import { 
  AppBar, Toolbar, Typography, Container,
  IconButton, Tooltip, useMediaQuery, Box,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import MenuIcon from '@mui/icons-material/Menu';
import Sidebar from './Sidebar';
import StatsCard from './StatsCard';
import ActivityTable from './ActivityTable';
import { useTheme } from '../../context/ThemeContext';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import Brightness4Icon from '@mui/icons-material/Brightness4';  
import Brightness7Icon from '@mui/icons-material/Brightness7';  
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchIcon from '@mui/icons-material/Search';
import Badge from '@mui/material/Badge';
import { useAuth } from '../../context/AuthenticationContext';
import UserMenu from './UserMenu';
import LogoLightMode from '../../assets/ByteBridgeLightVersionLogo.png'; 
import LogoDarkMode from '../../assets/ByteBridgeLightVersionLogo.png';
import { Routes, Route } from 'react-router-dom';
import AccountPage from '../Account/AccountPage';
import AdminPage from '../Admin/AdminPage';
import Upload from '../Admin/Upload'; 

const DashboardHome = () => {
  const { isAuthenticated } = useAuth();
  
  const stats = [
    { title: 'Total Users', value: '1,249', change: '+12% from last month', trend: 'up' as const },
    { title: 'Active Projects', value: '42', change: '+3 new this week', trend: 'up' as const },
    { title: 'System Load', value: '28%', change: 'Normal operations', trend: 'neutral' as const },
    { title: 'Error Rate', value: '0.12%', change: '-0.06% from yesterday', trend: 'down' as const },
  ];
  
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Page title */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight="500">Dashboard</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {isAuthenticated ? 
            "Welcome back! Here's an overview of your system" : 
            "Please sign in to access all dashboard features"}
        </Typography>
      </Box>
      
      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {stats.map((stat, index) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={index}>
            <StatsCard 
              title={stat.title} 
              value={stat.value} 
              change={stat.change} 
              trend={stat.trend} 
            />
          </Grid>
        ))}
      </Grid>
      
      {/* Activity Table */}
      <Box sx={{ mt: 3, backgroundColor: 'background.paper', borderRadius: 1, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
        <ActivityTable />
      </Box>
    </Container>
  );
};

// Placeholder components for other routes
const Teams = () => <Container maxWidth="xl" sx={{ py: 3 }}><Typography variant="h4">Teams</Typography></Container>;
const Admin = () => <Container maxWidth="xl" sx={{ py: 3 }}><Typography variant="h4">Admin Panel</Typography></Container>;
const NotFound = () => (
  <Container maxWidth="xl" sx={{ py: 3, textAlign: 'center' }}>
    <Typography variant="h4" gutterBottom>404: Page Not Found</Typography>
    <Typography variant="body1">The page you're looking for doesn't exist or has been moved.</Typography>
  </Container>
);

const Dashboard: React.FC = () => {
  const { mode, toggleMode } = useTheme();
  const muiTheme = useMuiTheme();
  const isLgUp = useMediaQuery(muiTheme.breakpoints.up('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const storedValue = localStorage.getItem('sidebarCollapsed');
    return storedValue ? storedValue === 'true' : false;
  });

  const currentLogo = mode === 'light' ? LogoLightMode : LogoDarkMode;
  
  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };
  
  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', String(newState));
  };
  
  // Synchronize sidebar state with localStorage
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  
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
          {/* Left section: Toggle button, Logo and menu */}
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
              <img 
                src={currentLogo} 
                alt="NeuroController" 
                style={{ 
                  height: 40,
                  width: 'auto', 
                  marginRight: 12,
                  objectFit: 'contain'
                }} 
              />
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
        <Routes>
          <Route path="/" element={<DashboardHome />} />
          <Route path="/teams/*" element={<Teams />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/account/*" element={<AccountPage />} />
          <Route path="/upload" element={<Upload />} /> 
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Box>
    </Box>
  );
};

export default Dashboard;