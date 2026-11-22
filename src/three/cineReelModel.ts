import * as THREE from 'three';
import { MotionReel } from '../data/archiveData';
import { CABINET_DIMS } from './cabinetModel';
import {
  createCineReelHubTexture,
  getBeadBlastedMaps,
  getBrushedMetalMaps,
  getSatinPaperRoughnessMap,
} from './textures';

export const REEL_DIMS = {
  OUTER_RADIUS: 0.34,
  FILM_PACK_RADIUS: 0.285,
  HUB_RADIUS: 0.148,
  FLANGE_THICKNESS: 0.014,
  CORE_HEIGHT: 0.088,
  TOTAL_THICKNESS: 0.116, // FLANGE * 2 + CORE_HEIGHT
} as const;

interface SharedReelAssets {
  flangeGeo: THREE.ExtrudeGeometry;
  filmPackGeo: THREE.CylinderGeometry;
  hubCapGeo: THREE.CylinderGeometry;
  labelDiscGeo: THREE.CircleGeometry;
  spindleRingGeo: THREE.TorusGeometry;
  tongueGeo: THREE.BoxGeometry;
  hitProxyGeo: THREE.CylinderGeometry;
  flangeMetalMat: THREE.MeshPhysicalMaterial;
  hubMetalMat: THREE.MeshPhysicalMaterial;
  filmPackMat: THREE.MeshPhysicalMaterial;
  filmTongueMat: THREE.MeshPhysicalMaterial;
  hitProxyMat: THREE.MeshBasicMaterial;
}

let sharedReelAssets: SharedReelAssets | null = null;

function createPerforatedFlangeGeometry(): THREE.ExtrudeGeometry {
  const { OUTER_RADIUS, FLANGE_THICKNESS } = REEL_DIMS;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, OUTER_RADIUS, 0, Math.PI * 2, false);

  // Center arbor bore
  const arborHole = new THREE.Path();
  arborHole.absarc(0, 0, 0.036, 0, Math.PI * 2, true);
  shape.holes.push(arborHole);

  // Three signature circular lightening windows revealing wound amber film pack
  const windowRingR = 0.228;
  const windowR = 0.068;
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const hole = new THREE.Path();
    hole.absarc(
      Math.cos(angle) * windowRingR,
      Math.sin(angle) * windowRingR,
      windowR,
      0,
      Math.PI * 2,
      true
    );
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: FLANGE_THICKNESS,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.0025,
    bevelSegments: 2,
    curveSegments: 32,
  });
  // Center along Z then orient flange in XZ plane (normal along +Y)
  geo.translate(0, 0, -FLANGE_THICKNESS / 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function getSharedReelAssets(maxAnisotropy: number): SharedReelAssets {
  if (sharedReelAssets) return sharedReelAssets;

  const brushedMaps = getBrushedMetalMaps(maxAnisotropy);
  const beadMaps = getBeadBlastedMaps(maxAnisotropy);

  const flangeGeo = createPerforatedFlangeGeometry();
  const filmPackGeo = new THREE.CylinderGeometry(
    REEL_DIMS.FILM_PACK_RADIUS,
    REEL_DIMS.FILM_PACK_RADIUS,
    REEL_DIMS.CORE_HEIGHT,
    32
  );
  const hubCapGeo = new THREE.CylinderGeometry(
    REEL_DIMS.HUB_RADIUS + 0.012,
    REEL_DIMS.HUB_RADIUS + 0.012,
    REEL_DIMS.CORE_HEIGHT + REEL_DIMS.FLANGE_THICKNESS * 2 + 0.006,
    28
  );
  const labelDiscGeo = new THREE.CircleGeometry(REEL_DIMS.HUB_RADIUS, 32);
  labelDiscGeo.rotateX(-Math.PI / 2);

  const spindleRingGeo = new THREE.TorusGeometry(0.038, 0.007, 10, 24);
  spindleRingGeo.rotateX(Math.PI / 2);

  const tongueGeo = new THREE.BoxGeometry(0.08, 0.008, 0.085);
  const hitProxyGeo = new THREE.CylinderGeometry(
    REEL_DIMS.OUTER_RADIUS * 1.05,
    REEL_DIMS.OUTER_RADIUS * 1.05,
    REEL_DIMS.TOTAL_THICKNESS + 0.08,
    18
  );

  // Brushed anodized aluminum outer flanges
  const flangeMetalMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfd4da,
    roughness: 0.24,
    metalness: 0.9,
    clearcoat: 0.14,
    clearcoatRoughness: 0.2,
    roughnessMap: brushedMaps.roughnessMap,
    bumpMap: brushedMaps.bumpMap,
    bumpScale: 0.0038,
    envMapIntensity: 1.25,
  });

  // Dark gunmetal machined center hub
  const hubMetalMat = new THREE.MeshPhysicalMaterial({
    color: 0x26292e,
    roughness: 0.38,
    metalness: 0.78,
    clearcoat: 0.08,
    roughnessMap: beadMaps.roughnessMap,
    envMapIntensity: 0.85,
  });

  // Coiled 16mm deep amber film pack visible through flange cutouts
  const filmPackMat = new THREE.MeshPhysicalMaterial({
    color: 0x6b3a12,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.32,
    clearcoatRoughness: 0.22,
    roughnessMap: brushedMaps.roughnessMap,
    envMapIntensity: 0.52,
  });

  const filmTongueMat = new THREE.MeshPhysicalMaterial({
    color: 0xca8a46,
    roughness: 0.36,
    metalness: 0.0,
    clearcoat: 0.28,
  });

  const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });

  sharedReelAssets = {
    flangeGeo,
    filmPackGeo,
    hubCapGeo,
    labelDiscGeo,
    spindleRingGeo,
    tongueGeo,
    hitProxyGeo,
    flangeMetalMat,
    hubMetalMat,
    filmPackMat,
    filmTongueMat,
    hitProxyMat,
  };

  return sharedReelAssets;
}

