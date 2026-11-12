/** @type {import('tailwindcss').Config} */
export default {
  // 排除测试文件：否则 `*.test.ts` 里的断言字符串（'position:fixed'、'display:block'…）
  // 会被 Tailwind 当成候选类名，往产物 CSS 里塞一堆没人用的工具类。
  content: ['./index.html', './src/**/*.{ts,tsx}', '!./src/**/*.test.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#05080f',
        'bg-2': '#0a1220',
        text: '#e6f1ff',
        muted: '#7c8ea6',
        accent: '#22d3ee',
        'accent-2': '#7dd3fc',
        warn: '#fbbf24',
      },
      fontFamily: {
        sans: ['-apple-system', 'Segoe UI', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        panel: '4px',
      },
    },
  },
  plugins: [],
};
