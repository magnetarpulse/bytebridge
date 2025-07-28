import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../static/frontend',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/users': {
        target: 'https://129.114.108.18:8000', // Changed to HTTPS to match Hypercorn
        changeOrigin: true,
        secure: false, // Still false to accept self-signed certificates
        cookieDomainRewrite: '129.114.108.18',
        timeout: 60000,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Proxy error:', err);
          });
          
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader('Cookie', req.headers.cookie);
            }
            console.log(`Proxying ${req.method} request to: ${req.url}`);
          });
          
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              res.setHeader('Set-Cookie', cookies);
            }
            console.log(`Received ${proxyRes.statusCode} for: ${req.url}`);
          });
        }
      },
      '/api': {
        target: 'https://129.114.108.18:8000', // Changed to HTTPS to match Hypercorn
        changeOrigin: true,
        secure: false, // Still false to accept self-signed certificates
        timeout: 60000,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Proxy error:', err);
          });
          
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader('Cookie', req.headers.cookie);
            }
            console.log(`Proxying ${req.method} request to: ${req.url}`);
          });
          
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              res.setHeader('Set-Cookie', cookies);
            }
            console.log(`Received ${proxyRes.statusCode} for: ${req.url}`);
          });
        }
      }
    }
  },
  worker: {
    format: 'es', // ES-module workers
  }
})