export interface CineReelInstance {
  reel: MotionReel;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  labelMat: THREE.MeshPhysicalMaterial;
  labelTex: THREE.CanvasTexture;
}

export function buildCineReelModel(
  reel: MotionReel,
  maxAnisotropy: number
): CineReelInstance {
  const assets = getSharedReelAssets(maxAnisotropy);
  const group = new THREE.Group();
  group.name = `cine-reel-${reel.id}`;

  const halfCore = REEL_DIMS.CORE_HEIGHT / 2;
  const flangeY = halfCore + REEL_DIMS.FLANGE_THICKNESS / 2;

  // 1. Coiled 16mm amber film spool inside
  const filmPack = new THREE.Mesh(assets.filmPackGeo, assets.filmPackMat);
  filmPack.castShadow = true;
  filmPack.receiveShadow = true;
  group.add(filmPack);

  // 2. Top & bottom 3-window perforated brushed aluminum flanges
  const topFlange = new THREE.Mesh(assets.flangeGeo, assets.flangeMetalMat);
  topFlange.position.y = flangeY;
  topFlange.castShadow = true;
  topFlange.receiveShadow = true;
  group.add(topFlange);

  const bottomFlange = new THREE.Mesh(assets.flangeGeo, assets.flangeMetalMat);
  bottomFlange.position.y = -flangeY;
  bottomFlange.castShadow = true;
  bottomFlange.receiveShadow = true;
  group.add(bottomFlange);

  // 3. Machined center hub collar & spindle ring
  const hubCap = new THREE.Mesh(assets.hubCapGeo, assets.hubMetalMat);
  hubCap.castShadow = true;
  group.add(hubCap);

  const labelTex = createCineReelHubTexture(
    reel.year,
    reel.reelNumber,
    reel.title,
    reel.filmStock,
    reel.durationLabel,
    reel.fps,
    maxAnisotropy
  );
  const paperRoughnessMap = getSatinPaperRoughnessMap(maxAnisotropy);
  const labelMat = new THREE.MeshPhysicalMaterial({
    map: labelTex,
    roughness: 0.8,
    metalness: 0.0,
    roughnessMap: paperRoughnessMap,
    envMapIntensity: 0.45,
  });

  const labelDisc = new THREE.Mesh(assets.labelDiscGeo, labelMat);
  labelDisc.position.y = REEL_DIMS.TOTAL_THICKNESS / 2 + 0.005;
  group.add(labelDisc);

  const spindleRing = new THREE.Mesh(assets.spindleRingGeo, assets.flangeMetalMat);
  spindleRing.position.y = REEL_DIMS.TOTAL_THICKNESS / 2 + 0.007;
  group.add(spindleRing);

  // 4. Subtle amber film leader tongue peeking out along +X
  const tongue = new THREE.Mesh(assets.tongueGeo, assets.filmTongueMat);
  tongue.position.set(REEL_DIMS.FILM_PACK_RADIUS + 0.025, 0, 0);
  group.add(tongue);

  // 5. Layer 1 raycast hit proxy
  const hitMesh = new THREE.Mesh(assets.hitProxyGeo, assets.hitProxyMat);
  hitMesh.layers.set(1);
  hitMesh.userData.reelId = reel.id;
  hitMesh.userData.reel = reel;
  group.add(hitMesh);

  return {
    reel,
    group,
    hitMesh,
    labelMat,
    labelTex,
  };
}

