# KEVIN ARCHIVE — 项目交接与架构说明文档

本文档整理了 **KEVIN ARCHIVE（3D 个人胶片与电影影像档案库）** 目前已完成的所有功能、视觉规范、3D 架构细节、数据格式以及后续开发交接注意事项，便于直接交由其他 AI 或开发者继续迭代开发。

---

## 1. 项目定位与美学风格

- **项目名称**：KEVIN ARCHIVE — Minimal 3D Film & Motion Archive
- **项目性质**：纯静态前端 3D Web 应用（无后端、无数据库、无外部 API 密钥依赖）
- **视觉美学**：
  - Dieter Rams / Braun 工业设计 + Apple Store 极简画廊风格
  - 主色调：暖象牙米白展厅背景与雾效（`#F6F3EE`）、哑光暖灰台面/展柜（`#EBE6DD` / `#EDE8DF`）、阳极氧化铝银（`#D9DDE2`）、石墨深灰控制区（`#222426` / `#26292E`）
  - 渲染器配置：`THREE.AgXToneMapping`（exposure `1.04`）、`RoomEnvironment` IBL 环境反射、PCF 软阴影（软渲染环境自动降级禁用阴影与抗锯齿）

---

## 2. 技术栈与项目命令

- **核心框架**：React 19 + TypeScript + Vite 8
- **样式**：Tailwind CSS v4（`@tailwindcss/vite`）
- **3D 与动画**：Three.js (`three`, `OrbitControls`, `RoomEnvironment`) + GSAP (`gsap`)
- **图标**：`lucide-react`
- **常用命令**：
  - `npm run dev`：启动本地开发服务器（端口 `3000`）
  - `npm run lint`：执行 `tsc --noEmit` 类型检查
  - `npm run build`：打包生产版本至 `dist/`（`vite.config.ts` 中配置了 `copy-unbundled-src-assets` 插件，会自动把 `src/assets/` 拷贝进 `dist/src/assets/`）

---

## 3. 目录与核心文件职责

```text
/
├── index.html                        # 页面入口与字体/标题 Meta
├── metadata.json                     # 应用名称与描述
├── package.json                      # 依赖与构建脚本
├── vite.config.ts                    # Vite + Tailwind v4 + 静态资源拷贝插件
└── src/
    ├── main.tsx                      # React 挂载入口
    ├── index.css                     # Tailwind v4 样式与 tabular-nums / 滚动条工具类
    ├── App.tsx                       # 主界面：3D画布挂载、顶部三区导航栏、底部可折叠控制坞、弹窗联动
    ├── data/
    │   └── archiveData.ts            # 2019–2026 八个年份的配置、静态胶卷数据(Stills)与电影片盘数据(Motion)
    ├── components/
    │   ├── ArchiveIndexDrawer.tsx    # 右侧滑出式目录索引抽屉（支持 Stills/Motion 切换与年份快速跳转）
    │   └── LoupeModal.tsx            # 放大检视与全屏看图 / 全屏看视频弹窗（含左下角胶卷名及参数）
    └── three/
        ├── ArchiveSceneManager.ts    # 核心 3D 场景总控：相机编排、状态机、射线拾取、出入柜 GSAP 动画
        ├── cabinetModel.ts           # 双层展柜 3D 模型（上层 Stills 大抽屉 + 下层 Motion 薄抽屉）
        ├── canisterModel.ts          # 135 胶卷暗盒模型 + 可滑动 35mm 半透明胶片带（buildFilmStrip3D）
        ├── drawerPhysics.ts          # 抽屉内 10 卷胶卷的 XPBD 刚体碰撞物理引擎（含四壁与顶板约束）
        ├── cineReelModel.ts          # 16mm / Super 8 三孔铝制电影片盘模型与下层托盘控制器
        ├── projectorModel.ts         # 居中单盘 16mm 放映机、大曲面屏幕、双层光束、地面虚化倒影
        └── textures.ts               # 程序化金属拉丝/喷砂/绒面/胶卷标签/片盘中心贴纸/35mm底片纹理生成
```

---

## 4. 已完成的核心功能与交互机制

### 4.1 三层视图状态机 (`overview` → `drawer` → `inspect`)

