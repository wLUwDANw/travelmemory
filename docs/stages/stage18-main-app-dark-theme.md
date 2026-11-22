# 阶段 18：主应用 —— 黑底黑字、关闭按钮重叠与深浅主题切换

> 状态：**未验证**（类型 / 单测 / 构建 / 无头 Edge 走查已跑；真高德底图、真机与读屏未跑，见 §7）
> 范围：只改 `frontend/**` 的样式、UI 组件与主题入口；不碰 `apps/track-studio/**`、`packages/**`、后端与协议。
> 姊妹篇：[stage17](./stage17-light-dark-visual-alignment.md) 管的是 Track Studio 两套主题的视觉对齐，本文管主应用（全屏地图壳）。
> 日期：2026-11-22

---

## 1. 这一阶段要解决什么

主应用（`frontend/`，Vite + React + Tailwind + shadcn 风格组件）此前只有浅色一套，
用户报了三件事：

1. **黑底黑字**：主界面里有文字几乎读不出来；
2. **「新对话」与「关闭」重叠**：AI 抽屉右上角的 X 压在「新对话」按钮上；
3. **没有深浅切换**：`tailwind.config` 里写了 `darkMode: ['class']`，但从来没有 `.dark` 变量块，也没有切换入口。

### 出口条件

- [x] 全量遍历文本节点，浅色/深色两套主题都没有对比度 < 3:1 的文字（含 hover 态）
- [x] AI 抽屉「新对话」与关闭按钮的重叠面积为 0；关闭按钮点击区 ≥ 32×32
- [x] 右上角有主题切换按钮，与既有 6 个按钮/浮层零重叠（1440 与 390 两种宽度）
- [x] 主题选择可持久化；有系统偏好时首次跟随系统；刷新不闪白
- [x] `npm run typecheck` / `npm run build` 通过；`npm test` 429 通过（7 条既有 CRLF 失败，与本文无关）

---

## 2. 根因：一个 token 被当成两种语义

`frontend/src/styles.css` 里同时住着两套变量：

| 体系 | 变量 | 用途 |
| --- | --- | --- |
| 阶段 2 遗留（hex） | `--bg / --panel / --text / --user / --danger` | 手写 CSS：地图占位、分享页、旧对话页 |
| Tailwind / shadcn（HSL 三元组） | `--background / --foreground / --muted / --accent …` | 组件类：`bg-muted`、`text-muted-foreground`、`hover:bg-accent` |

出事的是 `--muted`：

```css
/* 旧值 */
--muted: 52 3% 47%;            /* 深灰 —— 但被 Tailwind 当“表面色”用 */
--muted-foreground: 48 4% 42%; /* 文字色 */
```

徽标「本地检索」的类是 `border-border bg-muted text-muted-foreground`，
于是变成 **47% 灰底 + 42% 灰字**，实测对比度 **1.19:1** —— 肉眼就是一块黑底黑字。

更隐蔽的是第二处：`--accent` 在本项目里是**品牌绿**（`164 41% 31%`，深绿），
但组件里把它当 shadcn 的“hover 表面色”用：

```tsx
<Button variant="ghost">…</Button>   // hover:bg-accent（深绿）+ 默认深色字
<button className="hover:bg-accent">历史会话</button>  // 只有背景，没有文字色
```

hover 一下，背景变深绿、文字仍是近黑 —— 又是一次黑底黑字。

第三处是布局：`SheetContent` 的关闭按钮是
`absolute right-4 top-4` + 16×16 的图标本身；
而 `ChatPanel` 头部最右边的「新对话」正好顶到同一角落，实测重叠 **256px²**。

---

## 3. 逐块改动

### 3.1 修 `--muted` 语义，并迁移 7 处“把它当文字色”的旧规则

```css
/* frontend/src/styles.css */
--muted: 48 10% 93%;          /* 表面色：浅灰 */
--muted-foreground: 48 4% 40%; /* 文字色 */
```

改完必须同步迁移旧用法：`styles.css` 里有 **7 处** `color: hsl(var(--muted))`
（`.agent-header .hint` / `.empty` / `.chip-label` / `.meta-row` / `.map-hidden-hint` /
`.map-fallback p` / `.identity-card code` / `.place-meta…`），全部改成
`hsl(var(--muted-foreground))`。**只改 token 不迁移，这些文字会变成近白字压浅底。**

### 3.2 修 hover 语义：不要把品牌绿当 hover 表面

