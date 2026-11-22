import * as THREE from 'three';
import { FilmRoll, MotionReel, PhotoFrame, getYearConfig } from '../data/archiveData';
import {
  MotionFrameStripeMeta,
  createCanisterLabelTexture,
  createFilmFrameCanvasTexture,
  createFilmLeaderTexture,
  getBeadBlastedMaps,
  getBrushedMetalMaps,
  getFilmAcetateMaps,
  getSatinPaperRoughnessMap,
  loadImageCached,
} from './textures';

export const CANISTER_DIMS = {
  BODY_RADIUS: 0.225,
  BODY_HEIGHT: 0.68,
  CAP_RADIUS: 0.242,
  CAP_HEIGHT: 0.042,
  TOTAL_HEIGHT: 0.764,
  LIP_OUTER_X: 0.295,
  LIP_THICKNESS_Z: 0.135,
  SPOOL_HEIGHT: 0.11,
} as const;

// Shared geometries & materials for crisp draw-call efficiency across 40 canisters
interface SharedCanisterAssets {
  bodyGeo: THREE.CylinderGeometry;
  labelGeo: THREE.CylinderGeometry;
  capGeo: THREE.CylinderGeometry;
  capRimGeo: THREE.TorusGeometry;
  spoolShaftGeo: THREE.CylinderGeometry;
  spoolCollarGeo: THREE.CylinderGeometry;
  lipShellGeo: THREE.BoxGeometry;
  lipVelvetGeo: THREE.BoxGeometry;
  hitProxyGeo: THREE.CylinderGeometry;
  matteBlackMat: THREE.MeshPhysicalMaterial;
  capMetalMat: THREE.MeshPhysicalMaterial;
  velvetMat: THREE.MeshPhysicalMaterial;
  spoolPlasticMat: THREE.MeshPhysicalMaterial;
  hitProxyMat: THREE.MeshBasicMaterial;
}

let sharedAssets: SharedCanisterAssets | null = null;

function getSharedCanisterAssets(maxAnisotropy: number): SharedCanisterAssets {
  if (sharedAssets) return sharedAssets;

  const beadMaps = getBeadBlastedMaps(maxAnisotropy);
  const brushedMaps = getBrushedMetalMaps(maxAnisotropy);

  const { BODY_RADIUS, BODY_HEIGHT, CAP_RADIUS, CAP_HEIGHT, LIP_THICKNESS_Z } = CANISTER_DIMS;

  const bodyGeo = new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 28);

  // Label wraps from 0.58*PI around -Z, -X, +Z to 0.42*PI, leaving clean slot for exit lip at +X (0.5*PI)
  const labelGeo = new THREE.CylinderGeometry(
    BODY_RADIUS + 0.003,
    BODY_RADIUS + 0.003,
    BODY_HEIGHT * 0.92,
    28,
    1,
    true,
    Math.PI * 0.58,
    Math.PI * 1.84
  );

  const capGeo = new THREE.CylinderGeometry(CAP_RADIUS, CAP_RADIUS, CAP_HEIGHT, 28);
  const capRimGeo = new THREE.TorusGeometry(CAP_RADIUS * 0.88, 0.011, 10, 28);
  capRimGeo.rotateX(Math.PI / 2);

  const spoolShaftGeo = new THREE.CylinderGeometry(0.072, 0.072, CANISTER_DIMS.SPOOL_HEIGHT, 16);
  const spoolCollarGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.025, 16);

  const lipShellGeo = new THREE.BoxGeometry(0.115, BODY_HEIGHT * 0.94, LIP_THICKNESS_Z);
  const lipVelvetGeo = new THREE.BoxGeometry(0.036, BODY_HEIGHT * 0.88, LIP_THICKNESS_Z * 0.72);

  const hitProxyGeo = new THREE.CylinderGeometry(CAP_RADIUS * 1.08, CAP_RADIUS * 1.08, CANISTER_DIMS.TOTAL_HEIGHT + 0.1, 12);

  // Frosted matte black bead-blasted canister housing (deep matte contrast)
  const matteBlackMat = new THREE.MeshPhysicalMaterial({
    color: 0x15171a,
    roughness: 0.88,
    metalness: 0.04,
    clearcoat: 0.0,
    sheen: 0.1,
    sheenRoughness: 0.92,
    sheenColor: new THREE.Color(0x30343a),
    roughnessMap: beadMaps.roughnessMap,
    bumpMap: beadMaps.bumpMap,
    bumpScale: 0.0045,
    envMapIntensity: 0.3,
  });

  // Frosted matte anodized gunmetal end caps
  const capMetalMat = new THREE.MeshPhysicalMaterial({
    color: 0x3b4047,
    roughness: 0.56,
    metalness: 0.58,
    clearcoat: 0.0,
    roughnessMap: beadMaps.roughnessMap,
    bumpMap: brushedMaps.bumpMap,
    bumpScale: 0.0038,
    envMapIntensity: 0.55,
  });

  // Light-trap velvet slot with subtle fabric sheen
  const velvetMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d0e10,
    roughness: 0.96,
    metalness: 0.0,
    sheen: 0.75,
    sheenRoughness: 0.74,
    sheenColor: new THREE.Color(0x454a52),
    roughnessMap: beadMaps.roughnessMap,
    envMapIntensity: 0.22,
  });

  // Frosted matte polycarbonate spool
  const spoolPlasticMat = new THREE.MeshPhysicalMaterial({
    color: 0x222529,
    roughness: 0.8,
    metalness: 0.04,
    clearcoat: 0.0,
    envMapIntensity: 0.35,
  });

  const hitProxyMat = new THREE.MeshBasicMaterial({
    visible: false,
  });

  sharedAssets = {
    bodyGeo,
    labelGeo,
    capGeo,
    capRimGeo,
    spoolShaftGeo,
    spoolCollarGeo,
    lipShellGeo,
    lipVelvetGeo,
    hitProxyGeo,
    matteBlackMat,
    capMetalMat,
    velvetMat,
    spoolPlasticMat,
    hitProxyMat,
  };

  return sharedAssets;
}

