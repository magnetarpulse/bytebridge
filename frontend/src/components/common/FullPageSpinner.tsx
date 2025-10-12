/**
 * @file FullPageSpinner.tsx
 * @description Loading spinner component for full-page or large section loading states.
 * Used as fallback UI for lazy-loaded routes and async operations.
 */

import React from 'react';
import { Box, CircularProgress } from '@mui/material';

/**
 * Full-page loading spinner component.
 * 
 * Displays a centered circular progress indicator with minimum height.
 * Used primarily as Suspense fallback for code-split routes.
 * 
 * @returns Centered loading spinner component
 * 
 * @example
 * ```tsx
 * <Suspense fallback={<FullPageSpinner />}>
 *   <LazyLoadedComponent />
 * </Suspense>
 * ```
 */
const FullPageSpinner: React.FC = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        width: '100%',
      }}
    >
      <CircularProgress />
    </Box>
  );
};

export default FullPageSpinner;