| 位置 | 旧 | 新 | 原因 |
| --- | --- | --- | --- |
| `Button variant="ghost"` | `hover:bg-accent`（深绿） | `hover:bg-muted`（浅灰表面）+ `text-foreground` | 图标按钮 hover 不再变黑底 |
| `ChatPanel` 历史会话行 | `hover:bg-accent` | 补 `hover:text-accent-foreground` | 保留品牌绿，但文字转白 |
| `TripDrawer` 两个 Tab | `hover:bg-accent hover:text-foreground` | `hover:text-accent-foreground` | 同上 |
| 上传区（`ImportCard`/`VerifyCard`） | `hover:bg-accent/60`、拖拽 `/70` | `/10`、`/15` | 60% 绿底会把 40% 灰的说明文字压到 2:1 |
| `Sheet` 关闭按钮 | 无 hover 底 | `hover:bg-accent hover:text-accent-foreground` | 32px 点击区需要一个可见反馈 |

### 3.3 关闭按钮与「新对话」分开

`frontend/src/components/ui/sheet.tsx`：

```tsx
<DialogPrimitive.Close className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-md
  text-foreground opacity-70 ring-offset-background transition hover:bg-accent hover:text-accent-foreground
  hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
  <X className="h-4 w-4" />
  <span className="sr-only">关闭</span>
</DialogPrimitive.Close>
```

`frontend/src/pages/AgentPage/ChatPanel.tsx` 头部留出通道：

```tsx
<div className="flex items-center justify-between gap-2 border-b py-3 pl-4 pr-14">
  …
  <Button className="px-2 sm:px-3"><History/><span className="hidden sm:inline">历史</span></Button>
  <Button className="px-2 sm:px-3"><RotateCcw/><span className="hidden sm:inline">新对话</span></Button>
</div>
```

- `pr-14` = 56px：右侧交给关闭按钮（`right-3` + 32px = 44px），还留 12px 间隙；
- 窄屏（<640）两个按钮收成图标，标题不再被挤成「旅忆…」；
- 关闭按钮从 16px 图标变成 32×32，手指也能点中。

### 3.4 深浅主题：DOM 是唯一事实源

**不引 context**。真正的事实源是 `<html class="dark">`，所有颜色走 CSS 变量；
组件只读/只改这一条，就不会出现“某个弹层还是浅色”的局部不同步。

```ts
// frontend/src/lib/theme.ts
export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'tm-theme';

readStoredTheme()        // localStorage，读不到返回 null
systemPrefersDark()      // matchMedia('(prefers-color-scheme: dark)')
resolveInitialTheme()    // 用户选过听用户的，否则跟随系统
applyTheme(theme)        // 只改 DOM：classList.toggle('dark') + data-theme
setTheme(theme)          // 改 DOM + 写 localStorage（try/catch）
applyInitialTheme()      // 入口调用
```

深色 token 只覆盖变量，不写 `dark:` 变体：

```css
.dark {
  --bg: #0f1316; --panel: #171d21; --text: #e7ecef;
  --background: 200 12% 7%;  --foreground: 200 8% 92%;
  --primary: 164 45% 55%;    --primary-foreground: 200 30% 8%;
  --muted: 200 8% 17%;       --muted-foreground: 200 6% 68%;
  --accent: 164 32% 38%;     /* 白字压它 4.6:1；42% 时只剩 3.9:1 */
  --border: 200 8% 22%; --input: 200 8% 26%; --ring: 164 45% 60%;
  color-scheme: dark;
}
```

两套 hex 遗留变量（`--bg/--panel/--text`）必须一起覆盖，否则分享页、地图占位、
旧对话页的规则会留在浅色。**刻意不改 `.replay-root`**：轨迹回放本身就是固定深色舞台。

### 3.5 首屏不闪白

深色用户刷新时，如果等 React 挂载才加 `dark`，会先看到一帧白底。两层兜底：

1. `frontend/index.html` 的 `<head>` 里同步执行一小段脚本（在 CSS/React 之前）：
   读 `tm-theme`，没有就跟随系统，直接给 `<html>` 加类；
2. `main.tsx` 在 `createRoot` 之前再调一次 `applyInitialTheme()`（幂等）。

内联脚本与 `resolveInitialTheme()` 的规则必须一致 —— **改一处要改两处**。

### 3.6 切换按钮放右上角

`frontend/src/components/ThemeToggle.tsx`，挂在 `MapPage` 的右上角：

```tsx
<ThemeToggle className="absolute right-4 top-4 z-20" />
```

选位理由：左上品牌条、左下工具栏、右下 AI FAB、右缘抽屉 Tab 都已占用，
右上角是唯一空角；1440 与 390 两种宽度下与全部既有按钮的重叠面积都是 0。

