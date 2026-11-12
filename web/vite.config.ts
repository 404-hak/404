import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL ?? 'http://127.0.0.1:8000';
const inCodespaces = Boolean(process.env.CODESPACES);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // адреса Codespaces вида *.app.github.dev
    allowedHosts: ['.app.github.dev'],
    // в Codespaces горячая перезагрузка идёт через HTTPS-порт 443
    hmr: inCodespaces ? { clientPort: 443 } : undefined,
    proxy: {
      '/api': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
