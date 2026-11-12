import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 样式契约测试 —— 锁住 P0「canvas 尺寸自锁」的 CSS 那一半。
 *
 * 背景：`<canvas>` 是**替换元素**，`width:auto` 会解析为固有尺寸（默认 300×150），
 * 而绝对定位同时给了 left/right 时属过约束，right/bottom 被忽略 —— `inset:0` 并不能
 * 拉伸它。所以 `.play-canvas` 一旦漏写 width/height，画布就永远停在固有尺寸，
 * 轨迹 / 光点 / 经纬网格 / 照片卡片全部被挤进左上角一个小方块。
 *
 * 这个 bug 在单测里原本不可见（node 环境没有布局引擎），所以这里退一步用「声明契约」
 * 兜底：`.play-canvas` 的规则块里只要没有显式 width/height，就直接红。
 *
 * 为什么用 `node:fs` 而不是 Vite 的 `?raw`：
 * `vite.config.ts` 的 `test.environment` 是 `node`，vitest 在 `test.css` 默认关闭时
 * 会把**整条 CSS 模块链路**打桩成空串 —— 实测 `?raw`、`?inline`、`import.meta.glob`
 * 三种取法拿到的长度都是 0，只有从磁盘读原文才可靠。
 * 又因为本项目的 tsconfig 是 `"types": ["vite/client"]`、没有装 `@types/node`，
 * 静态 `import 'node:fs'` 会挂在类型检查上；这里用**计算出的说明符**引入，
 * TS 不对其做模块解析，于是既不用新增依赖、也不必用 `@ts-expect-error` 掩盖错误。
 */

interface FsLike {
  readFileSync(target: URL | string, encoding: string): string;
}

let cssText = '';

beforeAll(async () => {
  const specifier = ['node', 'fs'].join(':');
  const fs = (await import(/* @vite-ignore */ specifier)) as unknown as FsLike;
  cssText = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
});

/** 去掉 CSS 注释：本次修复的注释里正好出现了 width/height 字样，不去掉会造成假绿 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 取某个选择器的声明块，解析成 属性→值（重复属性后者覆盖前者，与 CSS 层叠一致） */
function declarationsOf(css: string, selector: string): Map<string, string> | null {
  const source = stripComments(css);
  const pattern = new RegExp(`(?:^|[},])\\s*${escapeSelector(selector)}\\s*\\{([^}]*)\\}`, 'm');
  const match = pattern.exec(source);
  if (!match) return null;

  const declarations = new Map<string, string>();
  for (const chunk of match[1].split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (property.length > 0) declarations.set(property, value);
  }
  return declarations;
}

function requireDeclarations(selector: string): Map<string, string> {
  const declarations = declarationsOf(cssText, selector);
  expect(declarations, `styles.css 里找不到规则：${selector}`).not.toBeNull();
  return declarations as Map<string, string>;
}

/**
 * 判定逻辑本身抽出来，好让它能被「变异自检」验证：
 * 传一份故意缺 width/height 的合成样式，如果它不报缺项，说明断言形同虚设。
 * @returns 缺失或无效的尺寸属性名（空数组 = 合规）
 */
function findMissingSizeDeclarations(css: string, selector: string): string[] {
  const declarations = declarationsOf(css, selector);
  if (!declarations) return ['rule-missing'];

  const missing: string[] = [];
  for (const property of ['width', 'height']) {
    const value = declarations.get(property);
    if (value === undefined || value.trim() === '' || value.trim() === 'auto') {
      missing.push(property);
    }
  }
  return missing;
}

describe('样式契约解析器自检', () => {
  it('注释会被剥离（防止注释里的 width 造成假绿）', () => {
    const synthetic = '.x { /* width: 0; height: 0; */ color: red; }';
    expect(stripComments(synthetic)).toBe('.x {  color: red; }');

    const declarations = declarationsOf(synthetic, '.x') as Map<string, string>;
    expect(declarations.get('color')).toBe('red');
    expect(declarations.has('width')).toBe(false);
    expect(declarations.has('height')).toBe(false);
  });

  it('能解析出带连字符的属性与简写值', () => {
    const synthetic = '.y{position:absolute;pointer-events:none;inset:0}';
    const declarations = declarationsOf(synthetic, '.y') as Map<string, string>;
    expect(declarations.get('position')).toBe('absolute');
    expect(declarations.get('pointer-events')).toBe('none');
    expect(declarations.get('inset')).toBe('0');
  });

  it('styles.css 能被读到且非空', () => {
    expect(cssText.length).toBeGreaterThan(1000);
    expect(cssText).toContain('.play-canvas');
  });

  it('变异自检：缺 width/height 或写成 auto 的合成样式必须被判为不合规', () => {
    // 若这条挂掉，说明下面的 P0 契约是「永远通过」的假断言
    expect(findMissingSizeDeclarations('.play-canvas { inset: 0; }', '.play-canvas')).toEqual([
      'width',
      'height',
    ]);
    expect(
      findMissingSizeDeclarations('.play-canvas { width: auto; height: 100%; }', '.play-canvas'),
    ).toEqual(['width']);
    expect(
      findMissingSizeDeclarations('.play-canvas { width: ; height: 100%; }', '.play-canvas'),
    ).toEqual(['width']);
    expect(findMissingSizeDeclarations('.nothing { width: 1px; }', '.play-canvas')).toEqual([
      'rule-missing',
    ]);
    // 合规样本必须判为 []
    expect(
      findMissingSizeDeclarations('.play-canvas { width: 100%; height: 100%; }', '.play-canvas'),
    ).toEqual([]);
  });
});

describe('.play-canvas 尺寸契约（P0 回归）', () => {
  it('显式声明了 width 与 height，且不是 auto（缺失即锁死 300×150）', () => {
    expect(
      findMissingSizeDeclarations(cssText, '.play-canvas'),
      '.play-canvas 的 width/height 缺失或被写成 auto：canvas 会锁在固有尺寸 300×150，整条轨迹被挤到左上角',
    ).toEqual([]);
  });

  it('铺满父容器（100%）且放行指针事件', () => {
    const declarations = requireDeclarations('.play-canvas');
    expect(declarations.get('width')).toBe('100%');
    expect(declarations.get('height')).toBe('100%');
    // 交互在地图层、卡片层与时间轴上，canvas 自身不能拦截指针
    expect(declarations.get('pointer-events')).toBe('none');
  });

  it('父容器 .play 撑满视口（resize() 量的是它，它不对就全错）', () => {
    const play = requireDeclarations('.play');
    expect(play.get('position')).toBe('fixed');
    expect((play.get('inset') ?? '').replace(/\s+/g, '')).toBe('0');
  });
});

describe('其他 canvas 元素的尺寸契约', () => {
  it('.tl-track canvas 显式给了 width/height（时间轴画布的既有正确写法）', () => {
    const declarations = requireDeclarations('.tl-track canvas');
    expect(declarations.get('width')).toBe('100%');
    expect(declarations.get('height')).toBe('68px');
    expect(declarations.get('display')).toBe('block');
  });
});
