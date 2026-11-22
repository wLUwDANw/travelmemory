import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyInitialTheme } from './lib/theme';
import './styles.css';

/** 在 React 挂载**之前**把主题类挂到 `<html>`：
 *  晚一步就会先画一帧浅色、再闪成深色（深色用户每次刷新都能看见）。
 *  这里同步执行，且不依赖组件生命周期。 */
applyInitialTheme();

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在，检查 index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
