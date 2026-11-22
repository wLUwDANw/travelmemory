# 阶段 17：浅色嵌入版 × 深色独立版 —— 视觉细节对齐与可访问性补齐

> 状态：**未验证**（单测 / 类型 / 构建 / 无头浏览器走查已跑，真高德底图与真机未跑，见 §7）
> 范围：只改 `apps/track-studio/src/theme-light/**` 与 `theme-dark/**` 的样式与 UI 组件；不碰 `core/`、`packages/`、协议与数据模型。
> 姊妹篇：[stage18](./stage18-main-app-dark-theme.md) 管主应用（`frontend/**`）的黑底黑字、按钮重叠与深浅主题切换，两篇不重叠。
> 日期：2026-11-21

---

## 1. 这一阶段要解决什么

Track Studio 有两个入口、两套 UI：

| 入口 | 主题 | 文件 | 场景 |
| --- | --- | --- | --- |
| `embed.html` | 浅色 | `src/theme-light/**` | 主应用里的 iframe（有父窗口、无 Key 时降级格网） |
| `index.html` | 深色 | `src/theme-dark/**` | 独立打开（零网络、自绘省界） |

两套 UI 的**配色必须不同**（浅色不能撕裂主应用的浅色页面，深色是独立舞台），
但**同一批交互状态的"长相"应该相同**。阶段 13~16 之间两边各自迭代，出现了这些漂移：

1. **无地图 Key 的提示太弱**：首屏只有一行 `.hint`；补位置页干脆不提示，用户对着一片网格猜"地图是不是挂了"。
2. **空状态缺失**：把照片删光后只剩一个禁用按钮；"0 张带位置"和"没有照片"两种空，文案却一样。
3. **进度条只有滑块**：`<input type=range>` 的填充是静态渐变，看不出播放到哪；`outline: none` 让键盘焦点彻底不可见。
4. **键盘双重动作**：焦点在「播放」按钮上按空格，按钮 click 与 window 上的快捷键各 toggle 一次 = 等于没按；焦点在进度条上按 ←/→ 会跳两倍。
5. **窄屏挤压**：1280 宽下 `暂停` / `导出视频` 被 flex 压成两行；深色版 420px 侧栏 + 地图在 600px 宽下无法使用。
6. **两处真实重叠**：深色播放页的「导出视频」盖住右上角日期；时间轴在窄屏把 `07.12 07.13 07.14` 叠成一团。
7. **文案口径不一**：同一个「照片没有坐标」的状态，浅色叫「无坐标」，深色叫「待定位」；「至少需要 2 张带位置的照片」散落三处。

### 出口条件

- [x] 两个主题共用一套"组件语法"：提示条 / 空状态 / 焦点环 / 触摸目标（对照表见 §3）
- [x] 无 Key 时：首屏、补位置页、播放页**三处**都有降级说明，且说明里包含"为什么"与"哪些能力不受影响"
- [x] 无照片、无坐标各有独立空状态，且都给出下一步动作
- [x] 进度条有可见填充 + 百分比读数 + `aria-valuetext` + 可见焦点环
- [x] 键盘在按钮 / 进度条 / 下拉框上不触发全局快捷键的重复动作
- [x] 620 / 900 / 420 三档窄屏规则；`暂停`、`导出视频` 不再换行
- [x] `npm run typecheck`、`npm test`（track-studio）、`npm run build` 全绿
- [x] 无头 Edge 实测：焦点环 2px、进度条 `--seek-progress=27.91%`、空状态标题、深色时间轴 56px

---

## 2. 约束：对齐的是"语法"，不是"配色"

一开始最容易走错的一条路：把浅色版改成深色版的圆角 / 字号 / 黑底，让两边"看起来一样"。
这会直接破坏产品约束 —— 浅色版是 iframe，必须融进主应用的浅色页面（`PROJECT.md` 的红线之一）。

所以本阶段对齐的是 **component grammar**（组件语法）：

| 语义 | 浅色（embed） | 深色（standalone） | 对齐内容 |
| --- | --- | --- | --- |
| 提示条 | `.notice` + `.notice-title` + `.notice-body` | `.setup-hint` / `.topbar-note` / `.play-note` | 都写"是什么 + 为什么 + 影响范围"，不用单行脚注 |
| 空状态 | `.empty` + `.empty-title` + `.empty-body` + `.empty-actions` | 同左（同名类） | 结构完全一致，只有配色不同 |
| 键盘焦点 | `:focus-visible` → 2px 实线 + 2px 偏移 | 同左 | 每个可点元素都有，且颜色在各自底色上可辨 |
| 数字 / 代码 | `--mono`、`tabular-nums` | `--font-mono`、`tabular-nums` | 坐标、时间、百分比、公里数都用等宽数字 |
| 触摸目标 | 窄屏 `.btn-tiny` ≥ 32px，主按钮 ≥ 40px | 同左 | 拇指可点 |

