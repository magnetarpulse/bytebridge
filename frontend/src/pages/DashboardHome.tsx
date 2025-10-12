/**
 * @file DashboardHome.tsx
 * @description Main dashboard home page displaying key metrics and recent activity.
 * Serves as the landing page after authentication.
 */

import React from 'react';
import { Container, Typography, Box } from '@mui/material';
import Grid from '@mui/material/Grid';
import StatsCard from '../components/Dashboard/StatsCard';
import ActivityTable from '../components/Dashboard/ActivityTable';
import { useAuth } from '../context/AuthenticationContext';
import { useMetrics } from '../services/metrics';

/**
 * Dashboard home page component.
 * 
 * Displays:
 * - Welcome message based on authentication status
 * - Grid of metric cards showing system statistics
 * - Activity table with recent system events
 * 
 * Metrics are loaded asynchronously from the data layer.
 * 
 * @returns Dashboard home page with metrics and activity
 * 
 * @example
 * ```tsx
 * <Route path="/dashboard" element={<DashboardHome />} />
 * ```
 */
const DashboardHome: React.FC = () => {
  /** Current authentication status */
  const { isAuthenticated } = useAuth();
  
  /** Dashboard metrics data with loading state */
  const { data: stats, loading } = useMetrics();
  
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight="500">Dashboard</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {isAuthenticated ? 
            "Welcome back! Here's an overview of your system" : 
            "Please sign in to access all dashboard features"}
        </Typography>
      </Box>
      
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {loading ? (
          <Grid size={{ xs: 12 }}>
            <Typography>Loading...</Typography>
          </Grid>
        ) : (
          stats?.map((stat, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={index}>
              <StatsCard 
                title={stat.title} 
                value={stat.value} 
                change={stat.change} 
                trend={stat.trend} 
              />
            </Grid>
          ))
        )}
      </Grid>
      
      <Box sx={{ mt: 3, backgroundColor: 'background.paper', borderRadius: 1, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
        <ActivityTable />
      </Box>
    </Container>
  );
};

export default DashboardHome;