interface TrayReelEntry {
  instance: CineReelInstance;
  homePos: THREE.Vector3;
  homeYaw: number;
  currentYOffset: number;
  currentTiltX: number;
  isDetached: boolean;
}

/**
 * Arranges 4-5 flat 16mm/Super-8 cine reels cleanly inside the slim Motion velvet drawer
 * with gentle hover buoyancy.
 */
export class MotionTrayController {
  private entries: TrayReelEntry[] = [];
  private entryMap = new Map<string, TrayReelEntry>();
  private hoveredId: string | null = null;

  constructor(reels: CineReelInstance[]) {
    const { MOTION_DRAWER_FLOOR_Y, DRAWER_INNER_W, DRAWER_INNER_D } = CABINET_DIMS;
    const restY = MOTION_DRAWER_FLOOR_Y + REEL_DIMS.TOTAL_THICKNESS / 2 + 0.004;

    const total = reels.length;
    const backCount = total >= 5 ? 3 : Math.ceil(total / 2);
    const frontCount = total - backCount;
    const rows = frontCount > 0 ? [backCount, frontCount] : [backCount];
    const rowZs =
      rows.length === 2
        ? [-DRAWER_INNER_D * 0.22, DRAWER_INNER_D * 0.22]
        : [0];

    let idx = 0;
    for (let r = 0; r < rows.length; r++) {
      const count = rows[r];
      const maxSpan = count >= 3 ? DRAWER_INNER_W - 0.92 : DRAWER_INNER_W - 1.32;
      for (let c = 0; c < count; c++) {
        if (idx >= reels.length) break;
        const inst = reels[idx];
        const frac = count === 1 ? 0.5 : c / (count - 1);
        const x = (frac - 0.5) * maxSpan + Math.sin(idx * 2.3) * 0.02;
        const z = rowZs[r] + Math.cos(idx * 1.9) * 0.02;
        const homeYaw = Math.sin(idx * 3.1) * 0.24;

        const homePos = new THREE.Vector3(x, restY, z);
        inst.group.position.copy(homePos);
        inst.group.rotation.set(0, homeYaw, 0);

        const entry: TrayReelEntry = {
          instance: inst,
          homePos,
          homeYaw,
          currentYOffset: 0,
          currentTiltX: 0,
          isDetached: false,
        };
        this.entries.push(entry);
        this.entryMap.set(inst.reel.id, entry);
        idx++;
      }
    }
  }

  public setHoveredReel(reelId: string | null) {
    this.hoveredId = reelId;
  }

  public setDetached(reelId: string, detached: boolean, resetSlotPose = false) {
    const entry = this.entryMap.get(reelId);
    if (!entry) return;
    entry.isDetached = detached;
    if (!detached && resetSlotPose) {
      entry.currentYOffset = 0;
      entry.currentTiltX = 0;
      entry.instance.group.position.copy(entry.homePos);
      entry.instance.group.rotation.set(0, entry.homeYaw, 0);
    }
  }

  public step(dt: number) {
    const clampedDt = Math.min(dt, 0.05);
    for (const entry of this.entries) {
      if (entry.isDetached) continue;
      const isHovered = entry.instance.reel.id === this.hoveredId;
      const targetY = isHovered ? 0.032 : 0;
      const targetTiltX = isHovered ? 0.09 : 0;
      entry.currentYOffset = THREE.MathUtils.damp(entry.currentYOffset, targetY, 12, clampedDt);
      entry.currentTiltX = THREE.MathUtils.damp(entry.currentTiltX, targetTiltX, 12, clampedDt);
      entry.instance.group.position.set(
        entry.homePos.x,
        entry.homePos.y + entry.currentYOffset,
        entry.homePos.z
      );
      entry.instance.group.rotation.set(entry.currentTiltX, entry.homeYaw, 0);
    }
  }
}
