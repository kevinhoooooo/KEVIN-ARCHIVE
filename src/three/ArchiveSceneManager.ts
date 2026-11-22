import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import gsap from 'gsap';
import {
  ARCHIVE_DATA,
  ArchiveYear,
  DrawerCategory,
  FilmRoll,
  MOTION_ARCHIVE_DATA,
  MotionKeyframe,
  MotionReel,
  PhotoFrame,
  YEAR_CONFIGS,
  YearConfig,
} from '../data/archiveData';
import { CABINET_DIMS, CabinetInstance, buildCabinetModel } from './cabinetModel';
import {
  CANISTER_DIMS,
  CanisterInstance,
  FILM_STRIP_CONSTANTS,
  FilmStripInstance,
  buildCanisterModel,
  buildFilmStrip3D,
} from './canisterModel';
import {
  CineReelInstance,
  MotionTrayController,
  buildCineReelModel,
} from './cineReelModel';
import {
  PROJECTOR_DIMS,
  ProjectorPlaybackSnapshot,
  ProjectorStageController,
} from './projectorModel';
import { DrawerPhysicsSimulation } from './drawerPhysics';

export type ArchiveViewMode = 'overview' | 'drawer' | 'inspect';

export interface ArchiveSceneCallbacks {
  onModeChange: (
    mode: ArchiveViewMode,
    activeYear: ArchiveYear | null,
    activeCategory: DrawerCategory,
    activeRoll: FilmRoll | null,
    activeMotionReel: MotionReel | null
  ) => void;
  onHoverYearChange: (year: ArchiveYear | null) => void;
  onHoverRollChange: (roll: FilmRoll | null) => void;
  onHoverReelChange?: (reel: MotionReel | null) => void;
  onHoverFrameChange: (frame: PhotoFrame | MotionKeyframe | null) => void;
  onOpenFrame: (roll: FilmRoll, frameIndex: number) => void;
  onOpenMotionReel?: (reel: MotionReel, keyframeIndex: number) => void;
  onProjectorProgress?: (snapshot: ProjectorPlaybackSnapshot) => void;
  onTransitionChange: (busy: boolean) => void;
  onFilmScrollChange?: (scrollOffsetFrames: number) => void;
  onVisibleSlotsChange?: (visibleSlots: number) => void;
}

const CABINET_RETREAT_Z = -6.8;

export class ArchiveSceneManager {
  private container: HTMLElement;
  private callbacks: ArchiveSceneCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private activeYears: YearConfig[] = [...YEAR_CONFIGS];
  private activeRollsByYear: Record<ArchiveYear, FilmRoll[]> = { ...ARCHIVE_DATA };
  private activeReelsByYear: Record<ArchiveYear, MotionReel[]> = { ...MOTION_ARCHIVE_DATA };

  private cabinets = new Map<ArchiveYear, CabinetInstance>();
  private physicsMap = new Map<ArchiveYear, DrawerPhysicsSimulation>();
  private motionTrayMap = new Map<ArchiveYear, MotionTrayController>();
  private canistersById = new Map<string, CanisterInstance>();
  private reelsById = new Map<string, CineReelInstance>();
  private stageGroup = new THREE.Group();
  private projectorStage!: ProjectorStageController;
  private lastProjectorEmit = 0;
  private lastProjectorKeyIdx = -1;
  private lastProjectorPlaying = false;

  private activeMode: ArchiveViewMode = 'overview';
  private activeYear: ArchiveYear | null = null;
  private activeCategory: DrawerCategory = 'stills';
  private inspectedRoll: FilmRoll | null = null;
  private inspectedCanister: CanisterInstance | null = null;
  private inspectedMotionReel: MotionReel | null = null;
  private inspectedCineReel: CineReelInstance | null = null;
  private activeFilmStrip: FilmStripInstance | null = null;
  private targetFilmScrollX = 0;
  private currentFilmScrollX = 0;
  private savedReturnLocalPos = new THREE.Vector3();
  private savedReturnLocalQuat = new THREE.Quaternion();

  private isTransitioning = false;
  private hoveredYear: ArchiveYear | null = null;
  private hoveredRollId: string | null = null;
  private hoveredReelId: string | null = null;
  private hoveredFrameIdx: number | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private isDraggingFilmStrip = false;
  private dragPointerId: number | null = null;
  private dragLastClientX = 0;
  private didDragFilmStrip = false;
  private lastHoverRaycast = 0;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private activeTimeline: gsap.core.Timeline | null = null;

  private disposables: { dispose: () => void }[] = [];

  constructor(container: HTMLElement, callbacks: ArchiveSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.isSoftwareGl = ArchiveSceneManager.detectSoftwareGl();

    // 1. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // 2. Scene & Fog (Apple Store minimalist gallery studio)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f3ee);
    this.scene.fog = new THREE.FogExp2(0xf6f3ee, 0.008);

    // Studio IBL environment (balanced reflections without washing out dark shadows)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.54;
    pmrem.dispose();
    this.disposables.push(envTex);

    // 3. Camera & Controls
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    const overviewPose = this.getOverviewCameraPose();
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 110);
    this.camera.position.copy(overviewPose.camPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.target.copy(overviewPose.target);
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 46;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.enablePan = false;

    this.raycaster.layers.set(1);

    // 4. Lighting, Desk & Cabinets
    this.setupLighting();
    this.setupDeskFloor();

    this.stageGroup.name = 'inspection-stage';
    this.scene.add(this.stageGroup);

    this.projectorStage = new ProjectorStageController(
      this.renderer.capabilities.getMaxAnisotropy()
    );
    this.scene.add(this.projectorStage.rootGroup);

    this.setupArchives();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 5. Event listeners
    this.bindEvents();

    // 6. Start render loop
    this.tick();
  }

