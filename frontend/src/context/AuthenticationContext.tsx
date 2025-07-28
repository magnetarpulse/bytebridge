import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { 
  register as apiRegister,
  login as apiLogin, 
  logout as apiLogout, 
  checkAuthStatus, 
  getUserProfile, 
  regenerateToken,
  User,
} from '../api/authentication';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  initialCheckDone: boolean; 
  error: string | null;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  getProfile: () => Promise<User | null>;
  refreshToken: () => Promise<string | null>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialCheckDone, setInitialCheckDone] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user is authenticated when the app loads
  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      try {
        const result = await checkAuthStatus();
        setIsAuthenticated(result.isAuthenticated);
        if (result.isAuthenticated && result.user) {
          setUser(result.user);
        }
      } catch (err) {
        console.error("Auth check failed:", err);
        // Don't set error on initial load to avoid showing error alerts
      } finally {
        setLoading(false);
        setInitialCheckDone(true);
      }
    };
    
    checkAuth();
  }, []);

  // Register function
  const register = async (username: string, email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiRegister(username, email, password);
      
      if (result.success && result.data) {
        setIsAuthenticated(true);
        setUser(result.data);
        return true;
      } else {
        setError(result.error || 'Registration failed. Please try again.');
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed. Please try again later.';
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Login function
  const login = async (username: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiLogin(username, password);
      
      if (result.success && result.data) {
        setIsAuthenticated(true);
        setUser(result.data);
        return true;
      } else {
        setError(result.error || 'Login failed. Please check your credentials.');
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed. Please try again later.';
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = async (): Promise<void> => {
    setLoading(true);
    
    try {
      const result = await apiLogout();
      if (result.success) {
        setIsAuthenticated(false);
        setUser(null);
      } else {
        setError(result.error || 'Logout failed. Please try again.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Logout failed. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Get profile with token
  const getProfile = async (): Promise<User | null> => {
    setLoading(true);
    
    try {
      const result = await getUserProfile();
      if (result.success && result.data) {
        setUser(result.data);
        return result.data;
      } else {
        setError(result.error || 'Failed to fetch profile. Please try again.');
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch profile. Please try again.';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Regenerate token
  const refreshToken = async (): Promise<string | null> => {
    // Don't set loading to true for silent token refreshes
    // This prevents UI disruption during token refresh
    let previousLoadingState = loading;
    
    try {
      const result = await regenerateToken();
      if (result.success && result.data) {
        // Update user object with new token
        if (user) {
          setUser({
            ...user,
            profile: {
              ...user.profile,
              auth_token: result.data
            }
          });
        }
        return result.data;
      } else {
        // Only set error for non-silent token refreshes
        if (previousLoadingState) {
          setError(result.error || 'Failed to regenerate token. Please login again.');
        }
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to regenerate token. Please login again.';
      // Only set error for non-silent token refreshes
      if (previousLoadingState) {
        setError(errorMessage);
      }
      return null;
    }
  };
  
  // Clear error state
  const clearError = () => {
    setError(null);
  };

  const value = {
    isAuthenticated,
    user,
    loading,
    initialCheckDone, // Add to the context value
    error,
    register,
    login,
    logout,
    getProfile,
    refreshToken,
    clearError
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};