export interface CanisterInstance {
  roll: FilmRoll;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  labelMat: THREE.MeshPhysicalMaterial;
  labelTex: THREE.CanvasTexture;
}

export function buildCanisterModel(roll: FilmRoll, maxAnisotropy: number): CanisterInstance {
  const assets = getSharedCanisterAssets(maxAnisotropy);
  const group = new THREE.Group();
  group.name = `canister-${roll.id}`;

  const { BODY_HEIGHT, CAP_HEIGHT, BODY_RADIUS, SPOOL_HEIGHT } = CANISTER_DIMS;

  // 1. Matte black inner cylinder shell
  const bodyMesh = new THREE.Mesh(assets.bodyGeo, assets.matteBlackMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // 2. Printed archival paper label sleeve
  const labelTex = createCanisterLabelTexture(
    roll.year,
    roll.rollNumber,
    roll.title,
    roll.filmStock,
    roll.frames.length,
    maxAnisotropy
  );
  const paperRoughnessMap = getSatinPaperRoughnessMap(maxAnisotropy);
  const labelMat = new THREE.MeshPhysicalMaterial({
    map: labelTex,
    roughness: 0.84,
    metalness: 0.0,
    clearcoat: 0.0,
    roughnessMap: paperRoughnessMap,
    envMapIntensity: 0.45,
  });
  const labelMesh = new THREE.Mesh(assets.labelGeo, labelMat);
  labelMesh.castShadow = true;
  labelMesh.receiveShadow = true;
  group.add(labelMesh);

  // 3. Top & bottom crimped anodized metal end caps + rolled edge rims
  const capOffset = BODY_HEIGHT / 2 + CAP_HEIGHT / 2;
  const topCap = new THREE.Mesh(assets.capGeo, assets.capMetalMat);
  topCap.position.y = capOffset;
  topCap.castShadow = true;
  topCap.receiveShadow = true;
  group.add(topCap);

  const topRim = new THREE.Mesh(assets.capRimGeo, assets.capMetalMat);
  topRim.position.y = capOffset + CAP_HEIGHT / 2;
  group.add(topRim);

  const bottomCap = new THREE.Mesh(assets.capGeo, assets.capMetalMat);
  bottomCap.position.y = -capOffset;
  bottomCap.castShadow = true;
  bottomCap.receiveShadow = true;
  group.add(bottomCap);

  const bottomRim = new THREE.Mesh(assets.capRimGeo, assets.capMetalMat);
  bottomRim.position.y = -capOffset - CAP_HEIGHT / 2;
  group.add(bottomRim);

  // 4. Protruding velvet light-trap exit lip along +X
  const lipShell = new THREE.Mesh(assets.lipShellGeo, assets.matteBlackMat);
  lipShell.position.set(BODY_RADIUS + 0.015, 0, 0);
  lipShell.castShadow = true;
  lipShell.receiveShadow = true;
  group.add(lipShell);

  const lipVelvet = new THREE.Mesh(assets.lipVelvetGeo, assets.velvetMat);
  lipVelvet.position.set(BODY_RADIUS + 0.062, 0, 0);
  group.add(lipVelvet);

  // 5. Central rewind spindle spool shaft at +Y
  const spoolShaft = new THREE.Mesh(assets.spoolShaftGeo, assets.spoolPlasticMat);
  spoolShaft.position.y = capOffset + CAP_HEIGHT / 2 + SPOOL_HEIGHT / 2 - 0.01;
  spoolShaft.castShadow = true;
  group.add(spoolShaft);

  const spoolCollar = new THREE.Mesh(assets.spoolCollarGeo, assets.capMetalMat);
  spoolCollar.position.y = capOffset + CAP_HEIGHT / 2 + 0.01;
  group.add(spoolCollar);

  // 6. Dedicated Layer 1 raycast hit proxy
  const hitMesh = new THREE.Mesh(assets.hitProxyGeo, assets.hitProxyMat);
  hitMesh.layers.set(1);
  hitMesh.userData.canisterId = roll.id;
  hitMesh.userData.roll = roll;
  group.add(hitMesh);

  return {
    roll,
    group,
    hitMesh,
    labelMat,
    labelTex,
  };
}

export const FILM_STRIP_CONSTANTS = {
  FRAME_WIDTH: 0.66,
  FRAME_HEIGHT: 0.495,
  LEAD_GAP: 0.16,
  VISIBLE_SLOTS: 6,
  MOBILE_VISIBLE_SLOTS: 2,
} as const;

export interface FilmStripInstance {
  group: THREE.Group;
  frameMeshes: THREE.Mesh[];
  hitMeshes: THREE.Mesh[];
  totalFrames: number;
  visibleSlots: number;
  maxScrollX: number;
  clipLeftX: number;
  clipRightX: number;
  setUnfurlProgress: (t: number) => void;
  setScrollX: (scrollX: number) => void;
  setVisibleSlots: (slots: number) => void;
  setHoveredFrame: (frameIndex: number | null) => void;
  dispose: () => void;
}

/**
 * Builds an N-frame translucent amber 35mm film strip emerging seamlessly from inside
 * the canister's velvet exit lip (+X) using GPU clipping planes so zero gap or distortion occurs.
 * Supports >6 frames via smooth horizontal film-gate scrolling.
 */
export function buildFilmStrip3D(
  source: FilmRoll | MotionReel,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
  worldOriginX: number,
  initialVisibleSlots: number = FILM_STRIP_CONSTANTS.VISIBLE_SLOTS
): FilmStripInstance {
  const isMotion = 'keyframes' in source;
  const items = isMotion
    ? source.keyframes.map((kf) => ({
        frameNumber: kf.frameNumber,
        frameCode: kf.frameCode,
        filmStock: source.filmStock,
        cropFocus: kf.cropFocus,
        imageUrl: kf.imageUrl,
        motionMeta: {
          fps: source.fps,
          timecode: kf.timecode,
          durationLabel: source.durationLabel,
        } as MotionFrameStripeMeta,
        rawItem: kf,
      }))
    : source.frames.map((frame: PhotoFrame) => ({
        frameNumber: frame.frameNumber,
        frameCode: frame.frameCode,
        filmStock: frame.filmStock,
        cropFocus: frame.cropFocus,
        imageUrl: frame.imageUrl,
        motionMeta: undefined as MotionFrameStripeMeta | undefined,
        rawItem: frame,
      }));

  const yearCfg = getYearConfig(source.year);
  const group = new THREE.Group();
  group.name = `film-strip-${source.id}`;

  const { FRAME_WIDTH, FRAME_HEIGHT, LEAD_GAP } = FILM_STRIP_CONSTANTS;
  let visibleSlots = Math.min(items.length, Math.max(1, initialVisibleSlots));
  let windowWidth = LEAD_GAP + visibleSlots * FRAME_WIDTH;
  let maxScrollX = Math.max(0, (items.length - visibleSlots) * FRAME_WIDTH);

  const clipLeftX = worldOriginX;
  let clipRightX = worldOriginX + windowWidth;

  // World-space clipping planes:
  // Left plane hides anything inside the canister (worldX < clipLeftX)
  // Right plane creates a clean archival film-gate edge (worldX > clipRightX during unfurl / multi-frame scroll)
  const leftClipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -clipLeftX);
  const rightClipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipLeftX);
  const clipPlanes = [leftClipPlane, rightClipPlane];

  const trackGroup = new THREE.Group();
  trackGroup.name = 'film-strip-track';
  group.add(trackGroup);

  const disposables: { dispose: () => void }[] = [];
  const frameMeshes: THREE.Mesh[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  const frameMats: THREE.MeshPhysicalMaterial[] = [];

  // Leading bridge anchored inside the velvet slit (extends -0.06 inside slit up to LEAD_GAP)
  const leaderTex = createFilmLeaderTexture(maxAnisotropy);
  disposables.push(leaderTex);
  const leaderLen = LEAD_GAP + 0.06;
  const leaderGeo = new THREE.PlaneGeometry(leaderLen, FRAME_HEIGHT, 2, 1);
  disposables.push(leaderGeo);

  const acetateMaps = getFilmAcetateMaps(maxAnisotropy);

  const leaderDepthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: leaderTex,
    alphaTest: 0.4,
    clippingPlanes: clipPlanes,
  });
  disposables.push(leaderDepthMat);

  const leaderMat = new THREE.MeshPhysicalMaterial({
    map: leaderTex,
    roughnessMap: acetateMaps.roughnessMap,
    bumpMap: acetateMaps.bumpMap,
    bumpScale: 0.0028,
    transparent: true,
    alphaTest: 0.4,
    opacity: 0.97,
    roughness: 0.36,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    ior: 1.49,
    envMapIntensity: 0.36,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: leaderTex,
    emissiveIntensity: 0.04,
    side: THREE.DoubleSide,
    depthWrite: true,
    clippingPlanes: clipPlanes,
  });
  disposables.push(leaderMat);

  const leaderMesh = new THREE.Mesh(leaderGeo, leaderMat);
  leaderMesh.position.set(LEAD_GAP - leaderLen / 2, 0, 0);
  leaderMesh.castShadow = !isSoftwareGl;
  leaderMesh.customDepthMaterial = leaderDepthMat;
  trackGroup.add(leaderMesh);

  // Minimal right-edge gate marker when total frames exceed visible gate slots
  let gateMesh: THREE.Mesh | null = null;
  if (items.length > 1) {
    const gateGeo = new THREE.BoxGeometry(0.028, FRAME_HEIGHT + 0.08, 0.04);
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x222426,
      roughness: 0.4,
      metalness: 0.65,
    });
    gateMesh = new THREE.Mesh(gateGeo, gateMat);
    gateMesh.position.set(windowWidth + 0.014, 0, 0);
    gateMesh.castShadow = true;
    gateMesh.visible = false;
    group.add(gateMesh);
    disposables.push(gateGeo, gateMat);
  }

  // Build N seamless adjacent frame planes
  const frameGeo = new THREE.PlaneGeometry(FRAME_WIDTH, FRAME_HEIGHT, 2, 1);
  disposables.push(frameGeo);

  const hitGeo = new THREE.PlaneGeometry(FRAME_WIDTH * 0.96, FRAME_HEIGHT * 1.04);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(hitGeo, hitMat);

  items.forEach((entry, idx: number) => {
    const { texture, updateWithImage } = createFilmFrameCanvasTexture(
      entry,
      yearCfg.color,
      maxAnisotropy,
      entry.motionMeta
    );
    disposables.push(texture);

    const frameDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: texture,
      alphaTest: 0.4,
      clippingPlanes: clipPlanes,
    });
    disposables.push(frameDepthMat);

    // Load actual photograph into the frame window asynchronously
    loadImageCached(entry.imageUrl)
      .then((img) => {
        updateWithImage(img);
      })
      .catch(() => {
        // Keep clean C-41 negative fallback if image fails
      });

    const revealUniform = { value: 0.0 };

    const mat = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughnessMap: acetateMaps.roughnessMap,
      bumpMap: acetateMaps.bumpMap,
      bumpScale: 0.0028,
      transparent: true,
      alphaTest: 0.4,
      opacity: 0.97,
      roughness: 0.36,
      metalness: 0.0,
      clearcoat: 0.28,
      clearcoatRoughness: 0.18,
      ior: 1.49,
      envMapIntensity: 0.36,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
      depthWrite: true,
      side: THREE.DoubleSide,
      clippingPlanes: clipPlanes,
    });
    mat.customProgramCacheKey = () => `babel-film-frame-reveal-v6-${idx}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uReveal = revealUniform;
      shader.fragmentShader =
        `uniform float uReveal;\n` +
        shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            bool babelInWin = vMapUv.x > 0.052 && vMapUv.x < 0.948 && vMapUv.y > 0.199 && vMapUv.y < 0.801;
            if (babelInWin) {
              float babelLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              float babelNegD = pow(clamp(babelLuma, 0.0, 1.0), 0.48);
              // Deeper C-41 negative Linear RGB stops for solid contrast over white viewing light-box
              vec3 babelLightAmber = vec3(0.45, 0.150, 0.020);
              vec3 babelMidGolden  = vec3(0.20, 0.048, 0.005);
              vec3 babelDarkBrown  = vec3(0.072, 0.014, 0.0016);
              vec3 babelDeepUmber  = vec3(0.028, 0.0045, 0.0006);
              vec3 babelCurve;
              if (babelNegD < 0.42) {
                babelCurve = mix(babelLightAmber, babelMidGolden, babelNegD / 0.42);
              } else if (babelNegD < 0.78) {
                babelCurve = mix(babelMidGolden, babelDarkBrown, (babelNegD - 0.42) / 0.36);
              } else {
                babelCurve = mix(babelDarkBrown, babelDeepUmber, (babelNegD - 0.78) / 0.22);
              }
              vec3 babelInvColor = pow(clamp(1.0 - diffuseColor.rgb, 0.0, 1.0), vec3(1.5)) * vec3(0.38, 0.11, 0.015);
              vec3 babelMasked = mix(babelCurve, babelInvColor, 0.14);
              diffuseColor.rgb = mix(babelMasked, diffuseColor.rgb * 1.04, uReveal);
            }
            float babelBX = step(0.047, vMapUv.x) * step(vMapUv.x, 0.953);
            float babelBY = step(0.193, vMapUv.y) * step(vMapUv.y, 0.807);
            float babelInner = step(0.054, vMapUv.x) * step(vMapUv.x, 0.946) * step(0.201, vMapUv.y) * step(vMapUv.y, 0.799);
            float babelOnBorder = babelBX * babelBY * (1.0 - babelInner);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.90, 0.82), babelOnBorder * uReveal * 0.75);
            `
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            // Minimal ambient lift on unhovered negative so deep amber-brown density holds cleanly
            totalEmissiveRadiance += diffuseColor.rgb * mix(0.04, 0.32, babelInWin ? uReveal : 0.0);
            `
          );
    };
    disposables.push(mat);
    frameMats.push(mat);

    const mesh = new THREE.Mesh(frameGeo, mat);
    const baseX = LEAD_GAP + idx * FRAME_WIDTH + FRAME_WIDTH / 2;
    mesh.position.set(baseX, 0, 0);
    mesh.userData = {
      baseX,
      frameIndex: idx,
      frame: entry.rawItem,
      revealUniform,
      targetReveal: 0,
    };
    mesh.castShadow = !isSoftwareGl;
    mesh.customDepthMaterial = frameDepthMat;
    trackGroup.add(mesh);
    frameMeshes.push(mesh);

    // Layer 1 raycast hit box per frame inside trackGroup
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.set(baseX, 0, 0.02);
    hit.layers.set(1);
    hit.userData = {
      frameIndex: idx,
      frame: entry.rawItem,
    };
    trackGroup.add(hit);
    hitMeshes.push(hit);
  });

  let currentScrollX = 0;
  let currentUnfurl = 0;

  const updateTrackTransform = () => {
    const visibleExtent = windowWidth * currentUnfurl;
    rightClipPlane.constant = clipLeftX + visibleExtent;
    // Slide rigid track straight out of the velvet exit slot
    const trackX = -(windowWidth * (1 - currentUnfurl)) - currentScrollX;
    trackGroup.position.x = trackX;

    if (gateMesh) {
      gateMesh.position.x = windowWidth + 0.014;
      gateMesh.visible = items.length > visibleSlots && currentUnfurl > 0.05;
    }

    const gateMinWorldX = clipLeftX + 0.002;
    const gateMaxWorldX = clipLeftX + visibleExtent - 0.002;
    const leaderLeftWorldX = worldOriginX + trackX - 0.06;
    const leaderRightWorldX = worldOriginX + trackX + LEAD_GAP;
    leaderMesh.visible =
      currentUnfurl > 0.005 &&
      leaderRightWorldX > gateMinWorldX &&
      leaderLeftWorldX < gateMaxWorldX;

    frameMeshes.forEach((mesh) => {
      const baseX = mesh.userData.baseX as number;
      const frameLeftWorldX = worldOriginX + trackX + baseX - FRAME_WIDTH / 2;
      const frameRightWorldX = worldOriginX + trackX + baseX + FRAME_WIDTH / 2;
      mesh.visible =
        currentUnfurl > 0.005 &&
        frameRightWorldX > gateMinWorldX &&
        frameLeftWorldX < gateMaxWorldX;
    });

    const activeHits = currentUnfurl > 0.92;
    hitMeshes.forEach((hit) => {
      hit.visible = activeHits;
    });
  };

  const setUnfurlProgress = (t: number) => {
    currentUnfurl = THREE.MathUtils.clamp(t, 0, 1);
    group.visible = currentUnfurl > 0.005;
    updateTrackTransform();
  };

  const setScrollX = (scrollX: number) => {
    currentScrollX = THREE.MathUtils.clamp(scrollX, 0, maxScrollX);
    updateTrackTransform();
  };

  const setHoveredFrame = (hoveredIdx: number | null) => {
    frameMeshes.forEach((mesh, idx) => {
      const isHovered = hoveredIdx === idx;
      const mat = frameMats[idx];
      mesh.userData.targetReveal = isHovered ? 1.0 : 0.0;
      mat.emissiveIntensity = isHovered ? 0.14 : 0.02;
    });
  };

  const instance: FilmStripInstance = {
    group,
    frameMeshes,
    hitMeshes,
    totalFrames: items.length,
    visibleSlots,
    maxScrollX,
    clipLeftX,
    clipRightX,
    setUnfurlProgress,
    setScrollX,
    setVisibleSlots: (slots: number) => {
      visibleSlots = Math.min(items.length, Math.max(1, slots));
      windowWidth = LEAD_GAP + visibleSlots * FRAME_WIDTH;
      maxScrollX = Math.max(0, (items.length - visibleSlots) * FRAME_WIDTH);
      clipRightX = worldOriginX + windowWidth;
      instance.visibleSlots = visibleSlots;
      instance.maxScrollX = maxScrollX;
      instance.clipRightX = clipRightX;
      currentScrollX = THREE.MathUtils.clamp(currentScrollX, 0, maxScrollX);
      updateTrackTransform();
    },
    setHoveredFrame,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };

  setUnfurlProgress(0);

  return instance;
}