  private static detectSoftwareGl(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return false;
    }
  }

  private setupLighting() {
    // Restrained hemisphere fill so shadows & dark velvet retain real depth
    const hemi = new THREE.HemisphereLight(0xfaf8f5, 0x625d56, 0.36);
    this.scene.add(hemi);

    // Crisp sculptural key directional light for defined shadows & contrast
    const key = new THREE.DirectionalLight(0xfff6ea, 1.85);
    key.position.set(8.5, 14.0, 8.5);
    key.castShadow = !this.isSoftwareGl;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 38;
    const d = 12.5;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);

    // Subtle cool rim light from back-left to catch edges cleanly
    const rim = new THREE.DirectionalLight(0xdce8fa, 0.52);
    rim.position.set(-8, 7, -7);
    this.scene.add(rim);

    // Restrained architectural softbox light strips on hardware GPU for clean specular accents
    if (!this.isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const overheadStrip = new THREE.RectAreaLight(0xfffaf2, 1.2, 11.5, 3.8);
      overheadStrip.position.set(0, 8.0, 5.0);
      overheadStrip.lookAt(0, 0.6, 0);
      this.scene.add(overheadStrip);

      const grazingStrip = new THREE.RectAreaLight(0xeef4ff, 0.75, 5.2, 3.0);
      grazingStrip.position.set(-7.5, 5.2, 5.0);
      grazingStrip.lookAt(0, 1.0, 0);
      this.scene.add(grazingStrip);
    }
  }

  private setupDeskFloor() {
    const deskGeo = new THREE.PlaneGeometry(80, 80);
    deskGeo.rotateX(-Math.PI / 2);

    // Pure seamless solid-color architectural matte surface (zero texture tiling or seams)
    const deskMat = new THREE.MeshPhysicalMaterial({
      color: 0xebe6dd,
      roughness: 0.68,
      metalness: 0.02,
      clearcoat: 0.08,
      clearcoatRoughness: 0.36,
      envMapIntensity: 0.42,
    });

    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.y = 0;
    desk.receiveShadow = true;
    this.scene.add(desk);

    this.disposables.push(deskGeo, deskMat);
  }

  private getOverviewCameraPose() {
    const yearCount = Math.max(1, this.activeYears.length);
    const totalCols = Math.min(4, yearCount);
    const totalRows = Math.max(1, Math.ceil(yearCount / 4));
    const totalHeight = totalRows * CABINET_DIMS.CABINET_H + Math.max(0, totalRows - 1) * 0.02;

    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const isPortrait = rawAspect < 0.85;
    const targetY = isPortrait ? totalHeight * 0.34 : Math.max(0.62, totalHeight * 0.48);

    const sideMargin = isPortrait ? 0.52 : 0.95;
    const halfW = ((totalCols - 1) * 3.3 + CABINET_DIMS.CABINET_W) / 2 + sideMargin;
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(this.camera?.fov ?? 36) / 2);
    const aspect = Math.max(rawAspect, 0.42);
    const minDistForW = halfW / (tanHalfV * aspect);

    const baseDy = 7.4 + (totalRows - 1) * 1.15;
    const baseDz = 11.2 + (totalRows - 1) * 1.65;
    const baseDist = Math.hypot(baseDy, baseDz);
    const scale = Math.max(1.0, minDistForW / baseDist);

    return {
      camPos: new THREE.Vector3(0, targetY + baseDy * scale, 0.25 + baseDz * scale),
      target: new THREE.Vector3(0, targetY, 0.25),
    };
  }

  private getDrawerGroup(cab: CabinetInstance, category: DrawerCategory): THREE.Group {
    return category === 'motion' ? cab.motionDrawerGroup : cab.drawerGroup;
  }

  private getDrawerCameraPose(cab: CabinetInstance, category: DrawerCategory = this.activeCategory) {
    const drawerCenterX = cab.gridX;
    const drawerBaseY = cab.gridY;
    const drawerCenterZ = CABINET_DIMS.DRAWER_OPEN_Z + 0.1;
    const floorY =
      category === 'motion'
        ? CABINET_DIMS.MOTION_DRAWER_FLOOR_Y
        : CABINET_DIMS.DRAWER_FLOOR_Y;

    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const isPortrait = rawAspect < 0.85;
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(this.camera?.fov ?? 36) / 2);
    const aspect = Math.max(rawAspect, 0.40);
    const halfW = isPortrait ? 1.62 : 1.72;
    const minDist = halfW / (tanHalfV * aspect);
    const baseDist = Math.hypot(4.55, 1.45);
    const scale = Math.max(1.0, minDist / baseDist);
    const targetZ = isPortrait ? drawerCenterZ + 0.16 : drawerCenterZ;

    return {
      camPos: new THREE.Vector3(
        drawerCenterX,
        drawerBaseY + floorY + 4.05 * scale,
        targetZ + 1.45 * scale
      ),
      target: new THREE.Vector3(
        drawerCenterX,
        drawerBaseY + floorY + (category === 'motion' ? 0.06 : 0.1),
        targetZ
      ),
    };
  }

  private getEffectiveVisibleSlots(): number {
    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    return rawAspect < 0.85
      ? FILM_STRIP_CONSTANTS.MOBILE_VISIBLE_SLOTS
      : FILM_STRIP_CONSTANTS.VISIBLE_SLOTS;
  }

  private setupArchives() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const total = this.activeYears.length;

    this.activeYears.forEach((cfg, idx) => {
      const rolls = this.activeRollsByYear[cfg.year] ?? [];
      const motionReels = this.activeReelsByYear[cfg.year] ?? [];
      const cabinet = buildCabinetModel(cfg, idx, total, maxAniso, rolls.length, motionReels.length);
      this.scene.add(cabinet.cabinetRoot);
      this.cabinets.set(cfg.year, cabinet);

      const canisters: CanisterInstance[] = [];

      for (const roll of rolls) {
        const canister = buildCanisterModel(roll, maxAniso);
        cabinet.canistersSlotGroup.add(canister.group);
        canisters.push(canister);
        this.canistersById.set(roll.id, canister);
      }

      const physics = new DrawerPhysicsSimulation(canisters);
      this.physicsMap.set(cfg.year, physics);

      const cineReels: CineReelInstance[] = [];
      for (const mReel of motionReels) {
        const reelInst = buildCineReelModel(mReel, maxAniso);
        cabinet.motionSlotGroup.add(reelInst.group);
        cineReels.push(reelInst);
        this.reelsById.set(mReel.id, reelInst);
      }
      this.motionTrayMap.set(cfg.year, new MotionTrayController(cineReels));
    });
  }

  public updateArchiveData(
    years: YearConfig[],
    rollsByYear: Record<ArchiveYear, FilmRoll[]>,
    reelsByYear: Record<ArchiveYear, MotionReel[]>
  ) {
    if (this.disposed) return;

    this.activeTimeline?.kill();
    this.activeTimeline = null;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);

    this.projectorStage.setProjectionActive(false);
    this.projectorStage.rootGroup.visible = false;

    if (this.activeFilmStrip) {
      this.scene.remove(this.activeFilmStrip.group);
      this.activeFilmStrip.dispose();
      this.activeFilmStrip = null;
    }

    this.stageGroup.clear();
    this.clearHoverStates();

    this.cabinets.forEach((cab) => {
      this.scene.remove(cab.cabinetRoot);
      cab.dispose();
    });
    this.canistersById.forEach((c) => {
      c.labelTex.dispose();
      c.labelMat.dispose();
    });
    this.reelsById.forEach((r) => {
      r.labelTex.dispose();
      r.labelMat.dispose();
    });

    this.cabinets.clear();
    this.physicsMap.clear();
    this.motionTrayMap.clear();
    this.canistersById.clear();
    this.reelsById.clear();

    this.activeMode = 'overview';
    this.activeYear = null;
    this.inspectedRoll = null;
    this.inspectedCanister = null;
    this.inspectedMotionReel = null;
    this.inspectedCineReel = null;
    this.targetFilmScrollX = 0;
    this.currentFilmScrollX = 0;
    this.isTransitioning = false;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = 'grab';

    this.activeYears = [...years];
    this.activeRollsByYear = { ...rollsByYear };
    this.activeReelsByYear = { ...reelsByYear };

    this.setupArchives();

    const pose = this.getOverviewCameraPose();
    this.camera.position.copy(pose.camPos);
    this.controls.target.copy(pose.target);
    this.controls.update();

    this.callbacks.onTransitionChange(false);
    this.callbacks.onModeChange('overview', null, this.activeCategory, null, null);
  }

  // =========================================================================
  // INTERACTION & RAYCASTING
  // =========================================================================

  private bindEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerCancel);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('webglcontextlost', this.onContextLost);
    window.addEventListener('resize', this.onResize);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private onResize = () => {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));

    const effectiveSlots = this.getEffectiveVisibleSlots();
    this.callbacks.onVisibleSlotsChange?.(effectiveSlots);

    if (this.activeMode === 'inspect' && this.activeFilmStrip) {
      this.activeFilmStrip.setVisibleSlots(effectiveSlots);
      this.targetFilmScrollX = THREE.MathUtils.clamp(
        this.targetFilmScrollX,
        0,
        this.activeFilmStrip.maxScrollX
      );
      this.currentFilmScrollX = THREE.MathUtils.clamp(
        this.currentFilmScrollX,
        0,
        this.activeFilmStrip.maxScrollX
      );
      this.activeFilmStrip.setScrollX(this.currentFilmScrollX);
      this.callbacks.onVisibleSlotsChange?.(this.activeFilmStrip.visibleSlots);
      this.callbacks.onFilmScrollChange?.(
        this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
      );
    }

    if (this.isTransitioning) return;

    if (this.activeMode === 'overview') {
      const pose = this.getOverviewCameraPose();
      this.camera.position.copy(pose.camPos);
      this.controls.target.copy(pose.target);
    } else if (this.activeMode === 'drawer' && this.activeYear) {
      const cab = this.cabinets.get(this.activeYear);
      if (cab) {
        const pose = this.getDrawerCameraPose(cab, this.activeCategory);
        this.camera.position.copy(pose.camPos);
        this.controls.target.copy(pose.target);
      }
    } else if (this.activeMode === 'inspect') {
      if (this.inspectedMotionReel) {
        const isPortrait = w / h < 0.85;
        this.projectorStage.layoutForViewport(isPortrait);
        const pose = this.getProjectorCameraPose();
        this.camera.position.copy(pose.camPos);
        this.controls.target.copy(pose.target);
      } else if (this.inspectedRoll) {
        const pose = this.getInspectCameraPose(this.inspectedRoll.frames.length);
        this.camera.position.copy(pose.camPos);
        this.controls.target.copy(pose.target);
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.activeMode !== 'inspect' || this.isTransitioning || !this.activeFilmStrip) return;
    if (this.activeFilmStrip.maxScrollX <= 0) return;

    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.targetFilmScrollX = THREE.MathUtils.clamp(
      this.targetFilmScrollX + delta * 0.0032,
      0,
      this.activeFilmStrip.maxScrollX
    );
    this.callbacks.onFilmScrollChange?.(
      this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
    );
  };

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerCancel = (e: PointerEvent) => {
    if (this.dragPointerId === e.pointerId) {
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
      this.dragPointerId = null;
    }
    this.isDraggingFilmStrip = false;
    this.didDragFilmStrip = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.didDragFilmStrip = false;
    this.isDraggingFilmStrip = false;

    if (
      this.activeMode === 'inspect' &&
      !this.isTransitioning &&
      this.activeFilmStrip &&
      this.activeFilmStrip.maxScrollX > 0
    ) {
      let allowDrag = e.pointerType === 'touch';
      if (!allowDrag) {
        this.updatePointer(e);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const strip = this.activeFilmStrip;
        const hits = this.raycaster
          .intersectObjects(strip.hitMeshes, false)
          .filter((h) => h.point.x >= strip.clipLeftX && h.point.x <= strip.clipRightX);
        allowDrag = hits.length > 0;
      }
      if (allowDrag) {
        this.isDraggingFilmStrip = true;
        this.dragPointerId = e.pointerId;
        this.dragLastClientX = e.clientX;
        this.renderer.domElement.style.cursor = 'grabbing';
        try {
          this.renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          // Ignore unsupported capture
        }
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.isTransitioning) return;

    // Direct horizontal click-and-drag / touch-drag winding on film strips
    if (this.isDraggingFilmStrip && this.activeFilmStrip) {
      const dx = e.clientX - this.dragLastClientX;
      this.dragLastClientX = e.clientX;
      const dragThreshold = e.pointerType === 'touch' ? 10 : 5;
      if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > dragThreshold) {
        this.didDragFilmStrip = true;
      }
      const distToTarget = this.camera.position.distanceTo(this.controls.target);
      const tanHalfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const worldWidthAtTarget = 2 * distToTarget * tanHalfV * this.camera.aspect;
      const worldPerPx = worldWidthAtTarget / Math.max(this.container.clientWidth, 1);
      const dragGain =
        e.pointerType === 'touch'
          ? Math.max(0.0065, worldPerPx * 1.18)
          : Math.max(0.0085, worldPerPx * 1.25);

      this.targetFilmScrollX = THREE.MathUtils.clamp(
        this.targetFilmScrollX - dx * dragGain,
        0,
        this.activeFilmStrip.maxScrollX
      );
      this.callbacks.onFilmScrollChange?.(
        this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
      );
      return;
    }

    if (e.pointerType === 'touch') return;

    const now = performance.now();
    if (now - this.lastHoverRaycast < 28) return;
    this.lastHoverRaycast = now;

    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const dom = this.renderer.domElement;

    if (this.activeMode === 'overview') {
      const targets: THREE.Object3D[] = [];
      this.cabinets.forEach((cab) => targets.push(...cab.hitMeshes));
      const hits = this.raycaster.intersectObjects(targets, false);
      const hitYear = (hits[0]?.object.userData.cabinetYear as ArchiveYear | undefined) ?? null;

      if (hitYear !== this.hoveredYear) {
        this.hoveredYear = hitYear;
        dom.style.cursor = hitYear ? 'pointer' : 'grab';
        this.callbacks.onHoverYearChange(hitYear);
      }
      return;
    }

    if (this.activeMode === 'drawer' && this.activeYear) {
      const cab = this.cabinets.get(this.activeYear);
      if (!cab) return;

      if (this.activeCategory === 'stills') {
        const physics = this.physicsMap.get(this.activeYear);
        if (!physics) return;

        const canisterHits: THREE.Object3D[] = [];
        cab.canistersSlotGroup.children.forEach((child) => {
          child.traverse((obj) => {
            if (obj.userData.canisterId) canisterHits.push(obj);
          });
        });

        const hits = this.raycaster.intersectObjects(canisterHits, false);
        const hitId = (hits[0]?.object.userData.canisterId as string | undefined) ?? null;

        if (hitId !== this.hoveredRollId) {
          this.hoveredRollId = hitId;
          physics.setHoveredCanister(hitId);
          dom.style.cursor = hitId ? 'pointer' : 'default';
          const roll = hitId ? this.canistersById.get(hitId)?.roll ?? null : null;
          this.callbacks.onHoverRollChange(roll);
        }
      } else {
        const tray = this.motionTrayMap.get(this.activeYear);
        if (!tray) return;

        const reelHits: THREE.Object3D[] = [];
        cab.motionSlotGroup.children.forEach((child) => {
          child.traverse((obj) => {
            if (obj.userData.reelId) reelHits.push(obj);
          });
        });

        const hits = this.raycaster.intersectObjects(reelHits, false);
        const hitId = (hits[0]?.object.userData.reelId as string | undefined) ?? null;

        if (hitId !== this.hoveredReelId) {
          this.hoveredReelId = hitId;
          tray.setHoveredReel(hitId);
          dom.style.cursor = hitId ? 'pointer' : 'default';
          const reel = hitId ? this.reelsById.get(hitId)?.reel ?? null : null;
          this.callbacks.onHoverReelChange?.(reel);
        }
      }
      return;
    }

    if (this.activeMode === 'inspect') {
      if (this.inspectedMotionReel && this.projectorStage.rootGroup.visible) {
        const hits = this.raycaster.intersectObject(this.projectorStage.screenHitMesh, false);
        dom.style.cursor = hits.length > 0 ? 'pointer' : 'default';
        return;
      }

      if (this.activeFilmStrip) {
        const strip = this.activeFilmStrip;
        const hits = this.raycaster
          .intersectObjects(strip.hitMeshes, false)
          .filter((h) => h.point.x >= strip.clipLeftX && h.point.x <= strip.clipRightX);
        const hitIdx =
          hits.length > 0 ? (hits[0].object.userData.frameIndex as number) : null;

        if (hitIdx !== this.hoveredFrameIdx) {
          this.hoveredFrameIdx = hitIdx;
          strip.setHoveredFrame(hitIdx);
          dom.style.cursor =
            hitIdx !== null ? (strip.maxScrollX > 0 ? 'grab' : 'pointer') : 'default';
          const frame =
            hitIdx !== null && this.inspectedRoll
              ? this.inspectedRoll.frames[hitIdx] ?? null
              : null;
          this.callbacks.onHoverFrameChange(frame);
        }
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.dragPointerId === e.pointerId) {
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
      this.dragPointerId = null;
    }

    const wasDraggingStrip = this.isDraggingFilmStrip;
    const didDragStrip = this.didDragFilmStrip;
    this.isDraggingFilmStrip = false;
    this.didDragFilmStrip = false;

    if (wasDraggingStrip && didDragStrip) {
      this.renderer.domElement.style.cursor =
        this.activeFilmStrip && this.activeFilmStrip.maxScrollX > 0 ? 'grab' : 'default';
      return;
    }

    if (this.isTransitioning) return;
    const dist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    const tapLimit = e.pointerType === 'touch' ? 12 : 7;
    if (dist > tapLimit) return; // Ignore orbit drags

    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.activeMode === 'overview') {
      const targets: THREE.Object3D[] = [];
      this.cabinets.forEach((cab) => targets.push(...cab.hitMeshes));
      const hits = this.raycaster.intersectObjects(targets, false);
      const hitYear = hits[0]?.object.userData.cabinetYear as ArchiveYear | undefined;
      const hitCategory =
        (hits[0]?.object.userData.drawerType as DrawerCategory | undefined) ?? 'stills';
      if (hitYear) {
        this.openYearDrawer(hitYear, hitCategory);
      }
      return;
    }

    if (this.activeMode === 'drawer' && this.activeYear) {
      const cab = this.cabinets.get(this.activeYear);
      if (!cab) return;

      if (this.activeCategory === 'stills') {
        const canisterHits: THREE.Object3D[] = [];
        cab.canistersSlotGroup.children.forEach((child) => {
          child.traverse((obj) => {
            if (obj.userData.canisterId) canisterHits.push(obj);
          });
        });

        const hits = this.raycaster.intersectObjects(canisterHits, false);
        const hitId = hits[0]?.object.userData.canisterId as string | undefined;
        if (hitId) {
          const canister = this.canistersById.get(hitId);
          if (canister) {
            this.selectCanisterForInspection(canister);
          }
        }
      } else {
        const reelHits: THREE.Object3D[] = [];
        cab.motionSlotGroup.children.forEach((child) => {
          child.traverse((obj) => {
            if (obj.userData.reelId) reelHits.push(obj);
          });
        });

        const hits = this.raycaster.intersectObjects(reelHits, false);
        const hitId = hits[0]?.object.userData.reelId as string | undefined;
        if (hitId) {
          const reelInst = this.reelsById.get(hitId);
          if (reelInst) {
            this.selectReelForInspection(reelInst);
          }
        }
      }
      return;
    }

    if (this.activeMode === 'inspect') {
      if (this.inspectedMotionReel && this.projectorStage.rootGroup.visible) {
        const hits = this.raycaster.intersectObject(this.projectorStage.screenHitMesh, false);
        if (hits.length > 0) {
          this.toggleProjectorPlay();
        }
        return;
      }

      if (this.activeFilmStrip) {
        const strip = this.activeFilmStrip;
        const hits = this.raycaster
          .intersectObjects(strip.hitMeshes, false)
          .filter((h) => h.point.x >= strip.clipLeftX && h.point.x <= strip.clipRightX);
        if (hits.length > 0 && this.inspectedRoll) {
          const frameIdx = hits[0].object.userData.frameIndex as number;
          this.callbacks.onOpenFrame(this.inspectedRoll, frameIdx);
        }
      }
    }
  };

  // =========================================================================
  // CAMERA & ARCHIVE STATE TRANSITIONS (STRICT SERIALIZED TIMELINES)
  // =========================================================================

  private setBusy(busy: boolean) {
    this.isTransitioning = busy;
    this.callbacks.onTransitionChange(busy);
    if (busy) {
      this.renderer.domElement.style.cursor = 'wait';
    }
  }

  private clearHoverStates() {
    this.hoveredYear = null;
    this.hoveredRollId = null;
    this.hoveredReelId = null;
    this.hoveredFrameIdx = null;
    this.physicsMap.forEach((p) => p.setHoveredCanister(null));
    this.motionTrayMap.forEach((t) => t.setHoveredReel(null));
    this.activeFilmStrip?.setHoveredFrame(null);
    this.callbacks.onHoverYearChange(null);
    this.callbacks.onHoverRollChange(null);
    this.callbacks.onHoverReelChange?.(null);
    this.callbacks.onHoverFrameChange(null);
  }

  public goToOverview() {
    if (this.isTransitioning) return;
    if (this.activeMode === 'overview') {
      const pose = this.getOverviewCameraPose();
      this.animateCameraTo(pose.camPos, pose.target, 0.9);
      return;
    }

    if (this.activeMode === 'inspect') {
      this.returnToDrawer(() => {
        this.closeActiveDrawerToOverview();
      });
      return;
    }

    this.closeActiveDrawerToOverview();
  }

  private closeActiveDrawerToOverview() {
    if (!this.activeYear) return;
    const cab = this.cabinets.get(this.activeYear);
    if (!cab) return;

    const activeDrawer = this.getDrawerGroup(cab, this.activeCategory);
    this.clearHoverStates();
    this.setBusy(true);
    this.controls.enabled = false;
    const overviewPose = this.getOverviewCameraPose();

    const tl = gsap.timeline({
      onComplete: () => {
        this.activeYear = null;
        this.activeMode = 'overview';
        this.controls.enabled = true;
        this.setBusy(false);
        this.renderer.domElement.style.cursor = 'grab';
        this.callbacks.onModeChange('overview', null, this.activeCategory, null, null);
      },
    });
    this.activeTimeline = tl;

    // Close active drawer cleanly flush into stationary cabinet
    tl.to(
      activeDrawer.position,
      {
        z: 0,
        duration: 0.52,
        ease: 'power2.inOut',
      },
      0
    );

    // Return camera to 3/4 overview
    tl.to(
      this.camera.position,
      {
        x: overviewPose.camPos.x,
        y: overviewPose.camPos.y,
        z: overviewPose.camPos.z,
        duration: 0.95,
        ease: 'power3.inOut',
      },
      0.1
    );
    tl.to(
      this.controls.target,
      {
        x: overviewPose.target.x,
        y: overviewPose.target.y,
        z: overviewPose.target.z,
        duration: 0.95,
        ease: 'power3.inOut',
      },
      0.1
    );
  }

  public openYearDrawer(year: ArchiveYear, category: DrawerCategory = this.activeCategory) {
    if (this.isTransitioning) return;
    if (this.activeMode === 'drawer' && this.activeYear === year && this.activeCategory === category) {
      return;
    }

    // If inspecting a roll or reel, first run serialized return-to-drawer then switch
    if (this.activeMode === 'inspect') {
      this.returnToDrawer(() => {
        if (this.activeYear === year && this.activeCategory === category) return;
        this.switchDrawer(year, category);
      });
      return;
    }

    this.switchDrawer(year, category);
  }

  public switchCategory(category: DrawerCategory) {
    if (this.isTransitioning) return;
    if (this.activeCategory === category && this.activeMode === 'drawer') return;

    if (this.activeMode === 'inspect' && this.activeYear) {
      const targetYear = this.activeYear;
      this.returnToDrawer(() => {
        this.switchDrawer(targetYear, category);
      });
      return;
    }

    if (this.activeMode === 'drawer' && this.activeYear) {
      this.switchDrawer(this.activeYear, category);
    } else {
      this.activeCategory = category;
    }
  }

  private switchDrawer(targetYear: ArchiveYear, targetCategory: DrawerCategory) {
    const prevYear = this.activeYear;
    const prevCategory = this.activeCategory;
    const prevCab = prevYear ? this.cabinets.get(prevYear) : null;
    const targetCab = this.cabinets.get(targetYear);
    if (!targetCab) return;

    this.clearHoverStates();
    this.setBusy(true);
    this.controls.enabled = false;

    const tl = gsap.timeline({
      onComplete: () => {
        this.activeYear = targetYear;
        this.activeCategory = targetCategory;
        this.activeMode = 'drawer';
        this.setBusy(false);
        this.renderer.domElement.style.cursor = 'default';
        this.callbacks.onModeChange('drawer', targetYear, targetCategory, null, null);
      },
    });
    this.activeTimeline = tl;

    let openStart = 0;
    if (prevCab) {
      const prevDrawer = this.getDrawerGroup(prevCab, prevCategory);
      tl.to(
        prevDrawer.position,
        {
          z: 0,
          duration: 0.45,
          ease: 'power2.inOut',
        },
        0
      );
      openStart = 0.2;
    }

    const targetDrawer = this.getDrawerGroup(targetCab, targetCategory);
    tl.to(
      targetDrawer.position,
      {
        z: CABINET_DIMS.DRAWER_OPEN_Z,
        duration: 0.62,
        ease: 'power3.out',
      },
      openStart
    );

    const drawerPose = this.getDrawerCameraPose(targetCab, targetCategory);

    tl.to(
      this.camera.position,
      {
        x: drawerPose.camPos.x,
        y: drawerPose.camPos.y,
        z: drawerPose.camPos.z,
        duration: 0.95,
        ease: 'power3.inOut',
      },
      openStart
    );

    tl.to(
      this.controls.target,
      {
        x: drawerPose.target.x,
        y: drawerPose.target.y,
        z: drawerPose.target.z,
        duration: 0.95,
        ease: 'power3.inOut',
      },
      openStart
    );
  }

  /**
   * V1.8 CORE FIX: Strictly serialized 4-phase extraction timeline:
   * 1) Selected canister lifts vertically straight out of open drawer (0.00s - 0.45s)
   * 2) ONLY drawer closes flush to z = 0 while all cabinets remain 100% stationary (0.45s - 0.92s)
   * 3) ONLY AFTER drawer is 100% closed, all 4 cabinetRoot groups retreat rigidly backward
   *    while canister glides onto the left stage (0.92s - 1.50s)
   * 4) Translucent 35mm amber film strip unfurls seamlessly rightward out of velvet lip (1.42s - 2.15s)
   */
  public selectCanisterForInspection(canister: CanisterInstance) {
    if (this.isTransitioning || this.activeMode !== 'drawer' || !this.activeYear) return;
    const cab = this.cabinets.get(this.activeYear);
    const physics = this.physicsMap.get(this.activeYear);
    if (!cab || !physics) return;

    this.clearHoverStates();
    this.setBusy(true);
    this.controls.enabled = false;

    this.inspectedCanister = canister;
    this.inspectedRoll = canister.roll;
    this.inspectedCineReel = null;
    this.inspectedMotionReel = null;

    // Save local pose inside canistersSlotGroup for exact return
    this.savedReturnLocalPos.copy(canister.group.position);
    this.savedReturnLocalQuat.copy(canister.group.quaternion);

    // Detach from XPBD collision simulation and transfer seamlessly into stageGroup world space
    physics.setDetached(canister.roll.id, true);
    this.stageGroup.attach(canister.group);

    // Co-planar flat inspection pose directly facing the overhead camera (+Y)
    const stageCanisterX = -2.08;
    const stageCanisterY = CANISTER_DIMS.CAP_RADIUS;
    const stageCanisterZ = 1.45;
    // Anchor strip inside the canister's velvet exit slit (+X = BODY_RADIUS + 0.05)
    const stripOriginX = stageCanisterX + CANISTER_DIMS.BODY_RADIUS + 0.05;

    // Build N-frame translucent 35mm film strip anchored inside velvet exit slot
    const effectiveSlots = this.getEffectiveVisibleSlots();
    const strip = buildFilmStrip3D(
      canister.roll,
      this.renderer.capabilities.getMaxAnisotropy(),
      this.isSoftwareGl,
      stripOriginX,
      effectiveSlots
    );
    this.activeFilmStrip = strip;
    this.targetFilmScrollX = 0;
    this.currentFilmScrollX = 0;
    this.callbacks.onVisibleSlotsChange?.(strip.visibleSlots);
    this.callbacks.onFilmScrollChange?.(0);

    // Co-planar flat alignment on desk: both canister label and film strip face UP (+Y) toward overhead camera
    strip.group.position.set(stripOriginX, stageCanisterY, stageCanisterZ);
    strip.group.rotation.set(-Math.PI / 2, 0, 0);
    this.scene.add(strip.group);

    const inspectPose = this.getInspectCameraPose(canister.roll.frames.length);

    const allCabinetRoots = Array.from(this.cabinets.values()).map((c) => c.cabinetRoot.position);
    const stripState = { progress: 0 };

    const startQuat = canister.group.quaternion.clone();
    const overheadFlatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const orientState = { liftT: 0 };

    const tl = gsap.timeline({
      onComplete: () => {
        this.activeMode = 'inspect';
        this.setBusy(false);
        this.renderer.domElement.style.cursor = strip.maxScrollX > 0 ? 'grab' : 'default';
        this.callbacks.onModeChange('inspect', this.activeYear, 'stills', canister.roll, null);
      },
    });
    this.activeTimeline = tl;

    const safeClearY = cab.gridY + CABINET_DIMS.CABINET_H + 0.72;
    const safeClearZ = Math.max(canister.group.position.z, 2.55);

    tl.to(
      canister.group.position,
      {
        y: safeClearY,
        z: safeClearZ,
        duration: 0.45,
        ease: 'power2.out',
      },
      0
    );
    tl.to(
      orientState,
      {
        liftT: 1,
        duration: 0.45,
        ease: 'power2.out',
        onUpdate: () => {
          canister.group.quaternion.copy(startQuat).slerp(overheadFlatQuat, orientState.liftT);
        },
      },
      0
    );

    tl.to(
      cab.drawerGroup.position,
      {
        z: 0,
        duration: 0.47,
        ease: 'power2.inOut',
      },
      0.45
    );

    tl.to(
      allCabinetRoots,
      {
        z: CABINET_RETREAT_Z,
        duration: 0.54,
        ease: 'power2.out',
      },
      0.92
    );

    tl.to(
      canister.group.position,
      {
        x: stageCanisterX,
        y: stageCanisterY,
        z: stageCanisterZ,
        duration: 0.56,
        ease: 'power3.inOut',
      },
      1.0
    );

    tl.to(
      this.camera.position,
      {
        x: inspectPose.camPos.x,
        y: inspectPose.camPos.y,
        z: inspectPose.camPos.z,
        duration: 0.68,
        ease: 'power3.inOut',
      },
      0.92
    );

    tl.to(
      this.controls.target,
      {
        x: inspectPose.target.x,
        y: inspectPose.target.y,
        z: inspectPose.target.z,
        duration: 0.68,
        ease: 'power3.inOut',
      },
      0.92
    );

    tl.to(
      stripState,
      {
        progress: 1,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          strip.setUnfurlProgress(stripState.progress);
        },
      },
      1.5
    );
  }

  private setCabinetsVisible(visible: boolean) {
    this.cabinets.forEach((cab) => {
      cab.cabinetRoot.visible = visible;
    });
  }

  /**
   * Motion Reel Projector Screening Sequence:
   * 1) Reel lifts vertically out of the slim lower Motion drawer
   * 2) Lower Motion drawer slides flush closed into the cabinet
   * 3) Cabinets retreat and temporarily disappear while camera moves straight-on facing forward,
   *    minimalist 16mm projector & front projection screen appear, selected reel mounts directly
   *    onto the projector's supply spindle, and live film projection starts immediately!
   */
  public selectReelForInspection(reelInst: CineReelInstance) {
    if (this.isTransitioning || this.activeMode !== 'drawer' || !this.activeYear) return;
    const cab = this.cabinets.get(this.activeYear);
    const tray = this.motionTrayMap.get(this.activeYear);
    if (!cab || !tray) return;

    this.clearHoverStates();
    this.setBusy(true);
    this.controls.enabled = false;

    this.inspectedCineReel = reelInst;
    this.inspectedMotionReel = reelInst.reel;
    this.inspectedCanister = null;
    this.inspectedRoll = null;

    this.savedReturnLocalPos.copy(reelInst.group.position);
    this.savedReturnLocalQuat.copy(reelInst.group.quaternion);

    tray.setDetached(reelInst.reel.id, true);
    this.stageGroup.attach(reelInst.group);

    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const isPortrait = rawAspect < 0.85;

    // Position projector & screen cleanly, read exact world mount pose for the reel spindle
    this.projectorStage.layoutForViewport(isPortrait);
    const targetScreenY = this.projectorStage.screenGroup.position.y;
    const supplyTarget = this.projectorStage.getSupplyMountWorldPose();

    // Prepare entrance drop/rise offsets for projector & floating Vision screen
    this.projectorStage.projectorGroup.position.y = -0.95;
    this.projectorStage.screenGroup.position.y = targetScreenY + 1.55;
    this.projectorStage.rootGroup.visible = true;
    this.projectorStage.loadReel(reelInst.reel, 0);
    this.projectorStage.setProjectionActive(false);

    const projectorPose = this.getProjectorCameraPose();
    const allCabinetRoots = Array.from(this.cabinets.values()).map((c) => c.cabinetRoot.position);

    const startQuat = reelInst.group.quaternion.clone();
    const orientState = { liftT: 0, mountT: 0 };

    const safeClearY = cab.gridY + 0.98;
    const safeClearZ = Math.max(reelInst.group.position.z, 2.6);

    const targetProjScale = isPortrait
      ? PROJECTOR_DIMS.PROJECTOR_SCALE_PORTRAIT
      : PROJECTOR_DIMS.PROJECTOR_SCALE_DESKTOP;

    const tl = gsap.timeline({
      onComplete: () => {
        this.projectorStage.supplyMount.attach(reelInst.group);
        reelInst.group.position.set(0, 0, 0);
        reelInst.group.quaternion.identity();
        reelInst.group.scale.set(1, 1, 1);
        this.projectorStage.layoutForViewport(
          this.camera.aspect < 0.85
        );
        this.projectorStage.setProjectionActive(true);
        this.projectorStage.setPlaying(true);

        this.activeMode = 'inspect';
        this.setBusy(false);
        this.renderer.domElement.style.cursor = 'default';
        this.callbacks.onModeChange('inspect', this.activeYear, 'motion', null, reelInst.reel);
        this.callbacks.onProjectorProgress?.(this.projectorStage.getSnapshot());
      },
    });
    this.activeTimeline = tl;

    // Phase 1: Lift reel vertically in front of cabinet & above lower drawer before closing
    const uprightPreviewQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI * 0.42, 0, 0)
    );
    tl.to(
      reelInst.group.position,
      {
        y: safeClearY,
        z: safeClearZ,
        duration: 0.44,
        ease: 'power2.out',
      },
      0
    );
    tl.to(
      orientState,
      {
        liftT: 1,
        duration: 0.44,
        ease: 'power2.out',
        onUpdate: () => {
          reelInst.group.quaternion.copy(startQuat).slerp(uprightPreviewQuat, orientState.liftT);
        },
      },
      0
    );

    // Phase 2: Close lower Motion drawer flush underneath hovering reel
    tl.to(
      cab.motionDrawerGroup.position,
      {
        z: 0,
        duration: 0.4,
        ease: 'power2.inOut',
      },
      0.44
    );

    // Phase 3: Retreat cabinets first, then bring in projector & screen and mount reel
    tl.to(
      allCabinetRoots,
      {
        z: CABINET_RETREAT_Z - 3.6,
        duration: 0.48,
        ease: 'power2.in',
      },
      0.84
    );
    tl.call(() => this.setCabinetsVisible(false), [], 1.34);

    tl.to(
      this.projectorStage.projectorGroup.position,
      {
        y: 0,
        duration: 0.6,
        ease: 'power3.out',
      },
      1.02
    );

    tl.to(
      this.projectorStage.screenGroup.position,
      {
        y: targetScreenY,
        duration: 0.64,
        ease: 'power3.out',
      },
      1.02
    );

    tl.to(
      reelInst.group.position,
      {
        x: supplyTarget.position.x,
        y: supplyTarget.position.y,
        z: supplyTarget.position.z,
        duration: 0.58,
        ease: 'power3.inOut',
      },
      1.06
    );

    tl.to(
      reelInst.group.scale,
      {
        x: targetProjScale,
        y: targetProjScale,
        z: targetProjScale,
        duration: 0.58,
        ease: 'power3.inOut',
      },
      1.06
    );

    tl.to(
      orientState,
      {
        mountT: 1,
        duration: 0.56,
        ease: 'power3.inOut',
        onUpdate: () => {
          reelInst.group.quaternion
            .copy(uprightPreviewQuat)
            .slerp(supplyTarget.quaternion, orientState.mountT);
        },
      },
      1.06
    );

    tl.to(
      this.camera.position,
      {
        x: projectorPose.camPos.x,
        y: projectorPose.camPos.y,
        z: projectorPose.camPos.z,
        duration: 0.72,
        ease: 'power3.inOut',
      },
      0.92
    );

    tl.to(
      this.controls.target,
      {
        x: projectorPose.target.x,
        y: projectorPose.target.y,
        z: projectorPose.target.z,
        duration: 0.72,
        ease: 'power3.inOut',
      },
      0.92
    );
  }

  public toggleProjectorPlay(): boolean {
    if (this.activeMode !== 'inspect' || !this.inspectedMotionReel) return false;
    const next = !this.projectorStage.getPlaying();
    this.projectorStage.setPlaying(next);
    this.callbacks.onProjectorProgress?.(this.projectorStage.getSnapshot());
    return next;
  }

  public setProjectorPlaying(playing: boolean) {
    if (this.activeMode !== 'inspect' || !this.inspectedMotionReel) return;
    this.projectorStage.setPlaying(playing);
    this.callbacks.onProjectorProgress?.(this.projectorStage.getSnapshot());
  }

  public seekProjectorTo(timeSec: number) {
    if (this.activeMode !== 'inspect' || !this.inspectedMotionReel) return;
    this.projectorStage.seekTo(timeSec);
    this.callbacks.onProjectorProgress?.(this.projectorStage.getSnapshot());
  }

  public toggleProjectorMute(): boolean {
    const next = !this.projectorStage.getMuted();
    this.projectorStage.setMuted(next);
    return next;
  }

  private getProjectorCameraPose() {
    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const isPortrait = rawAspect < 0.85;
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = Math.max(rawAspect, 0.4);
    const tanHalfH = tanHalfV * aspect;

    const screenScale = isPortrait ? 0.34 : 1.0;
    const screenCenterY = isPortrait ? 2.25 : PROJECTOR_DIMS.SCREEN_CENTER_Y;
    const effectiveW = PROJECTOR_DIMS.SCREEN_W * screenScale;
    const effectiveH = PROJECTOR_DIMS.SCREEN_H * screenScale;
    const screenTopY = screenCenterY + effectiveH / 2;

    const pz = isPortrait
      ? PROJECTOR_DIMS.PROJECTOR_Z_PORTRAIT
      : PROJECTOR_DIMS.PROJECTOR_Z_DESKTOP;
    const deltaZ = pz - PROJECTOR_DIMS.SCREEN_Z;

    // Account for concave screen edges curving slightly forward (+Z) toward camera
    const thetaEdge = effectiveW / 2 / PROJECTOR_DIMS.CURVE_RADIUS;
    const curveForwardZ = PROJECTOR_DIMS.CURVE_RADIUS * (1 - Math.cos(thetaEdge));

    const topFrac = isPortrait ? 0.70 : 0.80;
    const footFrac = isPortrait ? 0.74 : 0.80;
    const widthFrac = isPortrait ? 0.94 : 0.92;

    // Solve simultaneously for D so screen top sits under topFrac and projector feet stay above -footFrac
    const distForVertical =
      (screenTopY +
        curveForwardZ * topFrac * tanHalfV +
        deltaZ * footFrac * tanHalfV) /
      ((topFrac + footFrac) * tanHalfV);
    const distForWidth = effectiveW / 2 / (widthFrac * tanHalfH) + curveForwardZ;

    const distFromScreen = Math.max(
      distForVertical,
      distForWidth,
      isPortrait ? 8.2 : 9.8
    );

    const minEyeY = screenTopY - (distFromScreen - curveForwardZ) * topFrac * tanHalfV;
    const maxEyeY = (distFromScreen - deltaZ) * footFrac * tanHalfV;
    const eyeY = (Math.max(0.85, minEyeY) + maxEyeY) * 0.5;
    const camZ = PROJECTOR_DIMS.SCREEN_Z + distFromScreen;

    return {
      camPos: new THREE.Vector3(0, eyeY, camZ),
      target: new THREE.Vector3(0, eyeY, PROJECTOR_DIMS.SCREEN_Z),
    };
  }

  private getInspectCameraPose(frameCount: number) {
    const stageCarrierX = -2.08;
    const stageCarrierY = CANISTER_DIMS.CAP_RADIUS;
    const stageCarrierZ = 1.45;
    const carrierLeftEdge = stageCarrierX - CANISTER_DIMS.CAP_RADIUS;
    const stripOriginX = stageCarrierX + CANISTER_DIMS.BODY_RADIUS + 0.05;
    const effectiveSlots = this.getEffectiveVisibleSlots();
    const visibleSlots = Math.min(frameCount, effectiveSlots);
    const windowWidth =
      FILM_STRIP_CONSTANTS.LEAD_GAP + visibleSlots * FILM_STRIP_CONSTANTS.FRAME_WIDTH;

    const rawAspect =
      this.camera?.aspect ??
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const isPortrait = rawAspect < 0.85;

    const rightEdge = stripOriginX + windowWidth;
    const centerX = (carrierLeftEdge + rightEdge) / 2;
    const halfSpan = (rightEdge - carrierLeftEdge) / 2 + (isPortrait ? 0.22 : 0.54);

    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanHalfH = tanHalfV * Math.max(rawAspect, 0.40);
    const minDist = halfSpan / tanHalfH;
    const baseOverheadDist = Math.hypot(4.26, 1.45);
    const scale = Math.max(1.08, minDist / baseOverheadDist);
    const targetZ = isPortrait ? stageCarrierZ + 0.24 : stageCarrierZ;

    return {
      camPos: new THREE.Vector3(
        centerX,
        stageCarrierY + 4.26 * scale,
        targetZ + 1.45 * scale
      ),
      target: new THREE.Vector3(centerX, stageCarrierY, targetZ),
    };
  }

  public scrollFilmByFrames(deltaFrames: number) {
    if (this.activeMode !== 'inspect' || !this.activeFilmStrip) return;
    if (this.activeFilmStrip.maxScrollX <= 0) return;

    this.targetFilmScrollX = THREE.MathUtils.clamp(
      this.targetFilmScrollX + deltaFrames * FILM_STRIP_CONSTANTS.FRAME_WIDTH,
      0,
      this.activeFilmStrip.maxScrollX
    );
    this.callbacks.onFilmScrollChange?.(
      this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
    );
  }

  public scrollFilmToOffset(offsetFrames: number) {
    if (this.activeMode !== 'inspect' || !this.activeFilmStrip) return;
    if (this.activeFilmStrip.maxScrollX <= 0) return;

    this.targetFilmScrollX = THREE.MathUtils.clamp(
      offsetFrames * FILM_STRIP_CONSTANTS.FRAME_WIDTH,
      0,
      this.activeFilmStrip.maxScrollX
    );
    this.callbacks.onFilmScrollChange?.(
      this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
    );
  }

  public scrollFilmToFrame(frameIndex: number) {
    if (this.activeMode !== 'inspect' || !this.activeFilmStrip) return;
    if (this.activeFilmStrip.maxScrollX <= 0) return;

    const currentStart = this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH;
    const visibleSlots = this.activeFilmStrip.visibleSlots;
    let nextStart = currentStart;
    if (frameIndex < currentStart) {
      nextStart = frameIndex;
    } else if (frameIndex >= currentStart + visibleSlots) {
      nextStart = frameIndex - visibleSlots + 1;
    }

    this.targetFilmScrollX = THREE.MathUtils.clamp(
      nextStart * FILM_STRIP_CONSTANTS.FRAME_WIDTH,
      0,
      this.activeFilmStrip.maxScrollX
    );
    this.callbacks.onFilmScrollChange?.(
      this.targetFilmScrollX / FILM_STRIP_CONSTANTS.FRAME_WIDTH
    );
  }

  public returnToDrawer(onDone?: () => void) {
    if (this.isTransitioning || this.activeMode !== 'inspect') return;
    if (!this.activeYear) return;
    const isMotion = this.inspectedCineReel !== null;
    const carrierGroup = isMotion
      ? this.inspectedCineReel?.group
      : this.inspectedCanister?.group;
    if (!carrierGroup) return;

    const cab = this.cabinets.get(this.activeYear);
    const physics = this.physicsMap.get(this.activeYear);
    const tray = this.motionTrayMap.get(this.activeYear);
    const strip = this.activeFilmStrip;
    if (!cab) return;

    const returnCategory: DrawerCategory = isMotion ? 'motion' : 'stills';
    const targetDrawerGroup = this.getDrawerGroup(cab, returnCategory);
    const targetSlotGroup = isMotion ? cab.motionSlotGroup : cab.canistersSlotGroup;

    this.clearHoverStates();
    this.setBusy(true);

    if (isMotion) {
      this.projectorStage.setProjectionActive(false);
      this.stageGroup.attach(carrierGroup);
    }

    const slotWorldCenter = new THREE.Vector3(
      this.savedReturnLocalPos.x + cab.gridX,
      cab.gridY + this.savedReturnLocalPos.y,
      this.savedReturnLocalPos.z + CABINET_DIMS.DRAWER_OPEN_Z + 0.08
    );

    const drawerBaseY = cab.gridY;
    const drawerPose = this.getDrawerCameraPose(cab, returnCategory);

    const allCabinetRoots = Array.from(this.cabinets.values()).map((c) => c.cabinetRoot.position);
    const stripState = { progress: 1 };
    const startInspectQuat = carrierGroup.quaternion.clone();
    const targetDropQuat = this.savedReturnLocalQuat.clone();
    const orientState = { t: 0 };

    const tl = gsap.timeline({
      onComplete: () => {
        if (strip) {
          this.scene.remove(strip.group);
          strip.dispose();
          this.activeFilmStrip = null;
        }
        if (isMotion) {
          this.projectorStage.rootGroup.visible = false;
        }
        targetSlotGroup.attach(carrierGroup);
        carrierGroup.scale.set(1, 1, 1);
        if (isMotion && this.inspectedCineReel) {
          tray?.setDetached(this.inspectedCineReel.reel.id, false, true);
        } else if (this.inspectedCanister) {
          physics?.setDetached(this.inspectedCanister.roll.id, false, true);
        }

        this.inspectedCanister = null;
        this.inspectedRoll = null;
        this.inspectedCineReel = null;
        this.inspectedMotionReel = null;
        this.activeCategory = returnCategory;
        this.activeMode = 'drawer';
        this.setBusy(false);
        this.renderer.domElement.style.cursor = 'default';
        this.callbacks.onModeChange('drawer', this.activeYear, returnCategory, null, null);
        onDone?.();
      },
    });
    this.activeTimeline = tl;

    if (strip) {
      tl.to(
        stripState,
        {
          progress: 0,
          duration: 0.45,
          ease: 'power2.inOut',
          onUpdate: () => {
            strip.setUnfurlProgress(stripState.progress);
          },
        },
        0
      );
    }

    if (isMotion) {
      // Motion Reel Return: clear screen/projector -> move reel cleanly out in front of cabinets (z >= 2.61)
      // BEFORE sliding cabinets forward -> open lower drawer underneath -> drop straight down into velvet slot.
      const hoverY = drawerBaseY + 0.94;
      const hoverZ = Math.max(slotWorldCenter.z, 2.61);

      tl.to(
        this.projectorStage.projectorGroup.position,
        {
          y: -0.95,
          duration: 0.44,
          ease: 'power2.in',
        },
        0
      );
      tl.to(
        this.projectorStage.screenGroup.position,
        {
          y: this.projectorStage.screenGroup.position.y + 1.55,
          duration: 0.44,
          ease: 'power2.in',
        },
        0
      );
      tl.to(
        carrierGroup.position,
        {
          x: slotWorldCenter.x,
          y: hoverY,
          z: hoverZ,
          duration: 0.5,
          ease: 'power2.out',
        },
        0.04
      );
      tl.to(
        carrierGroup.scale,
        {
          x: 1,
          y: 1,
          z: 1,
          duration: 0.46,
          ease: 'power2.out',
        },
        0.04
      );
      tl.to(
        orientState,
        {
          t: 1,
          duration: 0.48,
          ease: 'power2.inOut',
          onUpdate: () => {
            carrierGroup.quaternion.copy(startInspectQuat).slerp(targetDropQuat, orientState.t);
          },
        },
        0.06
      );
      tl.call(
        () => {
          this.projectorStage.rootGroup.visible = false;
          this.setCabinetsVisible(true);
        },
        [],
        0.54
      );

      // Now reel is safely hovering out at z >= 2.61 (well in front of z <= 1.70 cabinets), bring cabinets forward
      tl.to(
        allCabinetRoots,
        {
          z: 0,
          duration: 0.54,
          ease: 'power3.inOut',
        },
        0.54
      );
      tl.to(
        this.camera.position,
        {
          x: drawerPose.camPos.x,
          y: drawerPose.camPos.y,
          z: drawerPose.camPos.z,
          duration: 0.64,
          ease: 'power3.inOut',
        },
        0.54
      );
      tl.to(
        this.controls.target,
        {
          x: drawerPose.target.x,
          y: drawerPose.target.y,
          z: drawerPose.target.z,
          duration: 0.64,
          ease: 'power3.inOut',
        },
        0.54
      );

      // Slide lower slim drawer open underneath hovering reel (y = hoverY > drawer front top 0.545)
      tl.to(
        targetDrawerGroup.position,
        {
          z: CABINET_DIMS.DRAWER_OPEN_Z,
          duration: 0.44,
          ease: 'power2.out',
        },
        1.08
      );

      // Pure vertical drop onto the open drawer velvet slot
      tl.to(
        carrierGroup.position,
        {
          y: slotWorldCenter.y + 0.015,
          z: slotWorldCenter.z,
          duration: 0.38,
          ease: 'power2.in',
        },
        1.52
      );
    } else {
      const safeReturnY = drawerBaseY + CABINET_DIMS.CABINET_H + 0.72;
      const safeHoverZ = Math.max(slotWorldCenter.z, 2.55);

      tl.to(
        carrierGroup.position,
        {
          y: safeReturnY,
          duration: 0.4,
          ease: 'power2.out',
        },
        0.45
      );

      tl.to(
        allCabinetRoots,
        {
          z: 0,
          duration: 0.57,
          ease: 'power3.inOut',
        },
        0.85
      );

      tl.to(
        carrierGroup.position,
        {
          x: slotWorldCenter.x,
          z: safeHoverZ,
          duration: 0.57,
          ease: 'power3.inOut',
        },
        0.85
      );

      tl.to(
        orientState,
        {
          t: 1,
          duration: 0.55,
          ease: 'power2.inOut',
          onUpdate: () => {
            carrierGroup.quaternion.copy(startInspectQuat).slerp(targetDropQuat, orientState.t);
          },
        },
        0.85
      );

      tl.to(
        this.camera.position,
        {
          x: drawerPose.camPos.x,
          y: drawerPose.camPos.y,
          z: drawerPose.camPos.z,
          duration: 0.65,
          ease: 'power3.inOut',
        },
        0.85
      );

      tl.to(
        this.controls.target,
        {
          x: drawerPose.target.x,
          y: drawerPose.target.y,
          z: drawerPose.target.z,
          duration: 0.65,
          ease: 'power3.inOut',
        },
        0.85
      );

      tl.to(
        targetDrawerGroup.position,
        {
          z: CABINET_DIMS.DRAWER_OPEN_Z,
          duration: 0.46,
          ease: 'power2.out',
        },
        1.42
      );

      tl.to(
        carrierGroup.position,
        {
          y: slotWorldCenter.y + 0.025,
          z: slotWorldCenter.z,
          duration: 0.42,
          ease: 'power2.in',
        },
        1.88
      );
    }
  }

  public jumpToRoll(roll: FilmRoll) {
    if (this.isTransitioning) return;

    const triggerSelect = () => {
      const canister = this.canistersById.get(roll.id);
      if (canister) {
        this.selectCanisterForInspection(canister);
      }
    };

    if (this.activeMode === 'inspect') {
      if (this.inspectedRoll?.id === roll.id) return;
      this.returnToDrawer(() => {
        if (this.activeYear === roll.year && this.activeCategory === 'stills') {
          triggerSelect();
        } else {
          this.openYearDrawerAndThen(roll.year, 'stills', triggerSelect);
        }
      });
      return;
    }

    if (this.activeMode === 'drawer' && this.activeYear === roll.year && this.activeCategory === 'stills') {
      triggerSelect();
      return;
    }

    this.openYearDrawerAndThen(roll.year, 'stills', triggerSelect);
  }

  public jumpToMotionReel(reel: MotionReel) {
    if (this.isTransitioning) return;

    const triggerSelect = () => {
      const reelInst = this.reelsById.get(reel.id);
      if (reelInst) {
        this.selectReelForInspection(reelInst);
      }
    };

    if (this.activeMode === 'inspect') {
      if (this.inspectedMotionReel?.id === reel.id) return;
      this.returnToDrawer(() => {
        if (this.activeYear === reel.year && this.activeCategory === 'motion') {
          triggerSelect();
        } else {
          this.openYearDrawerAndThen(reel.year, 'motion', triggerSelect);
        }
      });
      return;
    }

    if (this.activeMode === 'drawer' && this.activeYear === reel.year && this.activeCategory === 'motion') {
      triggerSelect();
      return;
    }

    this.openYearDrawerAndThen(reel.year, 'motion', triggerSelect);
  }

  private openYearDrawerAndThen(
    year: ArchiveYear,
    category: DrawerCategory,
    afterOpen: () => void
  ) {
    const prevYear = this.activeYear;
    const prevCategory = this.activeCategory;
    const prevCab = prevYear ? this.cabinets.get(prevYear) : null;
    const targetCab = this.cabinets.get(year);
    if (!targetCab) return;

    this.clearHoverStates();
    this.setBusy(true);
    this.controls.enabled = false;

    const tl = gsap.timeline({
      onComplete: () => {
        this.activeYear = year;
        this.activeCategory = category;
        this.activeMode = 'drawer';
        this.setBusy(false);
        this.callbacks.onModeChange('drawer', year, category, null, null);
        afterOpen();
      },
    });
    this.activeTimeline = tl;

    let openStart = 0;
    if (prevCab) {
      const prevDrawer = this.getDrawerGroup(prevCab, prevCategory);
      tl.to(prevDrawer.position, { z: 0, duration: 0.4, ease: 'power2.inOut' }, 0);
      openStart = 0.18;
    }

    const targetDrawer = this.getDrawerGroup(targetCab, category);
    tl.to(
      targetDrawer.position,
      { z: CABINET_DIMS.DRAWER_OPEN_Z, duration: 0.55, ease: 'power3.out' },
      openStart
    );

    const drawerPose = this.getDrawerCameraPose(targetCab, category);

    tl.to(
      this.camera.position,
      {
        x: drawerPose.camPos.x,
        y: drawerPose.camPos.y,
        z: drawerPose.camPos.z,
        duration: 0.75,
        ease: 'power3.inOut',
      },
      openStart
    );
    tl.to(
      this.controls.target,
      {
        x: drawerPose.target.x,
        y: drawerPose.target.y,
        z: drawerPose.target.z,
        duration: 0.75,
        ease: 'power3.inOut',
      },
      openStart
    );
  }

  private animateCameraTo(pos: THREE.Vector3, target: THREE.Vector3, duration: number) {
    gsap.to(this.camera.position, {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      duration,
      ease: 'power3.inOut',
    });
    gsap.to(this.controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration,
      ease: 'power3.inOut',
    });
  }

  // =========================================================================
  // RENDER & PHYSICS LOOP
  // =========================================================================

  private tick = () => {
    if (this.disposed) return;

    const dt = this.clock.getDelta();

    // Step XPBD physics for canisters or smooth hover tray for cine reels in active open drawer
    if (this.activeYear && this.activeMode === 'drawer') {
      if (this.activeCategory === 'stills') {
        const physics = this.physicsMap.get(this.activeYear);
        physics?.step(dt);
      } else {
        const tray = this.motionTrayMap.get(this.activeYear);
        tray?.step(dt);
      }
    }

    // Smoothly dissolve/restore amber film mask on hovered frame & damp horizontal film scroll
    if (this.activeMode === 'inspect') {
      if (this.inspectedMotionReel && this.projectorStage.rootGroup.visible) {
        const snap = this.projectorStage.step(dt, this.inspectedCineReel?.group);
        const now = performance.now();
        if (
          now - this.lastProjectorEmit > 85 ||
          snap.activeKeyframeIdx !== this.lastProjectorKeyIdx ||
          snap.isPlaying !== this.lastProjectorPlaying
        ) {
          this.lastProjectorEmit = now;
          this.lastProjectorKeyIdx = snap.activeKeyframeIdx;
          this.lastProjectorPlaying = snap.isPlaying;
          this.callbacks.onProjectorProgress?.(snap);
        }
      }

      if (this.activeFilmStrip) {
        if (Math.abs(this.currentFilmScrollX - this.targetFilmScrollX) > 0.0005) {
          this.currentFilmScrollX = THREE.MathUtils.damp(
            this.currentFilmScrollX,
            this.targetFilmScrollX,
            12,
            dt
          );
          this.activeFilmStrip.setScrollX(this.currentFilmScrollX);
        }

        for (const mesh of this.activeFilmStrip.frameMeshes) {
          const targetReveal = (mesh.userData.targetReveal as number | undefined) ?? 0;
          const revealUniform = mesh.userData.revealUniform as { value: number } | undefined;
          if (revealUniform) {
            revealUniform.value = THREE.MathUtils.damp(revealUniform.value, targetReveal, 14, dt);
          }
        }
      }
    }

    if (this.controls.enabled) {
      this.controls.update();
    } else {
      this.camera.lookAt(this.controls.target);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 50);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 50);
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.activeTimeline?.kill();

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerCancel);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('resize', this.onResize);

    this.activeFilmStrip?.dispose();
    this.projectorStage.dispose();
    this.cabinets.forEach((c) => c.dispose());
    this.canistersById.forEach((c) => c.labelTex.dispose());
    this.reelsById.forEach((r) => r.labelTex.dispose());
    this.disposables.forEach((d) => d.dispose());
    this.controls.dispose();
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