**没有做的事**（也是有意的）：

- 不统一圆角（浅色 10px / 深色 3~4px）—— 圆角是各自的视觉气质，不影响可用性；
- 不统一字号体系（浅色 13~14px，深色 10~12px + letter-spacing）—— 独立版是"仪表盘"，嵌入版是"表单页"；
- 不把浅色版的 `.hint` / `.error` 删掉 —— 它们仍被其它页面使用，新增 `.notice` 是叠加而非替换。

---

## 3. 设计：一条"提示条"应该说什么

无 Key 的提示是这一阶段最典型的文案设计。旧文案只有一句：

> 底图需要配置地图服务；轨迹与播放不受影响（会自动切换为示意格网）。

它回答了"是什么"，但没回答"为什么"和"我该做什么"。新结构固定为三段：

1. **标题 = 结论**：`未配置地图 Key：底图会退化成示意格网`
2. **正文 = 影响范围 + 出路**：`轨迹、播放、导出视频都不受影响……在 .env 里配置 VITE_AMAP_JS_KEY 后重启`
3. **语气 = 不报警**：这是"降级"不是"错误"，所以用琥珀色（`--warn`）而不是红色（`--danger`）。

播放页的降级提示还必须同时覆盖两条成因（无 Key / 加载超时），否则用户会去查错的配置：

> 底图未加载，已切换示意格网：可能没有配置地图 Key，或底图加载超时。轨迹、播放与导出都不受影响。

---

## 4. 逐块改动

### 4.1 全局焦点环（两个主题）

浅色版此前**没有任何** `:focus-visible` 规则，深色版只有一个 `.transport-select`。
现在每个可点元素都有焦点环：

```css
/* theme-light/styles.css */
.theme-light .btn:focus-visible,
.theme-light .location-editor-item:focus-visible,
.theme-light .privacy-how summary:focus-visible,
.theme-light .photo-transport select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 主按钮是蓝色渐变，焦点环要更深才看得出来 */
.theme-light .btn-primary:focus-visible {
  outline-color: #0b5f8a;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(14, 123, 181, 0.25);
}
```

```css
/* theme-dark/styles.css：颜色换成 accent-2（浅青），近黑底上更亮 */
.theme-dark .btn:focus-visible,
.theme-dark .chip:focus-visible,
.theme-dark .demo-card:focus-visible,
.theme-dark .photo-cell:focus-visible,
.theme-dark .back-btn:focus-visible,
.theme-dark .export-btn:focus-visible,
.theme-dark .tl-btn:focus-visible,
.theme-dark .speed-btn:focus-visible,
.theme-dark .replay-btn:focus-visible,
.theme-dark .transport-select:focus-visible {
  outline: 2px solid var(--accent-2);
  outline-offset: 2px;
}
```

**为什么用 `:focus-visible` 而不是 `:focus`**：鼠标点按钮不该留下"焦点框套在按钮上"的脏边；
键盘 Tab 必须看得见。`:focus-visible` 正是浏览器用来区分这两种意图的伪类。

顺带修掉两个"焦点不可见"的元凶：

- `.seek { outline: none }` → 删除，改由 `.seek:focus-visible` 提供焦点环；
- `.privacy-how summary { outline: none }` → 删除，走全局规则。

### 4.2 提示条 `.notice`（浅色新增）

```css
.theme-light .notice {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  background: #ffffff;
  padding: 10px 12px;
  margin: 0 0 14px;
}
.theme-light .notice-title { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
.theme-light .notice-body  { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--text-dim); }
.theme-light .notice-warn  { border-left-color: var(--warn);   background: #fffbf2; }
.theme-light .notice-error { border-left-color: var(--danger); background: #fff6f5; }
```

用在三处：

