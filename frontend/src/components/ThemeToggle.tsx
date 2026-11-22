/** 深浅主题切换按钮。
 *
 * ## 为什么是"独立按钮"而不是塞进某个工具栏
 *
 * 主界面的按钮已经分了三簇：左上品牌、左下四个工具、右下 AI FAB、右缘抽屉 Tab。
 * 主题切换是**低频外观设置**，塞进任何一簇都会把那簇的主次打乱；
 * 所以放在唯一空着的右上角，与左上品牌形成对角，且不压任何既有按钮。
 *
 * ## 状态从哪来
 *
 * 不引入 context：`<html class="dark">` 就是事实源。初始值读一次 DOM，
 * 之后每次点击先改 DOM 再同步本地 state（顺序反过来会闪一帧旧图标）。
 *
 * 图标语义：显示**将要切换到**的主题 —— 浅色时显示月亮（点我去深色），
 * 深色时显示太阳。`aria-pressed` 表示"深色是否开启"，屏幕阅读器可读。
 */

import { useCallback, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { currentTheme, setTheme, type Theme } from '../lib/theme';

export interface ThemeToggleProps {
  /** 额外定位类（由使用方决定放哪）。 */
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setLocalTheme] = useState<Theme>(() => currentTheme());
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? '切换到深色模式' : '切换到浅色模式';

  const toggle = useCallback(() => {
    setTheme(next);
    setLocalTheme(next);
  }, [next]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
      className={[
        'grid h-10 w-10 place-items-center rounded-full border border-border',
        'bg-background/90 text-foreground shadow-md backdrop-blur',
        'transition-colors hover:bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className ?? '',
      ].join(' ')}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
