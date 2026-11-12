# 旅忆地图 · 轨迹演示站（demo）

一个**完全独立**的前端小项目：把照片还原成旅程。一条发光的轨迹在地图上生长，镜头阻尼跟随光点，
沿途照片卡片一张张浮出，四角 HUD 实时跳动日期 / 里程 / 进度。

- 技术栈：Vite 5 + React 18 + TypeScript 5 + Tailwind CSS 3
- 运行时依赖只有 `react` / `react-dom`
- EXIF 解析、坐标转换、墨卡托投影、样条插值、缩略图生成 **全部手写**，零额外包
- 演示照片是程序化渐变，**不请求任何网络图片**

---

## 1. 跑起来

```bash
cd demo
npm install
npm run dev          # http://localhost:5173
```

其它命令：

```bash
npm run typecheck    # tsc --noEmit（应用 + 配置两份 tsconfig）
npm run test         # vitest run（4 个纯逻辑测试文件）
npm run build        # 类型检查 + 产出 dist/
npm run preview      # 预览 dist/
```

## 2. 高德 Key

`src/map/baseMap.ts` 通过 `<script>` 动态加载高德 JS API 2.0，Key 从环境变量读取。

- `.env.local`（**已被 .gitignore 忽略，不要提交**）里填：

  ```
  VITE_AMAP_JS_KEY=你的key
  VITE_AMAP_SECURITY_CODE=配套安全密钥
  ```

  本仓库这份 `.env.local` 的值取自用户自己的 `frontend/.env.local`，仅存在本地。

- `.env.example` 是占位模板，可以提交。
- 加载前会先设 `window._AMapSecurityConfig = { securityJsCode }`，再插脚本。
- **8 秒超时 + onerror** 会切到降级模式：深色示意格网底图 + 顶部一行小字提示。
  降级时轨迹、播放、HUD、时间轴、照片卡片、手工补地点**全部正常工作**——没有 Key 也能完整演示。

没配 Key 也能 `npm run dev`，只是看不到高德底图。

## 3. 换成自己的照片

1. 首页点「导入我的照片」，或直接把照片拖进页面（也可以拖进 setup 页左侧）。
2. 读取 EXIF：有 GPS → 直接参与轨迹，标记 `EXIF`；有拍摄时间 → 用于排序与时间轴。
3. **没有 GPS 的照片**会被标成「待定位」（虚线边框）：
   - 点一张照片选中 → 在地图上点一下 → 写入坐标（map 给的是 GCJ-02，存的是 WGS84），
     自动跳到下一张待定位的；
   - `Ctrl / Shift` 多选，或点「全选待定位」，一次点击批量定位；
   - 批量时每张照片会沿经度方向累加约 45m 的偏移（仅为了让轨迹在「同一处」也能画出来，不代表真实位置）。
4. 至少 2 张已定位 → 「开始旅程」。

> 为什么必须手补：照片通过微信 / 各种平台传到电脑后，EXIF 里的 GPS 经常被抹掉，
> 只留拍摄时间。这条链路是刚需，不是附加功能。

## 4. 播放交互

进入播放页会**自动开始播放**（系统开了「减少动态效果」时不自动播，避免全屏动画）。

| 操作 | 效果 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 1% |
| `Home` | 回到起点 |
| 拖时间轴 | 暂停并 seek，松手恢复原播放状态 |
| `0.5x 1x 2x 4x` | 倍速（改的是进度推进速率） |
| `重播` | 回到起点、重置相机并播放 |

## 5. 关键实现

- **相机阻尼**：`k = 1 - exp(-dt / tau)`（tau = 0.22s），与帧率无关。匀速前进时相机稳定落后一点点，
  光点自然浮在中心偏前。
- **投影走解析公式，不读 `getCenter()`**：高德 2.0 的平面坐标就是标准 EPSG:3857（瓦片 256px），所以
  `scale = 256 * 2^zoom` 可以直接算出「每墨卡托单位多少 CSS 像素」；相机中心用我们自己下发的值。
  `getCenter()` 返回的是「实时中心点」，刚 setCenter 时可能是动画中间值，拿它标定会有一帧偏移。
  `lngLatToContainer` 只在 `map.on('complete')` 之后做一次比例校验（应对高 DPI 容器像素 ≠ CSS 像素）。