| 位置 | 类名 | 文案 | 无障碍 |
| --- | --- | --- | --- |
| 首屏无 Key | `notice notice-warn` | 未配置地图 Key：底图会退化成示意格网 | `role="status"` |
| 首屏导入失败 | `notice notice-error` | 读取照片失败。请重试，或换一个浏览器。 | `role="alert"` |
| 编辑页全部无坐标 | `notice notice-warn` | 这 N 张照片都没有位置信息 | `role="status"` |

### 4.3 空状态 `.empty`（两个主题同名类）

结构固定为：标题（事实）→ 说明（原因 + 下一步）→ 动作（按钮）。浅色版：

```css
.theme-light .empty {
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: #ffffff;
  padding: 30px 22px;
  text-align: center;
  margin: 8px 0 18px;
}
.theme-light .empty-title { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
.theme-light .empty-body  { max-width: 48ch; margin: 0 auto 14px; font-size: 12.5px; line-height: 1.8; color: var(--text-dim); }
.theme-light .empty-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; }
```

深色版同名类只换配色（`rgba(8,14,24,.5)` + `--line` 虚线 + `--muted` 文字）。

落地的六处（其中「全部无坐标」用提示条而不是空状态卡片）：

| 页面 | 触发条件 | 标题 | 动作 |
| --- | --- | --- | --- |
| `theme-light/EditPanel` | `photos.length === 0` | 还没有照片 | 重新选照片 → `onBack` |
| `theme-light/EditPanel` | 有照片但 `locatedCount === 0` | 这 N 张照片都没有位置信息（提示条，不是空状态卡片） | 指向「补全位置」 |
| `theme-light/DonePanel` | `videoUrl === null` | 这个浏览器没有产出视频 | 提示下载 journey.json |
| `theme-light/App`（死路页） | `mode === 'play'` 但没有轨迹 | 现在只有 N 张带位置 | 返回调整 |
| `theme-dark/SetupPanel` | `sorted.length === 0` | 还没有照片 | 添加照片 → `onAddPhotos` |
| `theme-dark/DonePanel` | `videoUrl === null` | 这个浏览器没有产出视频 | —（没有可点的出口） |

> 关键判断：`photos.length === 0` 与 `locatedCount === 0` 是**两种不同的空**。
> 前者要用户"去选照片"，后者要用户"去补坐标"。旧实现把两者都归到禁用按钮上，
> 用户看不出该做哪件事。

### 4.4 进度条：填充 + 读数 + 键盘

旧实现每帧只写 `range.value`，视觉上只有滑块在动（轨道是静态渐变）。现在每帧多写三样：

```ts
// theme-light/ui/PlayStage.tsx，主循环内
const percent = Math.round(clock.q * 100);
const range = rangeRef.current;
if (range) {
  range.value = String(Math.round(clock.q * 1000));
  range.style.setProperty('--seek-progress', `${(clock.q * 100).toFixed(2)}%`);
  if (percent !== lastPercent) range.setAttribute('aria-valuetext', `${percent}%`);
}
if (percent !== lastPercent) {
  lastPercent = percent;
  if (percentRef.current) percentRef.current.textContent = `${percent}%`;
}
```

CSS 用这个变量画两段渐变：

```css
.theme-light .seek {
  --seek-progress: 0%;
  background: linear-gradient(90deg,
    var(--accent) 0 var(--seek-progress),
    #d7e3ef var(--seek-progress) 100%);
}
.theme-light .seek:focus-visible { outline: 2px solid var(--accent); outline-offset: 8px; }
.theme-light .seek:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 5px var(--accent-soft); }
```

**性能约束（必须保留）**：60fps 下不能 `setState`。文本与 `aria-valuetext` 只在"整数百分比变化"时写，
其余每帧只改一个自定义属性（不触发样式重算之外的布局）。

### 4.5 键盘：把"全局快捷键"和"控件原生行为"分开

这是本阶段最值得记住的一条。旧代码在 `window` 上监听 Space / ← / → / Home，
不区分焦点在哪，于是：

- 焦点在「播放」按钮 + 空格 → 按钮 click（toggle） + 全局 toggle = 没反应；
- 焦点在进度条 + ← → → range 原生走一步 + 全局 `seek(q ± 0.01)` = 跳两倍。

修复分两层：

```ts
// PlayStage.tsx：全局快捷键只在焦点不在表单控件上时生效
const isFormControl = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
    || tag === 'A' || element.isContentEditable;
};

const onKeyDown = (event: KeyboardEvent): void => {
  if (isFormControl(event.target)) return;   // ← 关键一行
  ...
};
```

