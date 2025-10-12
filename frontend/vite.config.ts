import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite configuration for the application.
 * 
 * This configuration supports two modes:
 * 1. **Development with Mock API**: Uses Mock Service Worker (MSW) to simulate real API responses
 * 2. **Development with Real API**: Proxies requests to the actual API endpoints
 * 
 * @remarks
 * The configuration behavior is controlled by the `VITE_USE_MOCK_API` environment variable.
 * Set to 'false' to hit the real API endpoints, otherwise defaults to mock API.
 * 
 * @see {@link https://vitejs.dev/config/ Vite Configuration Reference}
 */
export default defineConfig(({ mode }) => {
  /**
   * Determines whether to use Mock Service Worker for API mocking.
   * Defaults to true unless explicitly set to 'false' in environment variables.
   * @type {boolean}
   */
  const useMockApi: boolean = process.env.VITE_USE_MOCK_API !== 'false';
  
  const config: any = {
    plugins: [react()],
    
    /**
     * Build configuration for production output.
     * Outputs compiled assets to Django's static folder.
     */
    build: {
      /** Output directory for production build (Django static folder) */
      outDir: '../static/frontend',
      /** Clear output directory before building */
      emptyOutDir: true,
    },
    
    /**
     * Resolve configuration for module imports.
     */
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    
    /** Development server configuration (may include proxy settings) */
    server: {},
    
    /** 
     * Web Worker configuration.
     * Uses ES module format for better tree-shaking and modern browser support.
     */
    worker: { format: 'es' },
  };

  /**
   * Proxy Configuration (Real API Mode)
   * 
   * When NOT using mock API in development, this proxies API requests
   * to the actual API endpoints to avoid CORS issues.
   * 
   * @remarks
   * The proxy forwards requests matching '/users' and '/api' patterns
   * to the appropriate API endpoint(s).
   */
  if (!useMockApi && mode === 'development') {
    console.log('[Vite] Disabled MSW mocking, will proxy to API endpoints');
    
    config.server.proxy = {
      /**
       * Proxy configuration for user-related endpoints.
       * Forwards all requests starting with '/users' to the actual API endpoints.
       */
      '/users': {
        /** API endpoint base URL */
        target: 'https://129.114.108.18:8000',
        /** Changes the origin header to match the target URL */
        changeOrigin: true,
        /** Allows self-signed SSL certificates */
        secure: false,
        /** Rewrites cookie domain to match the target domain */
        cookieDomainRewrite: '129.114.108.18',
        /** Request timeout in milliseconds (60 seconds) */
        timeout: 60000,
        
        /**
         * Configures the proxy middleware with custom event handlers.
         * @param {import('http-proxy').Server} proxy - The http-proxy instance
         */
        configure: (proxy) => {
          /** Logs any proxy errors that occur */
          proxy.on('error', (err) => console.log('Proxy error:', err));
          
          /**
           * Intercepts outgoing proxy requests.
           * Preserves cookies and logs request details.
           */
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.cookie) proxyReq.setHeader('Cookie', req.headers.cookie);
            console.log(`Proxying ${req.method} request to: ${req.url}`);
          });
          
          /**
           * Intercepts incoming proxy responses.
           * Preserves Set-Cookie headers and logs response status.
           */
          proxy.on('proxyRes', (proxyRes, req, res) => {
            if (proxyRes.headers['set-cookie']) {
              res.setHeader('Set-Cookie', proxyRes.headers['set-cookie']);
            }
            console.log(`Received ${proxyRes.statusCode} for: ${req.url}`);
          });
        },
      },
      
      /**
       * Proxy configuration for general API endpoints.
       * Forwards all requests starting with '/api' to the actual API endpoints.
       * Configuration is identical to the '/users' proxy.
       */
      '/api': {
        target: 'https://129.114.108.18:8000',
        changeOrigin: true,
        secure: false,
        timeout: 60000,
        
        configure: (proxy) => {
          proxy.on('error', (err) => console.log('Proxy error:', err));
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.cookie) proxyReq.setHeader('Cookie', req.headers.cookie);
            console.log(`Proxying ${req.method} request to: ${req.url}`);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            if (proxyRes.headers['set-cookie']) {
              res.setHeader('Set-Cookie', proxyRes.headers['set-cookie']);
            }
            console.log(`Received ${proxyRes.statusCode} for: ${req.url}`);
          });
        },
      },
    };
  } else if (mode === 'development') {
    console.log('[Vite] Using Mock Service Worker (MSW) to mock API endpoints.');
  }

  return config;
});