import React from 'react';
import { Paper, Typography } from '@mui/material';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { useTheme } from '../../context/ThemeContext';


interface StatsCardProps {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, change, trend }) => {
  const { mode } = useTheme();
  const theme = useMuiTheme();
  
  // Define trend colors based on theme
  const getTrendColor = () => {
    if (trend === 'up') return theme.palette.mode === 'light' ? '#2563eb' : '#3b82f6';
    if (trend === 'down') return theme.palette.mode === 'light' ? '#64748b' : '#94a3b8';
    return theme.palette.text.secondary;
  };
  
  return (
    <Paper 
      className="p-5 hover:shadow-md transition-shadow duration-200" 
      elevation={0} 
      sx={{ 
        border: '1px solid',
        borderColor: theme.palette.mode === 'light' ? '#f0f0f0' : 'rgba(255, 255, 255, 0.12)'
      }}
    >
      <Typography color="textSecondary" gutterBottom className="font-medium">
        {title}
      </Typography>
      <Typography variant="h4" component="h2" className="font-medium mb-2" color="textPrimary">
        {value}
      </Typography>
      <Typography component="span" sx={{ color: getTrendColor(), display: 'flex', alignItems: 'center', fontSize: '0.875rem' }}>
        {trend === 'up' && <span className="mr-1">↑</span>}
        {trend === 'down' && <span className="mr-1">↓</span>}
        {change}
      </Typography>
    </Paper>
  );
};

export default StatsCard;