```tsx
// 进度条：只有"会改值"的按键才暂停播放；Tab 离开不该顺手暂停
const SEEK_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
<input
  onKeyDown={(e) => { if (SEEK_KEYS.has(e.key)) handleSeekStart(); }}
  onKeyUp={(e) => { if (SEEK_KEYS.has(e.key)) handleSeekEnd(); }}
/>
```

配套可见性：播放页左下角加一行快捷键说明（`空格 播放/暂停 · ← → 微调 · Home 回到开头`），
`pointer-events: none` 不挡地图，900px 以下隐藏。

### 4.6 表单 / 卡片 / 按钮的细节对齐

| 问题 | 旧 | 新 | 为什么 |
| --- | --- | --- | --- |
| 倍速选中态对比度 | `.btn-tiny.is-active { color:#eaf7ff }`（浅字压浅底） | `color: var(--accent)` + `font-weight:600` | 旧值给深色底写的，浅色化后 2x/4x 几乎看不出哪个选中 |
| 路段标签 | 普通 12px 灰字 | 10px 等宽 + 字距 | 与深色 `.transport-leg` 同一语法 |
| 下拉框 | 无焦点环、28px 高 | `:focus-visible` 2px、`min-height:28px`、hover 边框 | 表单控件在两个主题里行为一致 |
| 照片行 | 无 hover | 只提亮边界、不做位移 | 位移会让「移除」按钮从指针下跑掉 |
| 状态徽标 | 「无坐标」 | 「待定位」+ `title="没有 EXIF 坐标，不会出现在轨迹上"` | 与深色版同一词；"无坐标"是事实，"待定位"是待办 |
| 主按钮文案 | `生成轨迹` / `至少需要 2 张…` | `生成轨迹（N 张带位置）` + 一行「还差 N 张」 | 深色版是「开始旅程（N 张已定位）」，两版都用"动作 + 数量" |

### 4.7 无 Key 降级：三个页面都要说

| 页面 | 旧 | 新 | 代码位置 |
| --- | --- | --- | --- |
| 首屏 | 一行 `.hint` | `.notice-warn`（标题 + 影响 + 配置方法） | `ui/Landing.tsx` |
| 播放页 | "底图未加载，已切换示意格网（轨迹与播放不受影响）" | 补上"可能没有配置地图 Key，或加载超时" | `ui/PlayStage.tsx` |
| 补位置页 | **不提示**（只在用高德时显示坐标系说明） | `mapKind === 'fallback'` → "示意格网（未配置地图 Key 或底图加载失败）· 点击取点照常可用" | `pages/LocationEditor.tsx` |

补位置页的实现要点：`createBaseMap()` 返回的控制器带 `kind: 'amap' | 'fallback'`，
它比"读环境变量"更准确（加载超时也会降级，而 Key 可能是有的）：

```ts
void createBaseMap(host, {...}).then((ctrl) => {
  controller = ctrl;
  setMapKind(ctrl.kind);       // ← 新增
  ...
});
```

### 4.8 窄屏：先塌布局，再收控件

| 断点 | 浅色 | 深色 |
| --- | --- | --- |
| ≤ 900px | 隐藏左下角快捷键提示（控制条会占满整行） | `setup` 从 `420px + 1fr` 塌成单列（上：照片与路段，下：地图 42vh） |
| ≤ 620px | 面板内边距收紧、表头换行、页脚按钮通栏、播放控件换行、时间轴 56px | 时间轴 56px、HUD 底角上移、`.play-note` 通栏、倍速按钮压窄（照片网格保持 3 列） |
| ≤ 420px | 首屏/完成页按钮 100% 宽、身份徽标通栏 | 照片网格 2 列、标题 HUD 收字距、字幕 18px |

另外一条与断点无关的修复：`.stage-controls .btn { flex: 0 0 auto; white-space: nowrap; }`。
1280 宽下也出现过「暂停」「导出视频」被压成竖排两个汉字，原因是 flex 收缩 + 没有 `nowrap`，
应该由进度条负责伸缩。

### 4.9 两处真实重叠

1. **深色播放页：导出按钮盖住日期**。`.export-btn` 与 `.hud-tr` 都锚在 `top:18px; right:20px`。
   修法：`.hud-tr { top: 56px }`，把日期整体让到按钮下方。