1. **全景模式 (`overview`)**
   - 展示 2019–2026 年共 8 个双层档案柜（分两排四列，动态自适应桌面端与移动端竖屏距离）。
   - 支持鼠标/触控旋转缩放（`OrbitControls`）、悬停高亮年份主题色、点击任意柜门打开对应抽屉。

2. **双层抽屉模式 (`drawer`)**
   - 每个年份柜包含两个独立抽屉，支持在柜面直接点击或在底部控制栏通过 `Stills / Motion` 按钮无缝切换：
     - **上层 Stills 抽屉**：存放 10 卷 135 胶卷，内部由 **`DrawerPhysicsSimulation` (XPBD)** 实时解算圆柱、凸起胶片口、片轴和端盖边缘碰撞，已严格约束三排间距与顶板下沿上限（`maxY = CABINET_H - SHELL_WALL - 0.05`），不会穿模或弹出柜顶。悬停时胶卷轻微上浮并旋转将标签面向镜头。
     - **下层 Motion 抽屉**：存放 4–5 个 16mm / Super 8 铝制三孔电影片盘，悬停时轻微浮起倾角。

3. **静态照片检视与全屏看图 (`inspect` - Stills)**
   - 点击上层抽屉中的胶卷：柜体墙向后退场，胶卷飞至前景舞台并拉出半透明 35mm 底片带。
   - **移动端专属优化**（`aspect < 0.85`）：放大胶卷与底片尺寸，单屏完整展示 **2 张底片**（桌面端展示 6 张），其余底片支持 **手指左右滑动 / 底部滑块 / 箭头按钮** 卷动过片。
   - **Loupe 放大镜模式与全屏看图 (`Fullscreen`)**：
     - 点击 3D 底片进入图文并茂的放大镜弹窗；点击弹窗大图、顶部 `Fullscreen`、按 `F` 键，或直接点击底部坞站 `Fullscreen` 按钮，可进入 **纯黑无边框全屏照片浏览**。
     - **全屏看图左下角信息栏**：叠加柔和底部渐变遮罩，清晰展示**胶卷名称**（`roll.title`）、年份/卷号/帧号，以及小字号照片参数信息（`frame.title · camera · lens · filmStock · exposure · location · date` 与摄影笔记）。支持键盘左右键、移动端左右滑手势切图。

4. **3D 放映机放映与全屏影院 (`inspect` - Motion)**
   - 点击下层抽屉中的电影片盘：
     - 下层抽屉先闭合，柜体墙整体退场并隐藏，随后**居中单盘立柱 16mm 放映机**（进一步后退至 `z = 2.05 / 2.65`）与**超大曲面银幕**进入舞台，抽取出的唯一片盘平滑缩小至放映机比例（`0.66` 桌面 / `0.62` 移动）并挂载到顶置单立柱主轴上正对观众顺时针旋转。
     - 归位动画时序经过防穿模编排：片盘先离轴并飞至柜墙前方安全区（`z ≥ 2.61`），待柜体墙向前归位且下层抽屉滑出后，再纯垂直落入天鹅绒槽位并恢复 1:1 尺寸。
   - **Apple Vision 风格大型无边框曲面屏幕**：
     - 尺寸为 `10.4 × 4.60`（移动端自适应缩至 `0.34` 贴合屏宽 94%），无圆角、无边框、无背后阴影光晕，边缘略微向观众内凹，根据相机视场角精确联立求解顶栏与底栏安全距，保证屏幕尽可能大且永不被顶栏裁切。
     - **地面实时虚化倒影**：屏幕下方地面通过自定义 GLSL 着色器对当前视频/画布帧做垂直镜像与 13 抽头宽核高斯虚化，形成极柔的漫反射色彩倒影。
     - **双层投影光束**：镜头前投射外层大气光柱与内层聚焦光束（随当前画面色彩与播放状态微调亮度与动态尘埃闪烁），在浅色展厅环境下清晰可见光路。
   - **全屏视频观看 (`Fullscreen`) & 时间轴同步**：
     - 底部控制栏支持 Play/Pause、进度条拖拽、时间码、静音切换，以及独立分离的 **Notes**（图文档案页）和 **Fullscreen**（纯黑影院全屏视频）入口。
     - 全屏看视频与 3D 放映机之间无缝同步时间轴进度（退出全屏时自动把当前时间码同步回 3D 放映机继续播放）。

---

## 5. 数据结构与接入真实素材指南 (`src/data/archiveData.ts`)

