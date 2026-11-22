import * as THREE from 'three';
import { MotionReel, isSafeMediaUrl } from '../data/archiveData';
import { REEL_DIMS } from './cineReelModel';
import { getBeadBlastedMaps, getBrushedMetalMaps } from './textures';

export const PROJECTOR_DIMS = {
  SCREEN_W: 10.4,
  SCREEN_H: 4.6,
  SCREEN_CENTER_Y: 2.72,
  SCREEN_Z: -3.25,
  CURVE_RADIUS: 18.0,
  PROJECTOR_Z_DESKTOP: 2.05,
  PROJECTOR_Z_PORTRAIT: 2.65,
  PROJECTOR_SCALE_DESKTOP: 0.66,
  PROJECTOR_SCALE_PORTRAIT: 0.62,
} as const;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number,
  focus: { x: number; y: number; scale: number },
  zoomBoost: number,
  panX: number,
  panY: number,
  alpha: number,
  weaveX: number,
  weaveY: number
) {
  if (!img.complete || img.naturalWidth === 0) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const baseScale = Math.max(cw / iw, ch / ih);
  const totalScale = baseScale * focus.scale * zoomBoost;
  const dw = iw * totalScale;
  const dh = ih * totalScale;

  const anchorX = (focus.x - 0.5) * (dw - cw) * 0.55;
  const anchorY = (focus.y - 0.5) * (dh - ch) * 0.55;

  const dx = (cw - dw) * 0.5 - anchorX + panX + weaveX;
  const dy = (ch - dh) * 0.5 - anchorY + panY + weaveY;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Rounded monoblock silhouette in the YZ plane, extruded cleanly along X.
 */
function createRoundedProfileGeometry(
  lengthZ: number,
  heightY: number,
  widthX: number,
  radius: number,
  bevelSize = 0.01,
  bevelThickness = 0.012
): THREE.ExtrudeGeometry {
  const hw = lengthZ / 2;
  const hh = heightY / 2;
  const r = Math.min(radius, hw * 0.48, hh * 0.48);

  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: widthX,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 18,
  });
  geo.translate(0, 0, -widthX / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Tapered vertical spindle pylon extruded along X for centered single-reel support.
 */
function createCenteredPylonGeometry(
  height: number,
  baseLengthZ: number,
  tipRadius: number,
  thicknessX: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const halfBase = baseLengthZ / 2;
  shape.moveTo(-halfBase, 0);
  shape.lineTo(halfBase, 0);
  shape.lineTo(tipRadius, height);
  shape.absarc(0, height, tipRadius, 0, Math.PI, false);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thicknessX,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 3,
    curveSegments: 18,
  });
  geo.translate(0, 0, -thicknessX / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Gently concave curved surface facing +Z for an Apple Vision Pro spatial cinema screen.
 */
function createCurvedScreenGeometry(
  width: number,
  height: number,
  radius: number,
  segW = 48,
  segH = 4
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segW, segH);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const theta = x / radius;
    const curvedX = radius * Math.sin(theta);
    const curvedZ = radius * (1 - Math.cos(theta));
    pos.setX(i, curvedX);
    pos.setZ(i, curvedZ);
  }
  geo.computeVertexNormals();
  return geo;
}

export interface ProjectorPlaybackSnapshot {
  currentTime: number;
  durationSec: number;
  activeKeyframeIdx: number;
  isPlaying: boolean;
}

/**
 * Compact centered single-reel Dieter Rams / Braun-inspired anodized aluminum 16mm projector
 * throwing a luminous optical beam onto a grand Apple Vision Pro-style borderless curved screen
 * with a soft diffused live reflection cast onto the gallery floor.
 */
export class ProjectorStageController {
  public readonly rootGroup = new THREE.Group();
  public readonly projectorGroup = new THREE.Group();
  public readonly screenGroup = new THREE.Group();
  public readonly supplyMount = new THREE.Group();
  public readonly screenHitMesh: THREE.Mesh;

  private floorReflectMesh: THREE.Mesh;
  private beamMesh: THREE.Mesh;
  private beamCoreMesh: THREE.Mesh;
  private beamUniforms: {
    uPower: { value: number };
    uTime: { value: number };
    uMap: { value: THREE.Texture };
  };
  private screenUniforms: {
    uMap: { value: THREE.Texture };
    uPower: { value: number };
  };
  private floorReflectUniforms: {
    uMap: { value: THREE.Texture };
    uPower: { value: number };
  };
  private lensGlowMat: THREE.MeshStandardMaterial;
  private gateGlowMat: THREE.MeshStandardMaterial;
  private statusLedMat: THREE.MeshStandardMaterial;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasTex: THREE.CanvasTexture;
  private videoEl: HTMLVideoElement | null = null;
  private videoTex: THREE.VideoTexture | null = null;
  private imageCache = new Map<string, HTMLImageElement>();