- **逐帧 `setCenter` 必须 `immediately = true`**：默认值是 `false`，会开启内部过渡动画，
  每帧一调就是帧与帧互相打架（表现为抽帧、中心跳变）。同时构造时关掉 `animateEnable` / `jogEnable`。
- **轨迹发光不用 `shadowBlur`**：同一 Path2D 描三遍（10px / 4px / 1.6px），避免每帧几十次高斯模糊。
- **主循环只写 DOM**：HUD 文字、卡片 transform/opacity、时间轴 canvas 全部走 ref 直接改，
  唯一一次 `setState` 发生在「播放状态变化」的那一帧，不逐帧 setState。
- **里程用 haversine**：按真实经纬度逐点累加，不用墨卡托平面距离（高纬会偏大）。
- **时间表示**：EXIF 的墙钟时间塞进 `Date.UTC`，显示一律 `getUTC*`，跨时区不漂移。

## 6. 已知边界 / 取舍

1. **缩略图编码路径**：需求里写的 `createImageBitmap(file, { resizeWidth })` 需要先知道原图宽高，
   而宽高只有解码后才知道。实际实现是「解码一次 → canvas 高质量缩放」，串行处理、位图用完立刻 `close()`。
2. **`suggestedZoom` 公式修正**：需求给的公式里多了一个 `/ 256`（`156543.03392` 本身已经是
   zoom 0 / 256px 瓦片下的赤道米每像素），照抄会让结果恒定被 clamp 到 7.5。已改为标准形式：
   `zoom = log2(156543.03392 * cos(lat) * 0.35 * 1440 / dMedian)`（见 `src/lib/journey.ts`）。
3. **卡片停留时间**：需求给的显隐条件是 `|s - photo.s| < 900m`，但 4x 速度下一条 2000km 的轨迹
   每秒推进 190km，900m 窗口只有几毫秒，卡片只会闪一下。所以额外加了「首次越过后至少停留 2.6s」。
4. **批量定位的扇形偏移**：见上文，纯为了让轨迹可画。
5. **HEIC**：浏览器解不了 HEIC 缩略图，会退化成渐变卡（EXIF 仍可读，若含 GPS 仍可定位）。
6. **没有真实浏览器里的逐帧验证**：本机没有可用无头浏览器，构建 / 类型 / 单测 / 静态服务都验过，
   但「60fps 手感」只能靠代码层的取舍保证，需要你在真机上过一眼。
7. **高德底图跟随**：播放期每帧只在位移 > 0.4px 时调 `setCenter`；canvas 投影用的是
   「底图当前中心」而不是相机当前值，避免两者 1 帧滞后造成轨迹相对地图抖动。

## 7. 目录

```
src/
├── App.tsx              模式机 + 单 rAF 主循环 + 播放舞台
├── types.ts             Photo / TrackSample / Journey
├── styles.css           Tailwind + 视觉 token + 卡片/HUD 样式
├── lib/
│   ├── geo.ts           WGS84↔GCJ02、墨卡托、haversine
│   ├── exif.ts          手写 JPEG EXIF 解析（只读头部 512KB）
│   ├── thumb.ts         缩略图生成（串行）
│   ├── spline.ts        向心 Catmull-Rom + 等弧长重采样
│   ├── journey.ts       Photo[] → Journey；samplePose
│   └── format.ts        日期 / 里程 / 时长格式化
├── data/demoJourneys.ts 两条内置演示路线
├── engine/
│   ├── clock.ts         播放时钟（q 不进 React state）
│   ├── camera.ts        指数阻尼相机
│   ├── projection.ts    墨卡托 → 屏幕（标定 + 退化）
│   └── renderer.ts      Canvas 2D 轨迹渲染器 + prepareScene
├── map/baseMap.ts       高德加载 / 相机驱动 / 标定 / 降级格网
└── ui/
    ├── Hud.tsx          四角 HUD（直接改 textContent）
    ├── Timeline.tsx     canvas 自绘时间轴
    ├── PhotoCards.tsx   照片卡片（每帧只写 transform/opacity）
    ├── Landing.tsx      首屏
    └── SetupPanel.tsx   照片序列 + 补地点 + 导入
```
