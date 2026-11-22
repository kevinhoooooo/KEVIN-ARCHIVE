import * as THREE from 'three';
import { YearConfig } from '../data/archiveData';
import {
  createMotionPlaqueTexture,
  createYearPlaqueTexture,
  getBeadBlastedMaps,
  getBrushedMetalMaps,
  getVelvetFlockMaps,
} from './textures';

export const CABINET_DIMS = {
  CABINET_W: 2.9,
  CABINET_H: 1.56,
  CABINET_D: 3.24,
  SHELL_WALL: 0.075,
  BASE_PLINTH_H: 0.08,
  DIVIDER_H: 0.055,

  DRAWER_WALL: 0.065,
  DRAWER_INNER_W: 2.54,
  DRAWER_INNER_D: 2.86,
  DRAWER_INNER_H: 0.68,
  DRAWER_FLOOR_Y: 0.675,
  DRAWER_OPEN_Z: 3.16,

  MOTION_DRAWER_INNER_H: 0.28,
  MOTION_DRAWER_FLOOR_Y: 0.225,
} as const;

export interface CabinetInstance {
  config: YearConfig;
  gridX: number;
  gridY: number;
  cabinetRoot: THREE.Group;
  cabinetShell: THREE.Group;
  drawerGroup: THREE.Group;
  canistersSlotGroup: THREE.Group;
  motionDrawerGroup: THREE.Group;
  motionSlotGroup: THREE.Group;
  hitMeshes: THREE.Mesh[];
  plaqueTex: THREE.CanvasTexture;
  motionPlaqueTex: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Computes 4-column × N-row stacked cabinet matrix coordinates.
 * 1-4 years -> single horizontal row at y=0.
 * 5-8+ years -> stacked multi-tier archive matrix (newest years on upper tiers).
 */
export function getCabinetGridPose(index: number, totalCount: number): { x: number; y: number } {
  const maxCols = 4;
  const colPitch = 3.3;
  const totalRows = Math.max(1, Math.ceil(totalCount / maxCols));
  const row = Math.floor(index / maxCols);
  const col = index % maxCols;
  const itemsInRow = row === totalRows - 1 ? totalCount - row * maxCols : maxCols;
  const x = (col - (itemsInRow - 1) / 2) * colPitch;
  const y = (totalRows - 1 - row) * (CABINET_DIMS.CABINET_H + 0.02);
  return { x, y };
}

export function buildCabinetModel(
  config: YearConfig,
  gridIndex: number,
  totalCabinets: number,
  maxAnisotropy: number,
  stillsRollCount = 10,
  motionReelCount = 4
): CabinetInstance {
  const {
    CABINET_W,
    CABINET_H,
    CABINET_D,
    SHELL_WALL,
    BASE_PLINTH_H,
    DIVIDER_H,
    DRAWER_WALL,
    DRAWER_INNER_W,
    DRAWER_INNER_D,
    DRAWER_INNER_H,
    DRAWER_FLOOR_Y,
    MOTION_DRAWER_INNER_H,
    MOTION_DRAWER_FLOOR_Y,
  } = CABINET_DIMS;

  const disposables: { dispose: () => void }[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  const gridPose = getCabinetGridPose(gridIndex, totalCabinets);

  const cabinetRoot = new THREE.Group();
  cabinetRoot.name = `cabinet-root-${config.year}`;
  cabinetRoot.position.set(gridPose.x, gridPose.y, 0);

  const beadMaps = getBeadBlastedMaps(maxAnisotropy);
  const brushedMaps = getBrushedMetalMaps(maxAnisotropy);
  const velvetMaps = getVelvetFlockMaps(maxAnisotropy);

  const cabinetMat = new THREE.MeshPhysicalMaterial({
    color: 0xcbd0d6,
    roughness: 0.3,
    metalness: 0.78,
    clearcoat: 0.08,
    clearcoatRoughness: 0.28,
    roughnessMap: beadMaps.roughnessMap,
    bumpMap: beadMaps.bumpMap,
    bumpScale: 0.0045,
    envMapIntensity: 1.15,
  });

  const plinthMat = new THREE.MeshPhysicalMaterial({
    color: 0x45494f,
    roughness: 0.34,
    metalness: 0.82,
    clearcoat: 0.1,
    clearcoatRoughness: 0.26,
    roughnessMap: beadMaps.roughnessMap,
    bumpMap: beadMaps.bumpMap,
    bumpScale: 0.0035,
    envMapIntensity: 0.95,
  });

  const drawerMat = new THREE.MeshPhysicalMaterial({
    color: 0xefeae0,
    roughness: 0.24,
    metalness: 0.04,
    clearcoat: 0.78,
    clearcoatRoughness: 0.1,
    reflectivity: 0.9,
    roughnessMap: beadMaps.roughnessMap,
    bumpMap: beadMaps.bumpMap,
    bumpScale: 0.0032,
    envMapIntensity: 0.95,
  });

  const drawerVelvetMat = new THREE.MeshPhysicalMaterial({
    map: velvetMaps.map,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0.0,
    sheen: 1.0,
    sheenRoughness: 0.56,
    sheenColor: new THREE.Color(0x32363e),
    roughnessMap: velvetMaps.roughnessMap,
    bumpMap: velvetMaps.bumpMap,
    bumpScale: 0.016,
    envMapIntensity: 0.14,
  });

  const brushedMetalMat = new THREE.MeshPhysicalMaterial({
    color: 0xcdd2d8,
    roughness: 0.22,
    metalness: 0.94,
    clearcoat: 0.16,
    clearcoatRoughness: 0.18,
    roughnessMap: brushedMaps.roughnessMap,
    bumpMap: brushedMaps.bumpMap,
    bumpScale: 0.0042,
    envMapIntensity: 1.3,
  });

  disposables.push(
    cabinetMat,
    plinthMat,
    drawerMat,
    drawerVelvetMat,
    brushedMetalMat
  );

  // ==========================================================
  // 1. CABINET SHELL (Child of cabinetRoot)
  // ==========================================================
  const cabinetShell = new THREE.Group();
  cabinetShell.name = `cabinet-shell-${config.year}`;
  cabinetRoot.add(cabinetShell);

  const plinthGeo = new THREE.BoxGeometry(CABINET_W - 0.14, BASE_PLINTH_H, CABINET_D - 0.14);
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.position.set(0, BASE_PLINTH_H / 2, -0.02);
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  cabinetShell.add(plinthMesh);

  const shellBodyH = CABINET_H - BASE_PLINTH_H;
  const shellCenterY = BASE_PLINTH_H + shellBodyH / 2;

  const topGeo = new THREE.BoxGeometry(CABINET_W, SHELL_WALL, CABINET_D);
  const topMesh = new THREE.Mesh(topGeo, cabinetMat);
  topMesh.position.set(0, CABINET_H - SHELL_WALL / 2, 0);
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  cabinetShell.add(topMesh);

  const bottomGeo = new THREE.BoxGeometry(CABINET_W, SHELL_WALL, CABINET_D);
  const bottomMesh = new THREE.Mesh(bottomGeo, cabinetMat);
  bottomMesh.position.set(0, BASE_PLINTH_H + SHELL_WALL / 2, 0);
  bottomMesh.castShadow = true;
  bottomMesh.receiveShadow = true;
  cabinetShell.add(bottomMesh);

  // Middle aluminum divider shelf separating Upper Stills drawer & Lower Motion drawer
  const dividerGeo = new THREE.BoxGeometry(CABINET_W - SHELL_WALL * 2, DIVIDER_H, CABINET_D - 0.06);
  const dividerMesh = new THREE.Mesh(dividerGeo, cabinetMat);
  dividerMesh.position.set(0, 0.5825, -0.015);
  dividerMesh.castShadow = true;
  dividerMesh.receiveShadow = true;
  cabinetShell.add(dividerMesh);

  const sideGeo = new THREE.BoxGeometry(SHELL_WALL, shellBodyH, CABINET_D);
  const leftWall = new THREE.Mesh(sideGeo, cabinetMat);
  leftWall.position.set(-CABINET_W / 2 + SHELL_WALL / 2, shellCenterY, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  cabinetShell.add(leftWall);

  const rightWall = new THREE.Mesh(sideGeo, cabinetMat);
  rightWall.position.set(CABINET_W / 2 - SHELL_WALL / 2, shellCenterY, 0);
  rightWall.castShadow = true;
  rightWall.receiveShadow = true;
  cabinetShell.add(rightWall);

  const backGeo = new THREE.BoxGeometry(CABINET_W - SHELL_WALL * 2, shellBodyH, SHELL_WALL);
  const backWall = new THREE.Mesh(backGeo, cabinetMat);
  backWall.position.set(0, shellCenterY, -CABINET_D / 2 + SHELL_WALL / 2);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  cabinetShell.add(backWall);

  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const shellHitGeo = new THREE.BoxGeometry(CABINET_W, CABINET_H, CABINET_D);
  const shellHit = new THREE.Mesh(shellHitGeo, hitMat);
  shellHit.position.set(0, CABINET_H / 2, 0);
  shellHit.layers.set(1);
  shellHit.userData.cabinetYear = config.year;
  shellHit.userData.drawerType = 'stills';
  cabinetShell.add(shellHit);
  hitMeshes.push(shellHit);

  disposables.push(
    plinthGeo,
    topGeo,
    bottomGeo,
    dividerGeo,
    sideGeo,
    backGeo,
    shellHitGeo,
    hitMat
  );

  // Shared helper to construct a precision velvet-lined porcelain drawer tray
  const drawerOuterW = DRAWER_INNER_W + DRAWER_WALL * 2;
  const drawerOuterD = DRAWER_INNER_D + DRAWER_WALL * 2;
  const velvetPadThick = 0.024;
  const drawerFloorThick = 0.028;
  const drawerCenterZ = 0.08;
  const velvetWallThick = 0.008;
  const outerWallThick = DRAWER_WALL - velvetWallThick;
  const frontFaceW = CABINET_W - SHELL_WALL * 2 - 0.03;
  const frontFaceThick = 0.08;
  const frontFaceZ = CABINET_D / 2 - frontFaceThick / 2 + 0.015;

  const buildTrayShell = (
    targetGroup: THREE.Group,
    floorY: number,
    innerH: number,
    frontCenterY: number,
    frontH: number
  ) => {
    const dFloorGeo = new THREE.BoxGeometry(drawerOuterW, drawerFloorThick, drawerOuterD);
    const dFloor = new THREE.Mesh(dFloorGeo, drawerMat);
    dFloor.position.set(0, floorY - velvetPadThick - drawerFloorThick / 2, drawerCenterZ);
    dFloor.castShadow = true;
    dFloor.receiveShadow = true;
    targetGroup.add(dFloor);

    const dVelvetFloorGeo = new THREE.BoxGeometry(DRAWER_INNER_W, velvetPadThick, DRAWER_INNER_D);
    const dVelvetFloor = new THREE.Mesh(dVelvetFloorGeo, drawerVelvetMat);
    dVelvetFloor.position.set(0, floorY - velvetPadThick / 2, drawerCenterZ);
    dVelvetFloor.receiveShadow = true;
    targetGroup.add(dVelvetFloor);

    const dSideGeo = new THREE.BoxGeometry(outerWallThick, innerH, drawerOuterD);
    const dLeft = new THREE.Mesh(dSideGeo, drawerMat);
    dLeft.position.set(
      -(DRAWER_INNER_W / 2 + velvetWallThick + outerWallThick / 2),
      floorY + innerH / 2,
      drawerCenterZ
    );
    dLeft.castShadow = true;
    dLeft.receiveShadow = true;
    targetGroup.add(dLeft);

    const dRight = new THREE.Mesh(dSideGeo, drawerMat);
    dRight.position.set(
      DRAWER_INNER_W / 2 + velvetWallThick + outerWallThick / 2,
      floorY + innerH / 2,
      drawerCenterZ
    );
    dRight.castShadow = true;
    dRight.receiveShadow = true;
    targetGroup.add(dRight);

    const velvetWallH = innerH - 0.015;
    const dVelvetSideGeo = new THREE.BoxGeometry(velvetWallThick, velvetWallH, DRAWER_INNER_D);
    const dVelvetLeft = new THREE.Mesh(dVelvetSideGeo, drawerVelvetMat);
    dVelvetLeft.position.set(
      -(DRAWER_INNER_W / 2 + velvetWallThick / 2),
      floorY + velvetWallH / 2,
      drawerCenterZ
    );
    dVelvetLeft.receiveShadow = true;
    targetGroup.add(dVelvetLeft);

    const dVelvetRight = new THREE.Mesh(dVelvetSideGeo, drawerVelvetMat);
    dVelvetRight.position.set(
      DRAWER_INNER_W / 2 + velvetWallThick / 2,
      floorY + velvetWallH / 2,
      drawerCenterZ
    );
    dVelvetRight.receiveShadow = true;
    targetGroup.add(dVelvetRight);

    const dSideTrimGeo = new THREE.BoxGeometry(DRAWER_WALL + 0.004, 0.014, drawerOuterD);
    const dLeftTrim = new THREE.Mesh(dSideTrimGeo, brushedMetalMat);
    dLeftTrim.position.set(
      -(DRAWER_INNER_W / 2 + DRAWER_WALL / 2),
      floorY + innerH + 0.007,
      drawerCenterZ
    );
    targetGroup.add(dLeftTrim);

    const dRightTrim = new THREE.Mesh(dSideTrimGeo, brushedMetalMat);
    dRightTrim.position.set(
      DRAWER_INNER_W / 2 + DRAWER_WALL / 2,
      floorY + innerH + 0.007,
      drawerCenterZ
    );
    targetGroup.add(dRightTrim);

    const dBackGeo = new THREE.BoxGeometry(
      DRAWER_INNER_W + velvetWallThick * 2,
      innerH,
      outerWallThick
    );
    const dBack = new THREE.Mesh(dBackGeo, drawerMat);
    dBack.position.set(
      0,
      floorY + innerH / 2,
      drawerCenterZ - (DRAWER_INNER_D / 2 + velvetWallThick + outerWallThick / 2)
    );
    dBack.castShadow = true;
    dBack.receiveShadow = true;
    targetGroup.add(dBack);

    const dVelvetEndGeo = new THREE.BoxGeometry(DRAWER_INNER_W, velvetWallH, velvetWallThick);
    const dVelvetBack = new THREE.Mesh(dVelvetEndGeo, drawerVelvetMat);
    dVelvetBack.position.set(
      0,
      floorY + velvetWallH / 2,
      drawerCenterZ - (DRAWER_INNER_D / 2 + velvetWallThick / 2)
    );
    dVelvetBack.receiveShadow = true;
    targetGroup.add(dVelvetBack);

    const frontFaceGeo = new THREE.BoxGeometry(frontFaceW, frontH, frontFaceThick);
    const frontFace = new THREE.Mesh(frontFaceGeo, drawerMat);
    frontFace.position.set(0, frontCenterY, frontFaceZ);
    frontFace.castShadow = true;
    frontFace.receiveShadow = true;
    targetGroup.add(frontFace);

    const dInnerFrontGeo = new THREE.BoxGeometry(
      DRAWER_INNER_W + velvetWallThick * 2,
      innerH,
      outerWallThick
    );
    const dInnerFront = new THREE.Mesh(dInnerFrontGeo, drawerMat);
    dInnerFront.position.set(
      0,
      floorY + innerH / 2,
      drawerCenterZ + (DRAWER_INNER_D / 2 + velvetWallThick + outerWallThick / 2)
    );
    targetGroup.add(dInnerFront);

    const dVelvetFront = new THREE.Mesh(dVelvetEndGeo, drawerVelvetMat);
    dVelvetFront.position.set(
      0,
      floorY + velvetWallH / 2,
      drawerCenterZ + (DRAWER_INNER_D / 2 + velvetWallThick / 2)
    );
    dVelvetFront.receiveShadow = true;
    targetGroup.add(dVelvetFront);

    disposables.push(
      dFloorGeo,
      dVelvetFloorGeo,
      dSideGeo,
      dVelvetSideGeo,
      dSideTrimGeo,
      dBackGeo,
      dVelvetEndGeo,
      frontFaceGeo,
      dInnerFrontGeo
    );
  };

  // ==========================================================
  // 2. UPPER STILLS DRAWER (10 Film Canisters)
  // ==========================================================
  const drawerGroup = new THREE.Group();
  drawerGroup.name = `drawer-group-${config.year}`;
  cabinetRoot.add(drawerGroup);

  const upperFrontCenterY = 1.0475;
  const upperFrontH = 0.855;
  buildTrayShell(drawerGroup, DRAWER_FLOOR_Y, DRAWER_INNER_H, upperFrontCenterY, upperFrontH);

  const plaqueTex = createYearPlaqueTexture(
    config.year,
    config.color,
    config.filmStock,
    maxAnisotropy,
    stillsRollCount
  );
  const plaqueMat = new THREE.MeshPhysicalMaterial({
    map: plaqueTex,
    roughness: 0.24,
    metalness: 0.18,
    clearcoat: 0.72,
    clearcoatRoughness: 0.09,
    roughnessMap: brushedMaps.roughnessMap,
    envMapIntensity: 1.35,
  });
  const plaqueBackingGeo = new THREE.BoxGeometry(1.22, 0.35, 0.012);
  const plaqueBacking = new THREE.Mesh(plaqueBackingGeo, brushedMetalMat);
  plaqueBacking.position.set(0, upperFrontCenterY + 0.14, frontFaceZ + frontFaceThick / 2 + 0.006);
  drawerGroup.add(plaqueBacking);

  const plaqueFaceGeo = new THREE.PlaneGeometry(1.2, 0.33);
  const plaqueMesh = new THREE.Mesh(plaqueFaceGeo, plaqueMat);
  plaqueMesh.position.set(0, upperFrontCenterY + 0.14, frontFaceZ + frontFaceThick / 2 + 0.013);
  drawerGroup.add(plaqueMesh);

  const handleY = upperFrontCenterY - 0.19;
  const handleBarGeo = new THREE.BoxGeometry(0.84, 0.036, 0.044);
  const handleBar = new THREE.Mesh(handleBarGeo, brushedMetalMat);
  handleBar.position.set(0, handleY, frontFaceZ + frontFaceThick / 2 + 0.042);
  handleBar.castShadow = true;
  drawerGroup.add(handleBar);

  const handlePostGeo = new THREE.BoxGeometry(0.034, 0.03, 0.04);
  const leftPost = new THREE.Mesh(handlePostGeo, brushedMetalMat);
  leftPost.position.set(-0.34, handleY, frontFaceZ + frontFaceThick / 2 + 0.02);
  drawerGroup.add(leftPost);

  const rightPost = new THREE.Mesh(handlePostGeo, brushedMetalMat);
  rightPost.position.set(0.34, handleY, frontFaceZ + frontFaceThick / 2 + 0.02);
  drawerGroup.add(rightPost);

  const drawerHitGeo = new THREE.BoxGeometry(frontFaceW, upperFrontH, 0.2);
  const drawerHit = new THREE.Mesh(drawerHitGeo, hitMat);
  drawerHit.position.set(0, upperFrontCenterY, frontFaceZ + 0.05);
  drawerHit.layers.set(1);
  drawerHit.userData.cabinetYear = config.year;
  drawerHit.userData.drawerType = 'stills';
  drawerGroup.add(drawerHit);
  hitMeshes.push(drawerHit);

  const canistersSlotGroup = new THREE.Group();
  canistersSlotGroup.name = `canisters-slot-${config.year}`;
  canistersSlotGroup.position.set(0, 0, drawerCenterZ);
  drawerGroup.add(canistersSlotGroup);

  // ==========================================================
  // 3. LOWER SLIM MOTION DRAWER (4-5 16mm/Super-8 Cine Reels)
  // ==========================================================
  const motionDrawerGroup = new THREE.Group();
  motionDrawerGroup.name = `motion-drawer-group-${config.year}`;
  cabinetRoot.add(motionDrawerGroup);

  const lowerFrontCenterY = 0.355;
  const lowerFrontH = 0.38;
  buildTrayShell(
    motionDrawerGroup,
    MOTION_DRAWER_FLOOR_Y,
    MOTION_DRAWER_INNER_H,
    lowerFrontCenterY,
    lowerFrontH
  );

  const motionPlaqueTex = createMotionPlaqueTexture(
    config.year,
    config.color,
    motionReelCount,
    maxAnisotropy
  );
  const motionPlaqueMat = new THREE.MeshPhysicalMaterial({
    map: motionPlaqueTex,
    roughness: 0.24,
    metalness: 0.18,
    clearcoat: 0.72,
    clearcoatRoughness: 0.09,
    roughnessMap: brushedMaps.roughnessMap,
    envMapIntensity: 1.35,
  });
  const mPlaqueBackingGeo = new THREE.BoxGeometry(1.06, 0.19, 0.01);
  const mPlaqueBacking = new THREE.Mesh(mPlaqueBackingGeo, brushedMetalMat);
  mPlaqueBacking.position.set(
    -0.55,
    lowerFrontCenterY,
    frontFaceZ + frontFaceThick / 2 + 0.005
  );
  motionDrawerGroup.add(mPlaqueBacking);

  const mPlaqueFaceGeo = new THREE.PlaneGeometry(1.04, 0.175);
  const mPlaqueMesh = new THREE.Mesh(mPlaqueFaceGeo, motionPlaqueMat);
  mPlaqueMesh.position.set(
    -0.55,
    lowerFrontCenterY,
    frontFaceZ + frontFaceThick / 2 + 0.011
  );
  motionDrawerGroup.add(mPlaqueMesh);

  // Slim brushed pull bar on right half of lower motion drawer front
  const mHandleBarGeo = new THREE.BoxGeometry(0.68, 0.028, 0.04);
  const mHandleBar = new THREE.Mesh(mHandleBarGeo, brushedMetalMat);
  mHandleBar.position.set(0.55, lowerFrontCenterY, frontFaceZ + frontFaceThick / 2 + 0.038);
  mHandleBar.castShadow = true;
  motionDrawerGroup.add(mHandleBar);

  const mHandlePostGeo = new THREE.BoxGeometry(0.028, 0.024, 0.036);
  const mLeftPost = new THREE.Mesh(mHandlePostGeo, brushedMetalMat);
  mLeftPost.position.set(0.28, lowerFrontCenterY, frontFaceZ + frontFaceThick / 2 + 0.018);
  motionDrawerGroup.add(mLeftPost);

  const mRightPost = new THREE.Mesh(mHandlePostGeo, brushedMetalMat);
  mRightPost.position.set(0.82, lowerFrontCenterY, frontFaceZ + frontFaceThick / 2 + 0.018);
  motionDrawerGroup.add(mRightPost);

  const motionDrawerHitGeo = new THREE.BoxGeometry(frontFaceW, lowerFrontH, 0.2);
  const motionDrawerHit = new THREE.Mesh(motionDrawerHitGeo, hitMat);
  motionDrawerHit.position.set(0, lowerFrontCenterY, frontFaceZ + 0.05);
  motionDrawerHit.layers.set(1);
  motionDrawerHit.userData.cabinetYear = config.year;
  motionDrawerHit.userData.drawerType = 'motion';
  motionDrawerGroup.add(motionDrawerHit);
  hitMeshes.push(motionDrawerHit);

  const motionSlotGroup = new THREE.Group();
  motionSlotGroup.name = `motion-slot-${config.year}`;
  motionSlotGroup.position.set(0, 0, drawerCenterZ);
  motionDrawerGroup.add(motionSlotGroup);

  disposables.push(
    plaqueTex,
    plaqueMat,
    plaqueBackingGeo,
    plaqueFaceGeo,
    handleBarGeo,
    handlePostGeo,
    drawerHitGeo,
    motionPlaqueTex,
    motionPlaqueMat,
    mPlaqueBackingGeo,
    mPlaqueFaceGeo,
    mHandleBarGeo,
    mHandlePostGeo,
    motionDrawerHitGeo
  );

  return {
    config,
    gridX: gridPose.x,
    gridY: gridPose.y,
    cabinetRoot,
    cabinetShell,
    drawerGroup,
    canistersSlotGroup,
    motionDrawerGroup,
    motionSlotGroup,
    hitMeshes,
    plaqueTex,
    motionPlaqueTex,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

