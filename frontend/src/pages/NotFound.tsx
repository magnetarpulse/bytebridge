/**
 * @file NotFound.tsx
 * @description 404 error page displayed for invalid routes.
 * Catch-all route component for unmatched paths.
 */

import React from 'react';
import { Container, Typography } from '@mui/material';

/**
 * 404 Not Found page component.
 * 
 * Displayed when users navigate to routes that don't exist
 * or routes they don't have permission to access.
 * 
 * @returns 404 error page with user-friendly message
 */
const NotFound: React.FC = () => {
  return (
    <Container maxWidth="xl" sx={{ py: 3, textAlign: 'center' }}>
      <Typography variant="h4" gutterBottom>404: Page Not Found</Typography>
      <Typography variant="body1">The page you're looking for doesn't exist or has been moved.</Typography>
    </Container>
  );
};

export default NotFound;