2. **时间轴日期叠字**。`Timeline.draw()` 无条件画每个 `day.label`，窄屏上 `07.12 07.13 07.14` 重叠。
   修法：记录上一个标签的 x，间距不足 38px 就不画后一个（`MM.DD` 在 10px 等宽下约 30px，留 8px 间隙）。
   **不引入 `measureText`**：主循环里每帧量文本会多一次字体上下文查询，且 jsdom 的 canvas 桩没有这个方法（会把测试打挂）。

```ts
let lastLabelX = Number.NEGATIVE_INFINITY;
for (...) {
  const x = PAD + usable * Math.min(1, Math.max(0, day.startS / total));
  // ...画刻度线...
  if (x - lastLabelX >= 38) {
    ctx.fillText(day.label, x + 4, TRACK_Y - 11);
    lastLabelX = x;
  }
}
```

### 4.10 文案对照表

| 场景 | 旧文案 | 新文案 |
| --- | --- | --- |
| 首屏无 Key | 底图需要配置地图服务；轨迹与播放不受影响（会自动切换为示意格网）。 | **未配置地图 Key：底图会退化成示意格网** + 轨迹、播放、导出视频都不受影响……配置 `VITE_AMAP_JS_KEY` 后重启 |
| 编辑页抬头 | 共 N 张，其中 M 张带位置信息。另外 K 张没有位置信息，不会出现在轨迹上。 | 三态：全部带位置 / 都还没有位置 / 其中 M 张带位置；另外 K 张…… |
| 缺坐标徽标 | 无坐标 | 待定位（`title` 说明它不会上轨迹） |
| 缺坐标提示 | 没有位置信息的照片已标为「无坐标」。想让它上轨迹，请在拍照时开启定位…… | 没有位置信息的照片已标为「待定位」：点上面的「补全位置」，或在拍照时开启定位。 |
| 全部缺坐标 | （无） | 这 N 张照片都没有位置信息 / 点「补全位置」…… |
| 主按钮 | 至少需要 2 张带位置的照片（禁用态文字） | 生成轨迹（N 张带位置） + 还差 N 张 |
| 死路页 | 这条轨迹至少需要 2 张带位置信息的照片。回去多选几张，或用「演示路线体验」看看效果。 | 现在只有 N 张带位置 / 回去多选几张，或用「补全位置」选中照片后在地图上点一下 |
| 播放降级 | 底图未加载，已切换示意格网（轨迹与播放不受影响） | ……可能没有配置地图 Key，或底图加载超时。轨迹、播放与导出都不受影响。 |
| 完成页无视频 | 视频录制不可用。 | 这个浏览器没有产出视频 + 支持 WebM 的浏览器清单 |
| 深色补点页空 | 把照片拖到首页，或者点「添加照片」。 | 还没有照片 + 可点的「添加照片」 |

---

## 5. 文件清单

| 文件 | 改动 | 对应知识点 |
| --- | --- | --- |
| `apps/track-studio/src/theme-light/styles.css` | 焦点环、`.notice`、`.empty`、进度条填充、窄屏三档、`.stage-controls` 不换行、reduced-motion | 手写 CSS 作用域、`:focus-visible`、CSS 变量做每帧进度 |
| `apps/track-studio/src/theme-light/ui/Landing.tsx` | 无 Key 提示条、错误提示条 | 降级文案三段式、`role=status/alert` |
| `apps/track-studio/src/theme-light/ui/EditPanel.tsx` | 两种空状态、徽标文案、抬头三态、主按钮数量 | 状态建模（空 vs 缺数据）、可点击的出路 |
| `apps/track-studio/src/theme-light/ui/DonePanel.tsx` | 空状态结构 | 复用 `.empty` 而不是再造一套 |
| `apps/track-studio/src/theme-light/ui/PlayStage.tsx` | 进度变量 / 读数 / aria、快捷键守卫、`SEEK_KEYS`、按钮 title、快捷键提示 | 60fps 只写 DOM、键盘事件冒泡与原生行为 |
| `apps/track-studio/src/theme-light/pages/LocationEditor.tsx` | `mapKind` → 降级说明、`aria-live` 读数 | 用控制器实际类型判断降级，而不是读 env |
| `apps/track-studio/src/theme-light/App.tsx` | 死路页改成 `.empty` | 同一语义同一结构 |
| `apps/track-studio/src/theme-dark/styles.css` | 焦点环、`.empty`、窄屏断点、HUD 下移、导入失败色 | 与浅色版同名类、断点策略 |
| `apps/track-studio/src/theme-dark/ui/SetupPanel.tsx` | 空状态卡片、顶栏文案 | 空状态里放"唯一该做的动作" |
| `apps/track-studio/src/theme-dark/ui/DonePanel.tsx` | 空状态结构 | 同上 |
| `apps/track-studio/src/theme-dark/ui/Landing.tsx` | 导入失败加 `role=alert` + 琥珀色 | 错误语义 |
| `apps/track-studio/src/theme-dark/ui/Timeline.tsx` | 日期标签防重叠 | 每帧绘制不量文本、jsdom 桩兼容 |

