import React from 'react';
import {
  Card, CardContent, Typography, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { useTheme } from '../../context/ThemeContext';

interface Activity {
  user: string;
  action: string;
  status: 'Completed' | 'In Progress' | 'Planned';
  time: string;
}

const activities: Activity[] = [
  { user: 'John Smith', action: 'Created new project', status: 'Completed', time: '2 hours ago' },
  { user: 'Sarah Johnson', action: 'Updated neural network', status: 'In Progress', time: '3 hours ago' },
  { user: 'Robert Lee', action: 'System maintenance', status: 'Planned', time: 'Yesterday' },
  { user: 'Emily Chen', action: 'Data analysis completed', status: 'Completed', time: 'Today' },
];

const ActivityTable: React.FC = () => {
  const { mode } = useTheme();
  const theme = useMuiTheme();

  const getStatusClass = (status: Activity['status']) => {
    // Define status colors for both light and dark modes
    if (theme.palette.mode === 'light') {
      switch(status) {
        case 'Completed': return 'bg-green-100 text-green-800';
        case 'In Progress': return 'bg-yellow-100 text-yellow-800';
        case 'Planned': return 'bg-blue-100 text-blue-800';
        default: return 'bg-gray-100 text-gray-800';
      }
    } else {
      switch(status) {
        case 'Completed': return 'bg-green-900 bg-opacity-40 text-green-300';
        case 'In Progress': return 'bg-yellow-900 bg-opacity-40 text-yellow-300';
        case 'Planned': return 'bg-blue-900 bg-opacity-40 text-blue-300';
        default: return 'bg-gray-800 text-gray-300';
      }
    }
  };

  return (
    <Card elevation={0} sx={{ 
      border: '1px solid',
      borderColor: theme.palette.mode === 'light' ? '#f0f0f0' : 'rgba(255, 255, 255, 0.12)'
    }}>
      <CardContent>
        <Typography variant="h6" className="font-medium mb-4" color="textPrimary">
          Recent Activities
        </Typography>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {activities.map((activity, index) => (
                <TableRow hover key={index}>
                  <TableCell>{activity.user}</TableCell>
                  <TableCell>{activity.action}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 ${getStatusClass(activity.status)} rounded-full text-xs`}>
                      {activity.status}
                    </span>
                  </TableCell>
                  <TableCell>{activity.time}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};

export default ActivityTable;