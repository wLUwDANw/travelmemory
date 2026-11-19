# 旅忆地图 · 轨迹演示站（已退役 / RETIRED）

> **阶段 13（W13-6）起，本项目已退役。**
>
> - 它的 **UI 能力已合并到 `apps/track-studio` 的深色独立入口**（`index.html` → `src/theme-dark/**`）：
>   首屏 / 补地点 / 播放 / HUD / 时间轴 / 照片卡片 / 导出视频全部搬过去了。
> - 本仓库**只保留代码不再维护**：不再接收功能、不再修样式、不再更新依赖。
> - `npm run dev` 仍然可以启动（它是一份自包含的 Vite 项目），但**请优先使用 Track Studio**。
>
> 为什么退役：同一个"把相册走成一条会动的地图"的界面存在两份实现，意味着每个交互细节
> （卡片避让、相机阻尼、时间轴性能契约）都要改两遍，而且两边会慢慢漂移。
> 合并进 Track Studio 之后，那些调过的参数只有一处真源。

---

## 现在该用哪个

| 你想要 | 去哪里 |
| --- | --- |
| 看轨迹回放、用演示线、导入自己的照片、导出视频 | `apps/track-studio`（深色独立入口 `index.html`） |
| 主应用内嵌入的轨迹视图 | `apps/track-studio`（浅色嵌入入口 `embed.html`） |
| 选照片 + 填旅程 → 生成加密 `.trailshare` 信物 | `apps/trailshare-standalone` |

启动 Track Studio：

```bash
npm run dev -w @travelmemory/track-studio             # http://localhost:5174
npm run dev -w @travelmemory/track-studio -- --host   # 手机同网段看
```

Track Studio 的两个入口与各自的承诺（详见它的源码注释）：

| 入口 | 主题 | 地图 | 网络 |
| --- | --- | --- | --- |
| `index.html` | 深色（从本展示站移植） | 自绘示意格网 | **零网络请求**（CSP 里一个地图域名都没有） |
| `embed.html` | 浅色 | 高德 / 降级格网 | 仅允许地图底图 |

## 迁移对照（本展示站 → Track Studio）

| 本展示站 | Track Studio |
| --- | --- |
| `src/App.tsx` 的 `PlayStage` | `src/theme-dark/App.tsx` 的 `PlayStage`（主循环逐行移植） |
| `src/ui/{Hud,Timeline,PhotoCards,Landing,SetupPanel}.tsx` | `src/theme-dark/ui/` 同名文件 |
| `src/data/demoJourneys.ts` | `src/theme-dark/data/demoJourneys.ts`（数据一行未改） |
| `src/map/baseMap.ts` | `src/theme-dark/map/gridMap.ts`（只留降级格网，删掉 SDK 分支） |
| `src/styles.css` | `src/theme-dark/styles.css`（作用域化到 `.theme-dark`） |
| `src/lib/{exif,thumb}.ts` | 不再需要：改由 `@travelmemory/photo-source` 统一读 EXIF + 缩略图 |
| 播放速度曲线 | Track Studio 用 `core/speedCurve`（按段距离分档），比这里的匀速更快出效果 |

---

## 历史资料（仅供审计，不代表当前行为）

原本的运行方式：

```bash
cd showcase
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit（应用 + 配置两份 tsconfig）
npm run test         # vitest run
npm run build        # 类型检查 + 产出 dist/
```

技术栈：Vite 5 + React 18 + TypeScript 5 + Tailwind CSS 3；运行时依赖只有
`react` / `react-dom`；EXIF 解析、坐标转换、墨卡托投影、样条插值、缩略图生成全部手写；
演示照片是程序化渐变，不请求任何网络图片。

高德 Key（历史上）：`src/map/baseMap.ts` 通过 `<script>` 动态加载高德 JS API 2.0，
Key 从 `VITE_AMAP_JS_KEY` / `VITE_AMAP_SECURITY_CODE` 读取，8 秒超时后切到降级格网。
Track Studio 的深色入口**不再有这段代码**（零网络），浅色嵌入入口用的是
`@travelmemory/amap-loader`。

当年调过的、现在仍然被 Track Studio 继承的几个结论（改 Track Studio 前值得读）：

- **相机阻尼**：`k = 1 - exp(-dt / tau)`（tau = 0.22s），与帧率无关；匀速前进时相机
  稳定落后一点点，光点自然浮在中心偏前。
- **投影走解析公式，不读 `getCenter()`**：高德 2.0 的平面坐标就是标准 EPSG:3857，
  `scale = 256 * 2^zoom` 可直接算；`getCenter()` 在动画未结束时返回中间值。
- **逐帧 `setCenter` 必须 `immediately = true`**，构造时关掉 `animateEnable` / `jogEnable`。
  Track Studio 深色版把这条换成了"自绘格网按 40ms 时间闸重绘"。
- **轨迹发光不用 `shadowBlur`**：同一 Path2D 描三遍（10px / 4px / 1.6px）。
- **主循环只写 DOM**：HUD 文字、卡片 transform/opacity、时间轴 canvas 全部走 ref；
  唯一一次 `setState` 发生在"播放状态变化"的那一帧。
- **卡片显隐不能用米数阈值**：4x 下 900m 窗口只有几毫秒，必须按"名次窗口 + 停留时长"。
- **时间轴 `draw()` 里不许读布局**：尺寸由 `ResizeObserver` 缓存，否则每帧强制同步重排。

目录结构（历史，仅供对照上面的迁移表）：

```
src/
├── App.tsx              模式机 + 单 rAF 主循环 + 播放舞台
├── data/demoJourneys.ts 两条内置演示路线
├── lib/                 exif / thumb / 格式化（几何与样条已下沉到 packages/trail）
├── map/baseMap.ts       高德加载 / 相机驱动 / 标定 / 降级格网
├── ui/                  Hud / Timeline / PhotoCards / Landing / SetupPanel
└── styles.css           Tailwind + 视觉 token + 卡片/HUD 样式
```
