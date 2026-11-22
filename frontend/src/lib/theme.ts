/** 主题（浅色 / 深色）的唯一读写点。
 *
 * ## 为什么单独一个模块
 *
 * 主题是**跨组件共享的全局状态**，但不需要 React context：真正的事实源是
 * `<html class="dark">` 这一条，CSS 变量全部挂在它下面。组件只读这一条、
 * 只改这一条，就不会出现"某个按钮还是浅色"的局部状态不同步。
 *
 * ## 三件事
 *
 *  1. `applyInitialTheme()`：在 React 挂载**之前**跑（见 `main.tsx`），
 *     避免先画一帧浅色再闪成深色；
 *  2. `setTheme()`：改 DOM + 落 `localStorage`，供切换按钮调用；
 *  3. `currentTheme()`：给按钮决定显示太阳还是月亮。
 *
 * 存储/`matchMedia` 全部 try/catch：隐私模式或旧浏览器禁用 localStorage 时，
 * 主题切换仍然可用（只是记不住），不能因此让整页崩掉。
 */

export type Theme = 'light' | 'dark';

/** localStorage 键名。带 `tm-` 前缀，避免和同域其它应用撞车。 */
export const THEME_STORAGE_KEY = 'tm-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** 读用户上次的选择；没有 / 读不到 → null（交给系统偏好决定）。 */
export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** 系统是否偏好深色。SSR / jsdom 无 matchMedia 时按浅色处理。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 初始主题：用户显式选过就用它，否则跟随系统。 */
export function resolveInitialTheme(): Theme {
  return readStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

/** 当前生效的主题（以 DOM 为准，避免和 React state 各说各话）。 */
export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** 只改 DOM，不写存储。 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // `data-theme` 给调试与将来的主题化图片用；纯 CSS 不依赖它
  root.dataset.theme = theme;
}

/** 用户主动切换：改 DOM + 记住选择。 */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* 存不了就算了：本次会话内主题仍然是对的 */
  }
}

/** 入口调用：解析并应用初始主题，返回实际选中的主题（便于测试断言）。 */
export function applyInitialTheme(): Theme {
  const theme = resolveInitialTheme();
  applyTheme(theme);
  return theme;
}