  private activeReel: MotionReel | null = null;
  private isPlaying = false;
  private isMuted = true;
  private currentTime = 0;
  private projectionPower = 0;
  private targetProjectionPower = 0;
  private gateTickAccum = 0;
  private weaveX = 0;
  private weaveY = 0;

  private disposables: { dispose: () => void }[] = [];

  constructor(maxAnisotropy: number) {
    this.rootGroup.name = 'projector-screening-stage';
    this.rootGroup.visible = false;

    const brushed = getBrushedMetalMaps(maxAnisotropy);
    const bead = getBeadBlastedMaps(maxAnisotropy);

    // Match anodized silver + satin charcoal + warm porcelain aesthetic of gallery cabinets
    const anodizedSilverMat = new THREE.MeshPhysicalMaterial({
      color: 0xd9dde2,
      roughness: 0.24,
      metalness: 0.88,
      clearcoat: 0.16,
      clearcoatRoughness: 0.2,
      roughnessMap: brushed.roughnessMap,
      bumpMap: brushed.bumpMap,
      bumpScale: 0.003,
      envMapIntensity: 1.25,
    });

    const brushedDarkMetalMat = new THREE.MeshPhysicalMaterial({
      color: 0x26292e,
      roughness: 0.34,
      metalness: 0.78,
      clearcoat: 0.1,
      roughnessMap: bead.roughnessMap,
      envMapIntensity: 0.9,
    });

    const obsidianBayMat = new THREE.MeshPhysicalMaterial({
      color: 0x181a1e,
      roughness: 0.52,
      metalness: 0.18,
      clearcoat: 0.06,
      roughnessMap: bead.roughnessMap,
      envMapIntensity: 0.55,
    });

    const porcelainAccentMat = new THREE.MeshPhysicalMaterial({
      color: 0xede8df,
      roughness: 0.36,
      metalness: 0.02,
      clearcoat: 0.2,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.75,
    });

    const lensGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xdcebf7,
      roughness: 0.05,
      metalness: 0.05,
      transmission: 0.55,
      ior: 1.52,
      thickness: 0.04,
      clearcoat: 1.0,
      envMapIntensity: 1.6,
    });

    const filmRibbonMat = new THREE.MeshPhysicalMaterial({
      color: 0x8f4c14,
      roughness: 0.32,
      metalness: 0.02,
      transmission: 0.25,
      transparent: true,
      opacity: 0.9,
    });

    this.lensGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfff8ea,
      emissive: new THREE.Color(0xffdfa6),
      emissiveIntensity: 0,
      roughness: 0.15,
    });

    this.gateGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffd79e,
      emissive: new THREE.Color(0xffb866),
      emissiveIntensity: 0,
      roughness: 0.28,
    });

    this.statusLedMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe6,
      emissive: new THREE.Color(0xffdfb0),
      emissiveIntensity: 0,
      roughness: 0.2,
    });

    this.disposables.push(
      anodizedSilverMat,
      brushedDarkMetalMat,
      obsidianBayMat,
      porcelainAccentMat,
      lensGlassMat,
      filmRibbonMat,
      this.lensGlowMat,
      this.gateGlowMat,
      this.statusLedMat
    );

    // =========================================================================
    // 1. COMPACT CENTERED SINGLE-REEL 16MM GALLERY PROJECTOR
    // =========================================================================
    const footGeo = new THREE.CylinderGeometry(0.026, 0.03, 0.024, 20);
    const padGeo = new THREE.CylinderGeometry(0.03, 0.031, 0.008, 20);
    for (const fx of [-0.095, 0.095]) {
      for (const fz of [-0.155, 0.165]) {
        const foot = new THREE.Mesh(footGeo, anodizedSilverMat);
        foot.position.set(fx, 0.02, fz);
        foot.castShadow = true;
        this.projectorGroup.add(foot);

        const pad = new THREE.Mesh(padGeo, obsidianBayMat);
        pad.position.set(fx, 0.004, fz);
        this.projectorGroup.add(pad);
      }
    }

    const bodyCenterY = 0.13;
    const bodyGeo = createRoundedProfileGeometry(0.44, 0.19, 0.27, 0.056, 0.01, 0.012);
    const bodyMesh = new THREE.Mesh(bodyGeo, anodizedSilverMat);
    bodyMesh.position.set(0, bodyCenterY, 0.02);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.projectorGroup.add(bodyMesh);

    const sideTrimGeo = createRoundedProfileGeometry(0.35, 0.125, 0.012, 0.036, 0.003, 0.004);
    const leftTrim = new THREE.Mesh(sideTrimGeo, porcelainAccentMat);
    leftTrim.position.set(-0.144, bodyCenterY, 0.02);
    leftTrim.castShadow = true;
    const rightTrim = new THREE.Mesh(sideTrimGeo, porcelainAccentMat);
    rightTrim.position.set(0.144, bodyCenterY, 0.02);
    rightTrim.castShadow = true;
    this.projectorGroup.add(leftTrim, rightTrim);

    const rearPanelGeo = new THREE.BoxGeometry(0.22, 0.12, 0.014);
    const rearPanel = new THREE.Mesh(rearPanelGeo, obsidianBayMat);
    rearPanel.position.set(0, bodyCenterY, 0.244);
    rearPanel.receiveShadow = true;
    this.projectorGroup.add(rearPanel);

    const dialBaseGeo = new THREE.CylinderGeometry(0.032, 0.034, 0.018, 24);
    dialBaseGeo.rotateX(Math.PI / 2);
    const dialMesh = new THREE.Mesh(dialBaseGeo, anodizedSilverMat);
    dialMesh.position.set(0.064, bodyCenterY, 0.254);
    dialMesh.castShadow = true;
    this.projectorGroup.add(dialMesh);

    const dialCapGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.022, 20);
    dialCapGeo.rotateX(Math.PI / 2);
    const dialCap = new THREE.Mesh(dialCapGeo, brushedDarkMetalMat);
    dialCap.position.set(0.064, bodyCenterY, 0.256);
    this.projectorGroup.add(dialCap);

    const badgeGeo = new THREE.BoxGeometry(0.056, 0.018, 0.006);
    const badgeMesh = new THREE.Mesh(badgeGeo, porcelainAccentMat);
    badgeMesh.position.set(-0.025, bodyCenterY, 0.251);
    this.projectorGroup.add(badgeMesh);

    const ledGeo = new THREE.SphereGeometry(0.007, 12, 12);
    const ledMesh = new THREE.Mesh(ledGeo, this.statusLedMat);
    ledMesh.position.set(-0.082, bodyCenterY, 0.252);
    this.projectorGroup.add(ledMesh);

    const louverPlateGeo = new THREE.BoxGeometry(0.15, 0.008, 0.155);
    const louverPlate = new THREE.Mesh(louverPlateGeo, brushedDarkMetalMat);
    louverPlate.position.set(0, 0.236, -0.085);
    this.projectorGroup.add(louverPlate);

    const louverSlotGeo = new THREE.BoxGeometry(0.128, 0.005, 0.012);
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(louverSlotGeo, obsidianBayMat);
      rib.position.set(0, 0.24, -0.085 + i * 0.027);
      this.projectorGroup.add(rib);
    }

    // Centered Telephoto Projection Lens Assembly (-Z nose)
    const lensY = 0.145;
    const mountCollarGeo = new THREE.CylinderGeometry(0.068, 0.074, 0.04, 32);
    mountCollarGeo.rotateX(Math.PI / 2);
    const mountCollar = new THREE.Mesh(mountCollarGeo, brushedDarkMetalMat);
    mountCollar.position.set(0, lensY, -0.215);
    mountCollar.castShadow = true;
    this.projectorGroup.add(mountCollar);

    const focusBarrelGeo = new THREE.CylinderGeometry(0.052, 0.056, 0.088, 32);
    focusBarrelGeo.rotateX(Math.PI / 2);
    const focusBarrel = new THREE.Mesh(focusBarrelGeo, anodizedSilverMat);
    focusBarrel.position.set(0, lensY, -0.272);
    focusBarrel.castShadow = true;
    this.projectorGroup.add(focusBarrel);

    const knurlRingGeo = new THREE.TorusGeometry(0.055, 0.0055, 10, 32);
    const knurlRing = new THREE.Mesh(knurlRingGeo, brushedDarkMetalMat);
    knurlRing.position.set(0, lensY, -0.28);
    this.projectorGroup.add(knurlRing);

    const hoodGeo = new THREE.CylinderGeometry(0.06, 0.052, 0.032, 32);
    hoodGeo.rotateX(Math.PI / 2);
    const hoodMesh = new THREE.Mesh(hoodGeo, brushedDarkMetalMat);
    hoodMesh.position.set(0, lensY, -0.326);
    hoodMesh.castShadow = true;
    this.projectorGroup.add(hoodMesh);

    const condenserGeo = new THREE.CircleGeometry(0.042, 24);
    condenserGeo.rotateY(Math.PI);
    const condenserMesh = new THREE.Mesh(condenserGeo, this.lensGlowMat);
    condenserMesh.position.set(0, lensY, -0.322);
    this.projectorGroup.add(condenserMesh);

    const glassGeo = new THREE.SphereGeometry(0.044, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.38);
    glassGeo.rotateX(-Math.PI / 2);
    const glassMesh = new THREE.Mesh(glassGeo, lensGlassMat);
    glassMesh.position.set(0, lensY, -0.314);
    this.projectorGroup.add(glassMesh);

    // Single Centered Sculpted Vertical Spindle Pylon
    const supplySpindlePos = new THREE.Vector3(0, 0.585, 0.115);

    const pylonGeo = createCenteredPylonGeometry(0.37, 0.13, 0.044, 0.056);
    const pylonMesh = new THREE.Mesh(pylonGeo, anodizedSilverMat);
    pylonMesh.position.set(0, 0.215, 0.02);
    pylonMesh.castShadow = true;
    pylonMesh.receiveShadow = true;
    this.projectorGroup.add(pylonMesh);

    const spindleHubGeo = new THREE.CylinderGeometry(0.03, 0.034, 0.115, 24);
    spindleHubGeo.rotateX(Math.PI / 2);
    const supplyPost = new THREE.Mesh(spindleHubGeo, brushedDarkMetalMat);
    supplyPost.position.set(0, supplySpindlePos.y, 0.088);
    supplyPost.castShadow = true;
    this.projectorGroup.add(supplyPost);

    const lockCapGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.018, 20);
    lockCapGeo.rotateX(Math.PI / 2);
    const lockCap = new THREE.Mesh(lockCapGeo, anodizedSilverMat);
    lockCap.position.set(0, supplySpindlePos.y, supplySpindlePos.z + REEL_DIMS.TOTAL_THICKNESS * 0.5 + 0.012);
    this.projectorGroup.add(lockCap);

    this.supplyMount.position.copy(supplySpindlePos);
    this.supplyMount.rotation.set(Math.PI / 2, 0, 0);
    this.projectorGroup.add(this.supplyMount);

    const rollerGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.088, 18);
    rollerGeo.rotateZ(Math.PI / 2);
    const upperRoller = new THREE.Mesh(rollerGeo, anodizedSilverMat);
    upperRoller.position.set(0, 0.262, 0.105);
    const lowerRoller = new THREE.Mesh(rollerGeo, anodizedSilverMat);
    lowerRoller.position.set(0, 0.238, 0.025);
    this.projectorGroup.add(upperRoller, lowerRoller);

    const gateWindowGeo = new THREE.BoxGeometry(0.044, 0.016, 0.028);
    const gateWindow = new THREE.Mesh(gateWindowGeo, this.gateGlowMat);
    gateWindow.position.set(0, 0.238, -0.008);
    this.projectorGroup.add(gateWindow);

    const threadCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, supplySpindlePos.y - 0.24, supplySpindlePos.z + 0.015),
      new THREE.Vector3(0, 0.285, 0.115),
      new THREE.Vector3(0, 0.252, 0.085),
      new THREE.Vector3(0, 0.238, 0.008),
    ]);
    const threadGeo = new THREE.TubeGeometry(threadCurve, 22, 0.007, 6, false);
    const threadMesh = new THREE.Mesh(threadGeo, filmRibbonMat);
    this.projectorGroup.add(threadMesh);

    this.disposables.push(
      footGeo,
      padGeo,
      bodyGeo,
      sideTrimGeo,
      rearPanelGeo,
      dialBaseGeo,
      dialCapGeo,
      badgeGeo,
      ledGeo,
      louverPlateGeo,
      louverSlotGeo,
      mountCollarGeo,
      focusBarrelGeo,
      knurlRingGeo,
      hoodGeo,
      condenserGeo,
      glassGeo,
      pylonGeo,
      spindleHubGeo,
      lockCapGeo,
      rollerGeo,
      gateWindowGeo,
      threadGeo
    );

    this.rootGroup.add(this.projectorGroup);

    // =========================================================================
    // 2. GIANT SHARP-EDGED BORDERLESS APPLE VISION CURVED SCREEN + FLOOR REFLECTION
    // =========================================================================
    this.screenGroup.position.set(0, PROJECTOR_DIMS.SCREEN_CENTER_Y, PROJECTOR_DIMS.SCREEN_Z);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 960;
    this.canvas.height = 540;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D context for 3D projector screen');
    }
    this.ctx = ctx;
    this.ctx.fillStyle = '#090A0C';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.canvasTex = new THREE.CanvasTexture(this.canvas);
    this.canvasTex.colorSpace = THREE.SRGBColorSpace;
    this.canvasTex.anisotropy = Math.min(8, maxAnisotropy);
    this.canvasTex.minFilter = THREE.LinearFilter;
    this.canvasTex.magFilter = THREE.LinearFilter;

    this.screenUniforms = {
      uMap: { value: this.canvasTex },
      uPower: { value: 0 },
    };

    const curvedGeo = createCurvedScreenGeometry(
      PROJECTOR_DIMS.SCREEN_W,
      PROJECTOR_DIMS.SCREEN_H,
      PROJECTOR_DIMS.CURVE_RADIUS
    );

    const visionScreenMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: this.screenUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uPower;
        varying vec2 vUv;

        void main() {
          vec3 tex = texture2D(uMap, vUv).rgb;
          vec3 screenCol = tex * (0.14 + 0.90 * uPower);
          float alpha = clamp(0.18 + 0.82 * smoothstep(0.0, 0.35, uPower), 0.0, 1.0);
          gl_FragColor = vec4(screenCol, alpha);
        }
      `,
    });

    const screenMesh = new THREE.Mesh(curvedGeo, visionScreenMat);
    this.screenGroup.add(screenMesh);

    // Layer 1 Hit Proxy for clicking the floating screen to toggle Play/Pause
    const hitProxyGeo = new THREE.PlaneGeometry(
      PROJECTOR_DIMS.SCREEN_W,
      PROJECTOR_DIMS.SCREEN_H
    );
    const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.screenHitMesh = new THREE.Mesh(hitProxyGeo, hitProxyMat);
    this.screenHitMesh.position.z = 0.06;
    this.screenHitMesh.layers.set(1);
    this.screenHitMesh.userData.projectorScreen = true;
    this.screenGroup.add(this.screenHitMesh);

    // Soft, heavily blurred Apple Vision Pro-style live video floor reflection anchored on y = 0.004
    const floorReflectW = PROJECTOR_DIMS.SCREEN_W * 1.18;
    const floorReflectD = 3.5;
    const floorReflectGeo = new THREE.PlaneGeometry(floorReflectW, floorReflectD);
    floorReflectGeo.rotateX(-Math.PI / 2);

    this.floorReflectUniforms = {
      uMap: { value: this.canvasTex },
      uPower: { value: 0 },
    };

    const floorReflectMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.floorReflectUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uPower;
        varying vec2 vUv;

        void main() {
          float distFromScreen = 1.0 - vUv.y;
          float rx = 0.5 + (vUv.x - 0.5) / 1.12;
          float ry = clamp(0.03 + distFromScreen * 0.72, 0.02, 0.96);
          vec2 centerUv = vec2(rx, ry);

          float blur = 0.036 + distFromScreen * 0.065;
          vec3 col = texture2D(uMap, clamp(centerUv, 0.01, 0.99)).rgb * 0.20;

          col += texture2D(uMap, clamp(centerUv + vec2(-blur, 0.0), 0.01, 0.99)).rgb * 0.11;
          col += texture2D(uMap, clamp(centerUv + vec2( blur, 0.0), 0.01, 0.99)).rgb * 0.11;
          col += texture2D(uMap, clamp(centerUv + vec2(0.0, -blur * 0.85), 0.01, 0.99)).rgb * 0.11;
          col += texture2D(uMap, clamp(centerUv + vec2(0.0,  blur * 0.85), 0.01, 0.99)).rgb * 0.11;

          vec2 d1 = vec2(blur * 0.72, blur * 0.65);
          col += texture2D(uMap, clamp(centerUv + vec2(-d1.x, -d1.y), 0.01, 0.99)).rgb * 0.06;
          col += texture2D(uMap, clamp(centerUv + vec2( d1.x, -d1.y), 0.01, 0.99)).rgb * 0.06;
          col += texture2D(uMap, clamp(centerUv + vec2(-d1.x,  d1.y), 0.01, 0.99)).rgb * 0.06;
          col += texture2D(uMap, clamp(centerUv + vec2( d1.x,  d1.y), 0.01, 0.99)).rgb * 0.06;

          vec2 d2 = vec2(blur * 1.65, blur * 1.15);
          col += texture2D(uMap, clamp(centerUv + vec2(-d2.x, 0.0), 0.01, 0.99)).rgb * 0.03;
          col += texture2D(uMap, clamp(centerUv + vec2( d2.x, 0.0), 0.01, 0.99)).rgb * 0.03;
          col += texture2D(uMap, clamp(centerUv + vec2(0.0, -d2.y), 0.01, 0.99)).rgb * 0.03;
          col += texture2D(uMap, clamp(centerUv + vec2(0.0,  d2.y), 0.01, 0.99)).rgb * 0.03;

          float edgeX = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
          float onsetZ = smoothstep(0.0, 0.14, distFromScreen);
          float tailZ = pow(max(0.0, 1.0 - distFromScreen), 2.15);

          float alpha = edgeX * onsetZ * tailZ * 0.16 * uPower;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.floorReflectMesh = new THREE.Mesh(floorReflectGeo, floorReflectMat);
    this.floorReflectMesh.position.set(0, 0.004, PROJECTOR_DIMS.SCREEN_Z + floorReflectD * 0.5 + 0.05);
    this.rootGroup.add(this.floorReflectMesh);

    this.disposables.push(
      curvedGeo,
      visionScreenMat,
      floorReflectGeo,
      floorReflectMat,
      hitProxyGeo,
      hitProxyMat,
      this.canvasTex
    );

    this.rootGroup.add(this.screenGroup);

    // =========================================================================
    // 3. TWO-STAGE LUMINOUS VOLUMETRIC PROJECTOR BEAM CONE (OUTER + INNER CORE)
    //    Clearly readable against the warm bright gallery floor & backdrop,
    //    subtly tinted by live video center colors with gentle atmospheric shimmer.
    // =========================================================================
    const outerBeamGeo = new THREE.CylinderGeometry(0.044, 1.95, 1.0, 40, 1, true);
    const coreBeamGeo = new THREE.CylinderGeometry(0.028, 1.05, 1.0, 32, 1, true);

    this.beamUniforms = {
      uPower: { value: 0 },
      uTime: { value: 0 },
      uMap: { value: this.canvasTex },
    };

    const outerBeamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uniforms: this.beamUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uPower;
        uniform float uTime;
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          float fromLens = 1.0 - vUv.y;
          float axial = smoothstep(0.0, 0.06, fromLens) * pow(max(0.0, 1.0 - fromLens * 0.92), 1.65);
          float rimSoft = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.35);

          // Subtle moving atmospheric dust motes inside beam
          float dustWave = 0.88 + 0.12 * sin(vUv.x * 28.0 + uTime * 1.4) * cos(fromLens * 18.0 - uTime * 2.1);
          float flicker = 0.94 + 0.06 * sin(uTime * 32.0);

          vec3 avgFrame = (
            texture2D(uMap, vec2(0.35, 0.5)).rgb +
            texture2D(uMap, vec2(0.65, 0.5)).rgb +
            texture2D(uMap, vec2(0.5, 0.35)).rgb
          ) / 3.0;
          vec3 beamCol = mix(vec3(1.0, 0.95, 0.84), clamp(avgFrame * 1.35 + 0.38, 0.0, 1.0), 0.32);

          float alpha = axial * rimSoft * 0.24 * uPower * flicker * dustWave;
          gl_FragColor = vec4(beamCol, alpha);
        }
      `,
    });

    const coreBeamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: this.beamUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uPower;
        uniform float uTime;
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          float fromLens = 1.0 - vUv.y;
          float axial = smoothstep(0.0, 0.04, fromLens) * pow(max(0.0, 1.0 - fromLens * 0.88), 2.1);
          float rimSoft = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.7);
          float shimmer = 0.92 + 0.08 * sin(uTime * 24.0 + fromLens * 10.0);

          vec3 centerFrame = texture2D(uMap, vec2(0.5, 0.5)).rgb;
          vec3 coreCol = mix(vec3(1.0, 0.97, 0.88), clamp(centerFrame * 1.2 + 0.55, 0.0, 1.0), 0.25);

          float alpha = axial * rimSoft * 0.32 * uPower * shimmer;
          gl_FragColor = vec4(coreCol, alpha);
        }
      `,
    });

    this.beamMesh = new THREE.Mesh(outerBeamGeo, outerBeamMat);
    this.beamMesh.visible = false;
    this.beamCoreMesh = new THREE.Mesh(coreBeamGeo, coreBeamMat);
    this.beamCoreMesh.visible = false;
    this.rootGroup.add(this.beamMesh, this.beamCoreMesh);
    this.disposables.push(outerBeamGeo, outerBeamMat, coreBeamGeo, coreBeamMat);
  }

  /**
   * Centers the compact projector strictly along x = 0 facing straight -Z,
   * while expanding the curved cinema screen cleanly for desktop or portrait mobile.
   */
  public layoutForViewport(isPortrait: boolean) {
    const pz = isPortrait
      ? PROJECTOR_DIMS.PROJECTOR_Z_PORTRAIT
      : PROJECTOR_DIMS.PROJECTOR_Z_DESKTOP;
    const projScale = isPortrait
      ? PROJECTOR_DIMS.PROJECTOR_SCALE_PORTRAIT
      : PROJECTOR_DIMS.PROJECTOR_SCALE_DESKTOP;

    this.projectorGroup.position.set(0, 0, pz);
    this.projectorGroup.rotation.set(0, 0, 0);
    this.projectorGroup.scale.setScalar(projScale);

    const screenScale = isPortrait ? 0.34 : 1.0;
    this.screenGroup.scale.set(screenScale, screenScale, 1);

    const screenCenterY = isPortrait ? 2.25 : PROJECTOR_DIMS.SCREEN_CENTER_Y;
    this.screenGroup.position.set(0, screenCenterY, PROJECTOR_DIMS.SCREEN_Z);

    this.floorReflectMesh.scale.set(screenScale, 1, isPortrait ? 0.56 : 1.0);
    const reflectDepth = 3.5 * (isPortrait ? 0.56 : 1.0);
    this.floorReflectMesh.position.set(0, 0.004, PROJECTOR_DIMS.SCREEN_Z + reflectDepth * 0.5 + 0.05);

    // Align two-stage volumetric beam cone dead straight from scaled lens objective to screen center
    this.projectorGroup.updateMatrixWorld(true);
    const lensLocal = new THREE.Vector3(0, 0.145, -0.34);
    const lensWorld = lensLocal.applyMatrix4(this.projectorGroup.matrixWorld);
    const beamTarget = new THREE.Vector3(0, screenCenterY, PROJECTOR_DIMS.SCREEN_Z + 0.22);

    const diff = new THREE.Vector3().subVectors(beamTarget, lensWorld);
    const len = diff.length();
    const mid = new THREE.Vector3().addVectors(lensWorld, beamTarget).multiplyScalar(0.5);

    const up = new THREE.Vector3(0, 1, 0);
    const dirToLens = diff.clone().normalize().negate();

    this.beamMesh.position.copy(mid);
    this.beamMesh.scale.set(screenScale, len, screenScale);
    this.beamMesh.quaternion.setFromUnitVectors(up, dirToLens);

    this.beamCoreMesh.position.copy(mid);
    this.beamCoreMesh.scale.set(screenScale, len, screenScale);
    this.beamCoreMesh.quaternion.setFromUnitVectors(up, dirToLens);
  }

  public getSupplyMountWorldPose(): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    this.rootGroup.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    this.supplyMount.getWorldPosition(position);
    this.supplyMount.getWorldQuaternion(quaternion);
    return { position, quaternion };
  }

  public loadReel(reel: MotionReel, startTimeSec = 0) {
    this.activeReel = reel;
    this.currentTime = Math.max(0, Math.min(reel.durationSec, startTimeSec));
    this.isPlaying = true;
    this.targetProjectionPower = 1;
    this.beamMesh.visible = true;
    this.beamCoreMesh.visible = true;

    this.cleanupVideo();

    const loadKeyframesFallback = () => {
      this.screenUniforms.uMap.value = this.canvasTex;
      this.floorReflectUniforms.uMap.value = this.canvasTex;
      this.beamUniforms.uMap.value = this.canvasTex;

      reel.keyframes.forEach((kf) => {
        if (!isSafeMediaUrl(kf.imageUrl)) return;
        if (!this.imageCache.has(kf.imageUrl)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.referrerPolicy = 'no-referrer';
          img.src = kf.imageUrl;
          this.imageCache.set(kf.imageUrl, img);
        }
      });

      this.drawProjectionFrame(0);
    };

    if (reel.videoUrl && isSafeMediaUrl(reel.videoUrl)) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.loop = true;
      video.muted = this.isMuted;
      video.src = reel.videoUrl;
      video.currentTime = this.currentTime;
      video.onerror = () => {
        this.cleanupVideo();
        loadKeyframesFallback();
      };
      void video.play().catch(() => {});

      const vTex = new THREE.VideoTexture(video);
      vTex.colorSpace = THREE.SRGBColorSpace;
      vTex.minFilter = THREE.LinearFilter;
      vTex.magFilter = THREE.LinearFilter;

      this.videoEl = video;
      this.videoTex = vTex;
      this.screenUniforms.uMap.value = vTex;
      this.floorReflectUniforms.uMap.value = vTex;
      this.beamUniforms.uMap.value = vTex;
    } else {
      loadKeyframesFallback();
    }
  }

  public setProjectionActive(active: boolean) {
    this.targetProjectionPower = active ? 1 : 0;
    if (!active) {
      this.isPlaying = false;
      this.videoEl?.pause();
    } else {
      this.beamMesh.visible = true;
      this.beamCoreMesh.visible = true;
    }
  }

  public setPlaying(playing: boolean) {
    this.isPlaying = playing;
    if (this.videoEl) {
      if (playing) {
        void this.videoEl.play().catch(() => {});
      } else {
        this.videoEl.pause();
      }
    }
  }

  public getPlaying(): boolean {
    return this.isPlaying;
  }

  public seekTo(timeSec: number) {
    if (!this.activeReel) return;
    const clamped = Math.max(0, Math.min(this.activeReel.durationSec, timeSec));
    this.currentTime = clamped;
    if (this.videoEl) {
      this.videoEl.currentTime = clamped;
    } else {
      this.drawProjectionFrame(0);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.videoEl) {
      this.videoEl.muted = muted;
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public getSnapshot(): ProjectorPlaybackSnapshot {
    const reel = this.activeReel;
    if (!reel) {
      return { currentTime: 0, durationSec: 1, activeKeyframeIdx: 0, isPlaying: false };
    }
    let activeIdx = 0;
    for (let i = 0; i < reel.keyframes.length; i++) {
      if (this.currentTime >= reel.keyframes[i].timeSec - 0.15) {
        activeIdx = i;
      }
    }
    return {
      currentTime: this.currentTime,
      durationSec: reel.durationSec,
      activeKeyframeIdx: activeIdx,
      isPlaying: this.isPlaying,
    };
  }

  public step(dt: number, mountedReelGroup?: THREE.Object3D | null): ProjectorPlaybackSnapshot {
    const clampedDt = Math.min(dt, 0.05);

    this.projectionPower = THREE.MathUtils.damp(
      this.projectionPower,
      this.targetProjectionPower,
      10,
      clampedDt
    );

    const lampIntensity = this.projectionPower * (this.isPlaying ? 1.0 : 0.54);
    this.beamUniforms.uPower.value = lampIntensity;
    this.beamUniforms.uTime.value += clampedDt;
    const beamVisible = lampIntensity > 0.015;
    this.beamMesh.visible = beamVisible;
    this.beamCoreMesh.visible = beamVisible;
    this.screenUniforms.uPower.value = this.projectionPower;
    this.floorReflectUniforms.uPower.value = this.projectionPower * (this.isPlaying ? 1.0 : 0.65);

    this.lensGlowMat.emissiveIntensity = lampIntensity * 2.4;
    this.gateGlowMat.emissiveIntensity = lampIntensity * 1.5;
    this.statusLedMat.emissiveIntensity = this.projectionPower * 1.5;

    const reel = this.activeReel;
    if (reel) {
      if (this.videoEl) {
        this.currentTime = this.videoEl.currentTime;
      } else {
        if (this.isPlaying && this.projectionPower > 0.25) {
          this.currentTime += clampedDt;
          if (this.currentTime >= reel.durationSec) {
            this.currentTime %= reel.durationSec;
          }
        }
        this.drawProjectionFrame(clampedDt);
      }

      if (this.isPlaying && this.projectionPower > 0.2 && mountedReelGroup) {
        const spinSpeed = reel.fps === 18 ? 1.35 : 1.75;
        mountedReelGroup.rotation.y -= clampedDt * spinSpeed * 0.92;
      }
    }

    return this.getSnapshot();
  }

  private drawProjectionFrame(dt: number) {
    const reel = this.activeReel;
    if (!reel) return;

    this.gateTickAccum += dt;
    const frameStep = 1 / Math.max(12, reel.fps);
    if (this.gateTickAccum >= frameStep) {
      this.gateTickAccum %= frameStep;
      if (this.isPlaying) {
        this.weaveX = (Math.random() - 0.5) * 2.2;
        this.weaveY = (Math.random() - 0.5) * 1.6;
      } else {
        this.weaveX = 0;
        this.weaveY = 0;
      }
    }

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = '#090A0C';
    ctx.fillRect(0, 0, cw, ch);

    const kfs = reel.keyframes;
    if (kfs.length > 0) {
      const t = this.currentTime;
      let segIdx = 0;
      for (let i = 0; i < kfs.length; i++) {
        if (t >= kfs[i].timeSec) {
          segIdx = i;
        }
      }
      const currKf = kfs[segIdx];
      const nextKf = kfs[(segIdx + 1) % kfs.length];
      const segStart = currKf.timeSec;
      const segEnd = segIdx < kfs.length - 1 ? kfs[segIdx + 1].timeSec : reel.durationSec;
      const segSpan = Math.max(0.5, segEnd - segStart);
      const segProgress = Math.max(0, Math.min(1, (t - segStart) / segSpan));

      const imgCurr = this.imageCache.get(currKf.imageUrl);
      const imgNext = this.imageCache.get(nextKf.imageUrl);

      const zoomCurr = 1.02 + segProgress * 0.068;
      const panSign = segIdx % 2 === 0 ? 1 : -1;
      const panCurrX = (segProgress - 0.5) * 28 * panSign;
      const panCurrY = (segProgress - 0.5) * 10;

      const dissolveStart = 0.72;
      const blend =
        segProgress > dissolveStart
          ? smoothstep((segProgress - dissolveStart) / (1 - dissolveStart))
          : 0;

      if (imgCurr) {
        drawCoverImage(
          ctx,
          imgCurr,
          cw,
          ch,
          currKf.cropFocus,
          zoomCurr,
          panCurrX,
          panCurrY,
          1 - blend * 0.85,
          this.weaveX,
          this.weaveY
        );
      }

      if (blend > 0.005 && imgNext) {
        drawCoverImage(
          ctx,
          imgNext,
          cw,
          ch,
          nextKf.cropFocus,
          1.02,
          -14 * panSign,
          -5,
          blend,
          this.weaveX,
          this.weaveY
        );
      }

      const grad = ctx.createRadialGradient(
        cw * 0.5,
        ch * 0.5,
        Math.min(cw, ch) * 0.36,
        cw * 0.5,
        ch * 0.5,
        Math.max(cw, ch) * 0.74
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(6,7,8,0.4)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);

      if (this.isPlaying) {
        ctx.fillStyle = 'rgba(246, 243, 238, 0.065)';
        const now = performance.now();
        for (let s = 0; s < 5; s++) {
          const sx = ((Math.sin((now * 0.037 + s * 91.7) * 12.9898) * 43758.5453) % 1 + 1) % 1;
          const sy = ((Math.cos((now * 0.043 + s * 47.3) * 78.233) * 19341.123) % 1 + 1) % 1;
          ctx.fillRect(sx * cw, sy * ch, 1.5, 1.5);
        }
      }
    }

    this.canvasTex.needsUpdate = true;
  }

  private cleanupVideo() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
    if (this.videoTex) {
      this.videoTex.dispose();
      this.videoTex = null;
    }
  }

  public dispose() {
    this.cleanupVideo();
    this.disposables.forEach((d) => d.dispose());
    this.imageCache.clear();
  }
}