如果需要继续扩充照片、真实实拍视频或更换摄影参数，只需修改 `src/data/archiveData.ts`：

1. **静态照片 (`FilmRoll` / `PhotoFrame`)**
   - 推荐将自己的照片放在 `public/photos/...` 下，在 `imageUrl` 中填 `/photos/xxx.jpg`。
   - 每张照片支持：`title`、`location`、`date`、`camera`、`lens`、`filmStock`、`exposure`、`notes`、`cropFocus`（控制焦点裁剪偏移与缩放）。
2. **动态视频 (`MotionReel`)**
   - 若填写 `videoUrl`（如 `videoUrl: '/videos/tokyo-2025.mp4'`，建议编码为 H.264 + AAC + faststart），3D 放映机与全屏视频器都会自动使用 `<video>` + `THREE.VideoTexture` 播放真实视频（含音轨开关控制）。
   - 若留空 `videoUrl`，系统会自动通过 `keyframes` 在离屏 Canvas 上模拟 18fps / 24fps 电影放映机（含柔和推拉镜、胶片抖动 `gate weave` 与暗角微粒）。

---

## 6. 给后续开发者 / AI 的关键注意事项（避坑清单）

1. **Raycaster 拾取统一在 Layer 1**：
   - `ArchiveSceneManager` 中 `this.raycaster.layers.set(1)`。所有新增可点击 3D 物体（如碰撞代理 Mesh）必须设置 `mesh.layers.set(1)` 并写明 `userData`，装饰性网格留在默认 Layer 0，避免遮挡或拖慢射线检测。
2. **相机 FOV 与 3D 投影适配**：
   - 相机基础 `fov = 36`，`getProjectorCameraPose()` 与 `getInspectCameraPose()` 均按视场角和容器宽高比（`isPortrait = rawAspect < 0.85`）实时计算，修改 `PROJECTOR_DIMS` 或 UI 顶部 `<header>` 高度后，应同步核对 `topFrac` / `footFrac` 比例参数。
3. **跨层级 `attach()` 时的缩放与四元数还原**：
   - 电影片盘在抽屉内为 `1:1`，挂载到 `projectorStage.supplyMount` 时随放映机整体缩放到 `0.66 / 0.62`。在 `selectReelForInspection` 和 `returnToDrawer` 中使用 `group.attach(...)` 时务必保持缩放插值同步并在回调中重置局部 `scale.set(1, 1, 1)`，避免物体突变。
4. **纯静态部署（含极空间 NAS）**：
   - 所有资源路径使用根相对路径（如 `/assets/...`、`/src/assets/...`），部署到 Nginx / Docker 时需挂在独立端口或根域名 `/` 下；若计划未来接入极空间本地海量照片/视频，推荐**直接把极空间中整理好的总文件夹挂载为 Docker Volume**（例如 `-v /极空间总目录:/media:ro`），并搭配轻量级 `server.ts`（Express + `exifr` + `ffprobe` + `sharp`）自动扫描目录、提取 EXIF/视频时长并生成列表 JSON 与缩略图缓存，无需重复维护厚重的网页上传后台。

---

## 7. 推荐的下一步迭代方向

以下功能非常适合作为下一阶段的扩展目标：
- **极空间总目录自动扫描引擎（推荐优先做）**：新增 `server.ts`（Express），挂载极空间 `/media/年份/胶卷或视频名/` 目录，利用 `exifr` 读取照片 EXIF（相机、镜头、曝光、日期）、`ffprobe` 读取视频时长/分辨率、`sharp` 生成 35mm 底片缓存小图，前端启动时请求 `/api/archive` 动态填充抽屉，彻底告别手动维护 `archiveData.ts`。
- **极空间 / 私有云一键 Docker 镜像化**：编写多阶段 `Dockerfile`（前端打包 + Node 服务运行），支持直接挂载极空间共享目录；如有随时从手机补传零散素材的需求，再按需附带一个单页轻量加密上传口直接写入同一 `/media` 目录即可。
- **胶片卷与片盘音效升级**：为拉抽屉、转动胶卷带、安装片盘、放映机开关灯增加轻微拟真机械音效（Web Audio / 采样音频，受静音状态统一控制）。
- **相机焦段/滤镜与胶片模拟**：在全屏浏览或 3D 底片检视中加入底片反相（负片/正片切换）或胶片边框切换选项。
