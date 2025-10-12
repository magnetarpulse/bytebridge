import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthenticationContext';
import { RBACProvider } from './context/RBACContext';
import { initializeCsrfProtection } from './api';
import Dashboard from './components/Dashboard/Dashboard.tsx';

// Login interface components
import LoginPage from './components/login/Login.tsx';
import Register from './components/login/Register.tsx';
import ResetPassword from './components/login/ResetPassword.tsx';
import ConfirmPasswordReset from './components/login/ConfirmPasswordReset.tsx';

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
      <Route path="/password-reset" element={<ResetPassword />} />
      <Route path="/password-reset/:uidb64/:token" element={<ConfirmPasswordReset />} />
      <Route path="/dashboard/*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    initializeCsrfProtection();
  }, []);

  return (
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <RBACProvider>
            <AppRoutes />
          </RBACProvider>
        </AuthProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;