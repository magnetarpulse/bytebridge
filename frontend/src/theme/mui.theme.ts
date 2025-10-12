/**
 * @file mui.theme.ts
 * @description Material-UI theme configuration generator.
 * Provides dynamic theme creation based on light/dark mode preference.
 * Centralizes all color values and typography settings for consistent styling.
 */

import { PaletteMode } from '@mui/material';
import { createTheme, Theme } from '@mui/material/styles';

/**
 * Generates a Material-UI theme based on the specified mode.
 * 
 * Creates a complete MUI theme object with mode-specific color palettes
 * and shared typography configuration. This ensures consistent styling
 * across the application and makes theme changes simple to implement.
 * 
 * Light mode uses blue primary colors with white backgrounds.
 * Dark mode uses lighter blue tones with dark backgrounds for reduced eye strain.
 * 
 * @param mode - Theme mode ('light' or 'dark')
 * @returns Complete MUI Theme object
 * 
 * @example
 * ```tsx
 * const theme = getTheme('dark');
 * <ThemeProvider theme={theme}>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export const getTheme = (mode: PaletteMode): Theme => {
  return createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            primary: {
              main: '#1976d2',
              light: '#42a5f5',
              dark: '#1565c0',
            },
            secondary: {
              main: '#dc004e',
            },
            background: {
              default: '#f5f5f5',
              paper: '#ffffff',
            },
          }
        : {
            primary: {
              main: '#90caf9',
              light: '#e3f2fd',
              dark: '#42a5f5',
            },
            secondary: {
              main: '#f48fb1',
            },
            background: {
              default: '#121212',
              paper: '#1e1e1e',
            },
          }),
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
    },
  });
};
