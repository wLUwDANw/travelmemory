import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_BASE = process.env.VITE_API_BASE ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发期把 /api 代理到后端，省掉跨域配置（生产由 Nginx 同域反代）
    proxy: {
      '/api': { target: API_BASE, changeOrigin: true },
    },
  },
});