**没有碰**：`src/core/**`、`src/theme-*/map/**`、`packages/**`、`index.html`/`embed.html`、
任何测试文件、任何后端代码。`git diff --stat` 应只有上面 12 个源文件 + 本文档 + 索引一行。

---

## 6. 怎么跑起来验证

### 6.1 环境

```bat
cd /d D:\Git\travelmemory
npm install                 :: 根目录一次装完 workspaces
npm run dev -w @travelmemory/track-studio -- --port 5199 --strictPort
```

- 深色独立版：<http://localhost:5199/>
- 浅色嵌入版：<http://localhost:5199/embed.html>（直接打开会看到"请在主应用内使用"引导，这是预期）
- 浅色完整链路：<http://localhost:5199/embed-harness.html>（模拟父窗口，点「发送 init（身份 + 5 张照片）」即可注入照片）

> **注意**：Vite 首次编译要 1~2 秒，页面会先白一下。截图/断言前必须等
> `.theme-light .landing` 或 `.theme-dark .landing-title` 出现，不能固定 `sleep(500)`。

### 6.2 命令与期望输出

```bat
:: 类型
npm run typecheck -w @travelmemory/track-studio
:: 期望：无输出（tsc 两个 project 都通过）

:: 单测
npm test -w @travelmemory/track-studio
:: 期望：Test Files 22 passed (22) / Tests 175 passed (175)

:: 生产构建（会真正解析两份 CSS）
npm run build -w @travelmemory/track-studio
:: 期望：✓ 108 modules transformed / dist/index.html + dist/embed.html + 两份 App-*.css
```

本机实测（2026-11-21 20:26）：

```
 ✓ src/theme-dark/App.test.tsx (1 test) 170ms
 ✓ src/core/identity.qa.test.ts (4 tests) 32ms
 ✓ src/theme-light/map/controller.test.ts (2 tests) 8ms
 Test Files  22 passed (22)
      Tests  175 passed (175)
```

> **Windows 沙箱提示**：在受限沙箱里跑 vitest 会报 `Error: spawn EPERM`
> （esbuild 需要带管道的子进程）。这是沙箱边界，不是代码问题；用完整权限运行一次即可。

根目录还有一条 `npm test`（跑全部工作区），**本机结果是 1 个既有失败，与本次改动无关**：

```
frontend            Test Files 1 failed | 38 passed (39) / Tests 7 failed | 429 passed (436)
packages/*          14 + 17 + 21 + 56 + 67 全部通过
track-studio        22 files / 175 tests 通过
trailshare          19 files / 168 tests 通过
```

`frontend/src/pages/MapPage/replay/photoCards.test.ts` 的 7 条失败是**源码字符串断言撞上 CRLF**：
测试里写 `indexOf('      update(\n  scene: Sce…')`，而本机 `core.autocrlf=true`，工作区是 CRLF，
`indexOf` 返回 -1。验证方法：

```js
const t = require('fs').readFileSync('frontend/src/pages/MapPage/replay/PhotoCards.tsx', 'utf8');
t.includes('      update(\n');    // false
t.includes('      update(\r\n');  // true
```

这条不在本阶段范围内（未改 `frontend/` 一行），记录在这里是为了让下一个人别误以为是主题改动引起的。

### 6.3 真浏览器视觉走查（无头 Edge + CDP）

本机没有 Playwright，仓库里也没有引入它。用 Edge 自带的 CDP 即可复现：

```bat
:: 1) 启动无头 Edge（CDP 端口 9222）
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
  --headless=new --disable-gpu --remote-debugging-port=9222 ^
  --user-data-dir="%TEMP%\tm-edge-profile" about:blank

:: 2) 确认端口活着
curl http://127.0.0.1:9222/json/version
```

然后 `node` 脚本（Node 22+ 自带全局 `WebSocket`/`fetch`，无需依赖）做三件事：
打开页面 → 注入照片 / 点按钮 → `Runtime.evaluate` 读计算样式 + `Page.captureScreenshot` 存图。

