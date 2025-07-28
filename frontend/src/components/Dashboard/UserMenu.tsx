import React, { useState } from 'react';
import { IconButton, Avatar, Menu,
  MenuItem, ListItemIcon, ListItemText,
  Divider, Box, Typography} from '@mui/material';
import { Settings, ExitToApp,Person} from '@mui/icons-material';
import { useAuth } from '../../context/AuthenticationContext';
import { Link } from 'react-router-dom';
import LogoutDialog from '../Account/Logout';

const UserMenu: React.FC = () => {
  const { user } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  
  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  
  const handleCloseMenu = () => {
    setAnchorEl(null);
  };
  
  const handleLogoutClick = () => {
    handleCloseMenu();
    setLogoutDialogOpen(true);
  };

  const getInitials = () => {
    if (!user) return '?';
    
    if (user.firstName && user.lastName) {
      return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`;
    }
    
    return user.username.charAt(0).toUpperCase();
  };

  const getAvatarColor = () => {
    if (!user) return '#757575';
    
    // Simple hash function to generate a consistent color based on username
    const hash = user.username.split('').reduce(
      (acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0
    );
    
    // Generate a color using hue rotation (keeping good saturation and lightness)
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 55%)`;
  };

  return (
    <>
      <IconButton
        edge="end"
        aria-label="account menu"
        aria-controls="menu-appbar"
        aria-haspopup="true"
        onClick={handleOpenMenu}
        color="inherit"
      >
        <Avatar
          sx={{
            bgcolor: getAvatarColor(),
            width: 40,
            height: 40,
            fontWeight: 'bold'
          }}
        >
          {getInitials()}
        </Avatar>
      </IconButton>
      
      <Menu
        id="menu-appbar"
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        keepMounted
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        PaperProps={{
          elevation: 3,
          sx: { minWidth: 200, mt: 1 }
        }}
      >
        {user && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={500} noWrap>
              {user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.username}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {user.email}
            </Typography>
          </Box>
        )}
        
        <Divider />
        
        <MenuItem component={Link} to="/dashboard/profile" onClick={handleCloseMenu}>
          <ListItemIcon>
            <Person fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Profile" />
        </MenuItem>
        
        <MenuItem component={Link} to="/dashboard/account" onClick={handleCloseMenu}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Settings" />
        </MenuItem>
        
        <Divider />
        
        <MenuItem onClick={handleLogoutClick}>
          <ListItemIcon>
            <ExitToApp fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Sign out" />
        </MenuItem>
      </Menu>
      
      <LogoutDialog
        open={logoutDialogOpen}
        onClose={() => setLogoutDialogOpen(false)}
      />
    </>
  );
};

export default UserMenu;