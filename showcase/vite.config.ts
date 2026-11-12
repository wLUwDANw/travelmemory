import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite + Vitest 共用一份配置：test 段由 vitest/config 的 defineConfig 提供类型。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 4 个纯逻辑测试文件的运行时间可忽略；关掉文件级并行可以避开沙箱里
    // 多 worker 争抢临时目录导致的 EPERM（不影响断言本身）。
    fileParallelism: false,
  },
});