最小骨架（完整脚本见 §6.4 的断言表，按需拼装即可）：

```js
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:5199/embed-harness.html' });
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
```

### 6.4 断言表（每一条都是本机实测值）

| 检查 | 表达式 / 操作 | 期望 |
| --- | --- | --- |
| 浅色首屏无 Key | `document.querySelector('.notice').className` | `notice notice-warn` |
| 注入照片 | 点 harness 的 `#btn-init` → iframe 内点「从主应用相册选」 | `.photo-item` = 5，`.photo-transport select` = 4 |
| 主按钮文案 | `.panel-foot` 文本 | `生成轨迹（5 张带位置）` |
| 焦点环 | 在 iframe 内按 Tab，读 `getComputedStyle(activeElement)` | `outline-width: 2px`、`outline-offset: 2px`，`activeElement.matches(':focus-visible') === true` |
| 进度条填充 | 生成轨迹 → 播放 1.5s 后读 `.seek` | `style.getPropertyValue('--seek-progress')` ≈ `27.91%`，`background-image` 含两段渐变 |
| 进度读数 | `.seek-value.textContent` | `28%`（与 `aria-valuetext` 同步） |
| 降级提示 | `.stage-note` 文本 | 含「可能没有配置地图 Key，或底图加载超时」 |
| 无坐标态 | 注入 3 张 `lat/lng = null` 的照片 → 进编辑页 | `.notice-title` = `这 3 张照片都没有位置信息`；徽标 = `待定位`；主按钮 `disabled`；页脚含「还差 2 张」 |
| 空状态 | 逐张点「移除」（**必须一次一点**） | `.empty-title` = `还没有照片`，动作 = `重新选照片` |
| 深色焦点 | 播放页按 Tab | `.back-btn` / `.export-btn` / `.tl-btn` / `.speed-btn` / `.replay-btn` 全部 2px outline |
| 深色窄屏 | `Emulation.setDeviceMetricsOverride({width:600})` | `.timeline` 高 `56px`，`.hud-bl` 的 `bottom` = `78px`，日期标签不再叠字 |

**逐张点「移除」的原因**：React 18 会把同一轮事件里的多次 `setState` 合并。
同步 `while` 循环点 12 次，12 次都拿到同一个 `photo.id`，`filter` 后状态只变一次。
必须在每次点击后 `await` 一次渲染（真实用户也不可能一帧点 12 下）。

### 6.5 手工走查清单（没有脚本时按这个点）

1. `http://localhost:5199/embed-harness.html` → 「发送 init」→ 点「从主应用相册选」
   - [ ] 每行：缩略图 / 文件名 / UTC 时间 / 「到下一段」下拉 / 移除
   - [ ] Tab 键走一遍：按钮、下拉框都有 2px 焦点环
2. 点「生成轨迹」→ 播放页
   - [ ] 进度条左侧蓝色填充随播放增长，右侧浅灰；右侧 `%` 数字同步
   - [ ] 拖进度条、按 ←/→（焦点在进度条上）只跳一步，不是两步
   - [ ] 焦点在「暂停」上按空格：只切换一次
   - [ ] 左上角有降级说明；左下角有快捷键说明（≥900px 时）
3. 删光照片 → [ ] 看到「还没有照片」空状态，按钮可点回首页
4. 换成不带 GPS 的照片 → [ ] 顶部琥珀提示条 + 每行「待定位」+ 主按钮禁用 + 「还差 N 张」
5. `http://localhost:5199/` → 深色首页 → 演示轨迹 → 播放
   - [ ] 右上角日期不被「导出视频」遮住
   - [ ] Tab 走一遍：返回 / 导出 / 播放 / 倍速 / 重播都有焦点环
6. 浏览器窗口拉到 600px：
   - [ ] 深色时间轴变矮、日期不叠字、HUD 底角上移
   - [ ] 浅色播放控件换行，`暂停` / `导出视频` 不竖排
7. 拉回 400px：[ ] 浅色首屏按钮通栏、身份徽标整行

---

## 7. NOT RUN（诚实清单）

