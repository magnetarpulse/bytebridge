import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthenticationContext';
import Dashboard from './components/Dashboard/Dashboard.tsx';
import LoginPage from './components/Account/Login.tsx';
import Register from './components/Account/Register.tsx';
import PasswordReset from './components/Account/PasswordResetConfirm.tsx';
import ResetPasswordConfirm from './components/Account/PasswordResetConfirm.tsx';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';

// Protected route component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading, initialCheckDone } = useAuth();
  
  // Only show loading for initial auth check
  if (loading && !initialCheckDone) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
};

const AppRoutes = () => {
  const { isAuthenticated, loading, initialCheckDone } = useAuth();
  
  // Only show loading for initial auth check
  if (loading && !initialCheckDone) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<Register />} />
      <Route path="/password-reset" element={<PasswordReset />} />
      <Route path="/password-reset/:uidb64/:token" element={<ResetPasswordConfirm />} />
      <Route path="/dashboard/*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;