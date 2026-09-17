import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'local-development-csp',
      apply: 'serve',
      // React's local refresh preamble is inline. Production retains the strict policy.
      transformIndexHtml: (html) =>
        html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