- 图标语义：浅色显示月亮（点我去深色），深色显示太阳；
- `aria-pressed` 表示“深色是否开启”，`aria-label` 说明目标状态；
- hover 用 `bg-muted`（不用品牌绿），焦点环 2px。

### 3.7 顺带修窄屏底部重叠

390px 下，左下角「模糊圈半径是承诺半径…」会铺到屏幕中间，与底部居中的
「可见 N 个点 / 照片 N」计数叠加。计数在窄屏隐藏（`hidden sm:block`）——
隐私承诺优先，计数让位。

---

## 4. 文件清单

| 文件 | 改动 | 知识点 |
| --- | --- | --- |
| `frontend/src/styles.css` | `--muted` 语义修正、7 处旧文字色迁移、`.dark` token、`html` 背景、深色 `--accent` 取值 | CSS 变量语义、shadcn token 体系、对比度计算 |
| `frontend/index.html` | 首屏主题内联脚本 | 关键渲染路径、避免 FOUC |
| `frontend/src/lib/theme.ts` | 主题读写（新） | 以 DOM 为事实源、localStorage 降级 |
| `frontend/src/components/ThemeToggle.tsx` | 切换按钮（新） | 无障碍状态、零重叠布点 |
| `frontend/src/main.tsx` | 挂载前应用主题 | 渲染顺序 |
| `frontend/src/pages/MapPage/MapPage.tsx` | 挂 ThemeToggle；窄屏隐藏计数 | 绝对定位层级 |
| `frontend/src/components/ui/button.tsx` | ghost hover 改 `bg-muted` | CVA 变体、hover 表面色 |
| `frontend/src/components/ui/sheet.tsx` | 关闭按钮 32×32 + `right-3` | 触摸目标、绝对定位冲突 |
| `frontend/src/components/ui/badge.tsx` / `alert.tsx` / `toast.tsx` | 硬编码浅色状态补 `dark:` 变体 | Tailwind `darkMode: class` |
| `frontend/src/pages/AgentPage/ChatPanel.tsx` | 头部 `pr-14`、窄屏图标化、历史行 hover 文字色 | flex 空间分配 |
| `frontend/src/pages/MapPage/TripDrawer.tsx` | Tab hover 文字色、行/卡片 hover 底色 `/60 → /10` | 嵌套文字色不被父级覆盖 |
| `frontend/src/pages/SharePage/ImportCard.tsx` / `VerifyCard.tsx` | 上传区 hover/拖拽底色降饱和 | 同上 |

**没有碰**：`apps/track-studio/**`（另见阶段 17）、`packages/**`、`backend/**`、
任何测试文件、地图适配层（`pages/MapPage/amap.ts`、`MapCanvas.tsx`）。

---

## 5. 怎么验证

### 5.1 命令

```bat
npm run dev -w travel-memory-frontend -- --port 5173
:: 注意：Vite 只监听 localhost(::1)，请开 http://localhost:5173/，不要用 127.0.0.1

npm run typecheck -w travel-memory-frontend
npm test      -w travel-memory-frontend
npm run build -w travel-memory-frontend
```

本机实测（2026-11-21）：

```
typecheck  exit 0
test       429 passed / 436（7 条 photoCards 为既有 CRLF 失败）
build      1775 modules / 3.98s / CSS 49.07 kB
```

> 那 7 条失败：`src/pages/MapPage/replay/photoCards.test.ts` 用 `indexOf('…update(\n…')`
> 做源码断言，而本机 `core.autocrlf=true`、工作区是 CRLF，`indexOf` 返回 -1。
> CI 跑在 Linux（LF）上，不受影响；与本阶段改动无关。

### 5.2 无头浏览器断言（CDP，无需 Playwright）

```bat
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
  --headless=new --disable-gpu --remote-debugging-port=9222 ^
  --user-data-dir="%TEMP%\tm-edge-profile" about:blank
```

| 检查 | 表达式 / 操作 | 实测 |
| --- | --- | --- |
| 浅色 token | `getComputedStyle(body).backgroundColor` | `rgb(247,247,245)` |
| 深色切换 | 点 `[aria-label^="切换到"]` 后读 `documentElement.className` | `dark` / `data-theme=dark` |
| 深色底色 | 同上读 `body` | `rgb(15,19,22)` |
| 持久化 | reload 后读 `localStorage['tm-theme']` | `dark`，class 仍为 `dark` |
| 对比度 | 遍历 `body *` 叶子节点，`fg` 与“向上找到的第一个不透明背景”算 WCAG 比值 | 浅色最低 5.15（静态）/ 4.8（hover）；深色 7.67 / 6.28 |
| 关闭按钮重叠 | 关闭按钮与「新对话」的 `getBoundingClientRect` 交集 | 改前 256px² → 改后 **0** |
| 主题按钮重叠 | 主题按钮与其余全部 `button` 交集 | 1440/390 均为 **[]** |
| 标题截断 | `title.scrollWidth > title.clientWidth` | `false` |
| 关闭按钮尺寸 | 关闭按钮 rect | `32×32`（原 16×16） |

