import React, { ReactNode } from 'react';
import { AppBar, Toolbar, Typography, Button, Container } from '@mui/material';

interface BaseLayoutProps {
  children: ReactNode;
  title?: string;
}

const BaseLayout: React.FC<BaseLayoutProps> = ({ children, title = 'ByteBridge Admin' }) => {
  return (
    <div className="min-h-screen bg-gray-100">
      <AppBar position="static" className="bg-indigo-700">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          <Button color="inherit">Login</Button>
        </Toolbar>
      </AppBar>
      
      <Container className="py-8">
        {children}
      </Container>
    </div>
  );
}

export default BaseLayout;