| 项 | 原因 | 影响 |
| --- | --- | --- |
| 真实高德底图（配置 `VITE_AMAP_JS_KEY`） | 本机无 Key，只验了降级格网 | `mapKind === 'amap'` 分支的右下角说明未在真底图上看过 |
| 深色 `setup` 空状态 | 深色只能通过"导入照片"进入 setup，而导入至少要有 1 张可读照片 | `.empty` 在深色 setup 里只做了类型/构建验证，未截图 |
| 触屏 / iOS Safari | 无真机 | `(pointer: coarse)` 触摸目标、`-webkit-` 滑块样式未实测 |
| 屏幕阅读器 | 无 NVDA/VoiceOver | `aria-valuetext` / `role=status` 只做了属性检查 |
| `prefers-reduced-motion` 实际效果 | 无头浏览器未模拟该媒体特性 | 规则存在，未截图对比 |

---

## 8. 执行记录（2026-11-21）

| 时间 | 命令 | 结果 |
| --- | --- | --- |
| 20:05 | `npm test -w @travelmemory/track-studio`（改动前基线） | 22 files / 175 tests 通过 |
| 20:08 | 同上（第一轮改动后） | 22 / 175 通过 |
| 20:24 | `npm run typecheck -w @travelmemory/track-studio` | 通过 |
| 20:26 | `npm test -w @travelmemory/track-studio`（最终） | 22 / 175 通过 |
| 20:29 | `npm run build -w @travelmemory/track-studio` | 108 modules，两份 CSS 产物 |
| 20:12~20:22 | 无头 Edge CDP 走查 | 10 张截图；断言见 §6.4，全部命中 |
| 20:31 | `npm test`（根目录，全工作区） | track-studio 175 / trailshare 168 / packages 175（14+17+21+56+67）全通过；`frontend` 7 条既有 CRLF 失败（见 §6.2） |
| 20:34 | `python tools/check_stage_index.py` | `[OK]`（20 份阶段文档，索引一致） |
| 20:35 | `typecheck` + `test` + `build`（最终一次） | 三者 exit 0；22 文件 / 175 测试；108 modules / 1.09s |

---

## 9. 踩过的坑（下次别再踩）

1. **CSS 变量沿 DOM 继承**：只要在 `.stage` 上重声明 `--bg`，播放页里所有走 token 的控件都会回到深色。
   排查"改了半天 CSS 没生效"先 `getComputedStyle(el).getPropertyValue('--bg')` 看来源。
2. **flex 默认会收缩**：控制条里 `暂停` / `导出视频` 被压成两行，不是字号问题，是 `flex-shrink`。
   给按钮 `flex: 0 0 auto`，让进度条（`flex: 1 1 240px`）去伸缩。
3. **React 18 批量更新**：脚本里"连点 12 次移除"只生效一次；UI 自动化必须每次点击后让出一帧。
4. **jsdom 的 canvas 桩**：`Timeline.test.tsx` 的假 context 只有 `fillText` 等少数方法，
   新增绘制代码不能依赖 `measureText`，否则测试直接 TypeError。
5. **Vite dev 首帧白屏**：固定 sleep 截到的是空白页；要轮询 DOM 里出现目标节点再截图。
6. **`:focus-visible` 需要键盘模态**：`el.focus()` 之后不一定匹配，必须真的派发 Tab 键事件。
7. **受限沙箱 + esbuild**：`spawn EPERM` 是沙箱的管道限制，不是依赖坏了；
   不要反复重试"换个写法"，用完整权限跑一次。

---

## 10. 动手练习

1. 把 `.theme-light .seek` 的 `--seek-progress` 换成 `background: linear-gradient(90deg, var(--accent), #b9d3e6)`（回到旧写法），
   播放时只剩滑块在动 —— 体会"变量填充"到底解决了什么。
2. 把 `isFormControl` 里的 `BUTTON` 删掉，键盘 Tab 到「暂停」后按空格：
   观察 `clock.playing` 在一次按键里翻转两次（toggle 两次 = 回到原状）。
3. 把 `.notice-warn` 的 `border-left` 从 3px 改成 0，再对比首屏"这条要不要读"的视觉重量。

---

## 11. 回滚

本阶段没有迁移、没有数据变更。回滚只需：

```bat
git checkout -- apps/track-studio/src/theme-light apps/track-studio/src/theme-dark
git checkout -- docs/stages/README.md
del docs\stages\stage17-light-dark-visual-alignment.md
```

（若只想关掉某一项：焦点环删掉 `:focus-visible` 段；进度填充删掉 `.seek` 的 `--seek-progress` 两行与
`PlayStage` 里 `setProperty` 那一行；空状态删掉对应 `.empty` 渲染块即可，互不依赖。）
