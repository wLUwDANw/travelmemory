import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 时间轴的性能契约 —— 锁住「每帧不准读布局」。
 *
 * 背景：`Timeline.draw(q)` 每帧被主循环调用，原先在开头就调
 * `canvas.getBoundingClientRect()`。而主循环在它之前刚写完 32 张照片卡片的
 * `style.transform/opacity` 和 HUD 文本 —— 写完样式立刻读几何，浏览器必须同步
 * 重排一次（layout thrashing）。V8 CPU profile 实测这一项后段 328ms / 10s，
 * 约 3.3% 的主线程时间纯属浪费，还挤掉了瓦片加载尖峰所需的帧预算余量。
 *
 * 组件测试需要 jsdom + ResizeObserver 桩，成本远高于收益，所以沿用
 * `styles.test.ts` 的「声明契约」做法：直接从磁盘读源码，把 `draw` 函数体
 * 抽出来，去掉注释后断言里面没有 `getBoundingClientRect`。
 *
 * 为什么要去注释：本次修复的说明文字里正好提到了这个方法名，不去会假红。
 */

interface FsLike {
  readFileSync(target: URL | string, encoding: string): string;
}

let source = '';

beforeAll(async () => {
  const specifier = ['node', 'fs'].join(':');
  const fs = (await import(/* @vite-ignore */ specifier)) as unknown as FsLike;
  source = fs.readFileSync(new URL('./ui/Timeline.tsx', import.meta.url), 'utf8');
});

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** 抽出 `const draw = useCallback(` 到 `useImperativeHandle` 之间的函数体 */
function drawBody(): string {
  const start = source.indexOf('const draw = useCallback(');
  const end = source.indexOf('useImperativeHandle(ref', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return stripComments(source.slice(start, end));
}

describe('时间轴每帧绘制', () => {
  it('draw() 里不读布局（不调 getBoundingClientRect）', () => {
    expect(drawBody()).not.toContain('getBoundingClientRect');
  });

  it('draw() 用缓存尺寸，且首帧未测量时安全跳过', () => {
    const body = drawBody();
    expect(body).toContain('sizeRef.current');
    expect(body).toContain('if (width <= 0) return;');
  });

  it('尺寸测量搬到了 ResizeObserver，且带无 ResizeObserver 的降级', () => {
    expect(source).toContain('new ResizeObserver(');
    expect(source).toContain("typeof ResizeObserver === 'undefined'");
  });

  it('交互取坐标仍按真实位置读一次（pointer 事件，不是每帧）', () => {
    expect(source).toContain('qFromClientX');
    const at = source.indexOf('const qFromClientX');
    expect(stripComments(source.slice(at, at + 400))).toContain('getBoundingClientRect');
  });
});
