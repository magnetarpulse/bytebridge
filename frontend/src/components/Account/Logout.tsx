import React, { useState } from 'react';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Button,
  CircularProgress
} from '@mui/material';
import { useAuth } from '../../context/AuthenticationContext';
import { useNavigate } from 'react-router-dom';

interface LogoutDialogProps {
  open: boolean;
  onClose: () => void;
}

const LogoutDialog: React.FC<LogoutDialogProps> = ({ open, onClose }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="logout-dialog-title"
      aria-describedby="logout-dialog-description"
    >
      <DialogTitle id="logout-dialog-title">
        Sign Out
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="logout-dialog-description">
          Are you sure you want to sign out of your account?
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button 
          onClick={onClose}
          disabled={isLoggingOut}
        >
          Cancel
        </Button>
        <Button 
          onClick={handleLogout}
          color="primary"
          variant="contained"
          disabled={isLoggingOut}
          endIcon={isLoggingOut ? <CircularProgress size={20} color="inherit" /> : null}
        >
          {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LogoutDialog;