> 截图前必须把鼠标移开（`Input.dispatchMouseEvent` 到空白处），否则按钮停在 `:hover` 态，
> 截出来的颜色和静态态不一致。

### 5.3 手工清单

1. `http://localhost:5173/` → 右上角点月亮 → 整页变深色；刷新后仍是深色；
2. 系统设为深色、清掉 `localStorage['tm-theme']` → 首次打开就是深色；
3. 深色下打开 AI 抽屉：标题「旅忆助手」完整、徽标可读、X 与「新对话」之间有间隙；
4. 悬停「生成信物」「历史」「新对话」与历史会话行：文字仍可读；
5. 390px 宽：主题按钮不压品牌条，底部计数隐藏、承诺说明不被盖住。

---

## 6. 踩过的坑

1. **同一个 token 两种语义**：`--muted` 被当表面色（`bg-muted`）又被当文字色（`hsl(var(--muted))`）。
   改 token 必须同时迁移旧引用，否则“文字消失”比“文字看不清”更难查。
2. **本项目的 `--accent` 是品牌绿，不是 shadcn 的浅灰 hover 色**。
   任何 `hover:bg-accent` 都要么配 `hover:text-accent-foreground`，要么换成 `bg-muted`。
3. **Tailwind 类冲突不看书写顺序**：`px-4` 与 `pr-14` 同时出现时由生成 CSS 的顺序决定胜负；
   要精确控制就写 `pl-4 pr-14`，别依赖“后面的类覆盖前面的”。
4. **CDP 点完按钮，鼠标还停在上面**：截图会带 `:hover`，看起来像“配色又错了”。
   截图前先 `mouseMoved` 到空白处。
5. **Vite 只监听 `localhost`（::1）**：`http://127.0.0.1:5173` 会 `ERR_CONNECTION_REFUSED`，
   无头浏览器里就是一张“无法访问此页面”。
6. **`vite build` 与 `vite dev` 同时跑会把 dev 进程带崩**（本机 `0xC0000409`）：
   先关 dev，再 build。
7. **Radix 打开 Sheet 会自动聚焦第一个可聚焦元素**，所以截图里「历史」带焦点环；
   这是预期行为，不是样式 bug。

---

## 7. NOT RUN

| 项 | 原因 | 影响 |
| --- | --- | --- |
| 深色下的高德底图 | 本机无 `VITE_AMAP_JS_KEY`，地图走 `map-fallback` | 真机上深色壳里仍是浅色瓦片；需要 `setMapStyle` 才能跟主题（未实现，见下） |
| 真机触屏 / iOS Safari | 无真机 | 32px 关闭按钮的触摸手感、`-webkit` 滚动条未实测 |
| 屏幕阅读器 | 无 NVDA/VoiceOver | `aria-pressed` / `aria-label` 只做了属性检查 |
| Chrome 强制深色（Auto Dark Mode） | 未模拟 | 可能与 `.dark` 叠加，未验证 |

**已知限制**：深色模式只换壳层 token，不换高德瓦片。要换需要给 `AmapMap` 补
`setMapStyle` 类型并在主题变化时调用；本机没有 Key 无法验证，所以没有硬写。

---

## 8. 回滚

```bat
git checkout -- frontend
del frontend\src\lib\theme.ts frontend\src\components\ThemeToggle.tsx
```

单项回滚：

- 只撤主题：删 `.dark` 块与 `index.html` 内联脚本，移除 `MapPage` 里的 `<ThemeToggle />`；
- 只撤黑底黑字：把 `--muted` 改回 `52 3% 47%`，并把 7 处 `--muted-foreground` 改回 `--muted`；
- 只撤重叠修复：`ChatPanel` 头部 `pr-14` 改回 `px-4`，关闭按钮回到 `right-4 top-4`。

---

## 9. 动手练习

1. 把 `--muted` 临时改回 `52 3% 47%`，打开 AI 抽屉看「本地检索」—— 体会“表面色/文字色”混用的后果。
2. 把 `.dark` 的 `--accent` 改成 `164 32% 42%`，用 §5.2 的对比度脚本量白字，应降到 3.9:1。
3. 在 390px 宽把 `MapPage` 里计数条的 `hidden sm:block` 去掉，观察它和承诺说明的重叠。
