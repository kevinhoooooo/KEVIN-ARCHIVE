import * as THREE from 'three';
import { ArchiveYear, PhotoFrame, YEAR_MAP } from '../data/archiveData';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImageCached(url: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(url);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

  imageCache.set(url, promise);
  return promise;
}

export function createCanisterLabelTexture(
  year: ArchiveYear,
  rollNumber: number,
  rollTitle: string,
  filmStock: string,
  frameCount: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const cfg = YEAR_MAP[year];
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Matte archival paper base
  ctx.fillStyle = '#F3EFE7';
  ctx.fillRect(0, 0, width, height);

  // Subtle paper grain
  ctx.fillStyle = 'rgba(34, 36, 38, 0.025)';
  for (let i = 0; i < 900; i++) {
    const x = (i * 197) % width;
    const y = (i * 313) % height;
    ctx.fillRect(x, y, 2, 2);
  }

  // Year desaturated color band (top third + lower hairline)
  ctx.fillStyle = cfg.color;
  ctx.fillRect(0, 0, width, 152);

  // Thin dark charcoal divider rule
  ctx.fillStyle = '#222426';
  ctx.fillRect(0, 152, width, 4);
  ctx.fillRect(0, height - 22, width, 22);

  // Center of +Z face is u = 0.77 on thetaStart=0.58*PI, thetaLength=1.84*PI
  const heroX = Math.round(width * 0.77);

  // Top year band typography at heroX
  ctx.fillStyle = '#F6F3EE';
  ctx.textAlign = 'center';
  ctx.font = '300 22px "DM Sans", sans-serif';
  ctx.fillText('KEVIN ARCHIVE', heroX, 52);

  ctx.font = '500 58px "DM Sans", sans-serif';
  ctx.fillText(`${year}`, heroX, 118);

  // Main paper label typography at heroX
  ctx.fillStyle = '#222426';
  ctx.font = '400 24px "IBM Plex Mono", monospace';
  ctx.fillText(`ROLL ${String(rollNumber).padStart(2, '0')} · ${filmStock}`, heroX, 232);

  ctx.font = '400 34px "DM Sans", sans-serif';
  const truncatedTitle = rollTitle.length > 20 ? rollTitle.slice(0, 19) + '…' : rollTitle;
  ctx.fillText(truncatedTitle, heroX, 294);

  ctx.fillStyle = '#6A6E72';
  ctx.font = '300 20px "IBM Plex Mono", monospace';
  ctx.fillText(`ISO ${cfg.iso} · 35MM · ${String(frameCount).padStart(2, '0')} EXP`, heroX, 348);

  // Minimalist DX coding blocks + specs on back side (u = 0.25)
  const backX = Math.round(width * 0.25);
  ctx.fillStyle = '#F6F3EE';
  ctx.font = '400 26px "IBM Plex Mono", monospace';
  ctx.fillText(`${year} — ${String(rollNumber).padStart(2, '0')}`, backX, 92);

  // DX silver/black contact matrix
  const dxStartX = backX - 96;
  const dxStartY = 204;
  const cellW = 28;
  const cellH = 44;
  const pattern = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 6; c++) {
      const idx = r * 6 + c;
      ctx.fillStyle = pattern[idx] ? '#222426' : '#D9D4CA';
      ctx.fillRect(dxStartX + c * (cellW + 4), dxStartY + r * (cellH + 6), cellW, cellH);
    }
  }

  ctx.fillStyle = '#6A6E72';
  ctx.font = '300 18px "IBM Plex Mono", monospace';
  ctx.fillText('ARCHIVAL CASSETTE · PROCESS C-41', backX, 354);

  // Fine registration tick marks along bottom border
  ctx.fillStyle = '#888C90';
  for (let x = 24; x < width; x += 48) {
    ctx.fillRect(x, height - 38, 2, 12);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createYearPlaqueTexture(
  year: ArchiveYear,
  accentColor: string,
  subtitle: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const width = 512;
  const height = 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Brushed pale warm aluminum plaque
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#E9E5DD');
  grad.addColorStop(0.5, '#F3F0EA');
  grad.addColorStop(1, '#DFDBD2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle horizontal brushed lines
  ctx.strokeStyle = 'rgba(34, 36, 38, 0.03)';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Border hairline
  ctx.strokeStyle = 'rgba(34, 36, 38, 0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  // Left color index bar
  ctx.fillStyle = accentColor;
  ctx.fillRect(16, 22, 10, height - 44);

  // Year text
  ctx.fillStyle = '#222426';
  ctx.textAlign = 'left';
  ctx.font = '400 58px "DM Sans", sans-serif';
  ctx.fillText(year, 46, 86);

  ctx.fillStyle = '#75797E';
  ctx.font = '300 20px "IBM Plex Mono", monospace';
  ctx.fillText(subtitle.toUpperCase(), 48, 124);

  // Roll count on right
  ctx.textAlign = 'right';
  ctx.fillStyle = '#75797E';
  ctx.font = '300 20px "IBM Plex Mono", monospace';
  ctx.fillText('10 ROLLS', width - 28, 78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createMotionPlaqueTexture(
  year: ArchiveYear,
  accentColor: string,
  reelCount: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const width = 512;
  const height = 96;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#E9E5DD');
  grad.addColorStop(0.5, '#F3F0EA');
  grad.addColorStop(1, '#DFDBD2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(34, 36, 38, 0.03)';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(34, 36, 38, 0.16)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  ctx.fillStyle = accentColor;
  ctx.fillRect(14, 16, 8, height - 32);

  // Subtle play glyph + MOTION label
  ctx.fillStyle = '#222426';
  ctx.beginPath();
  ctx.moveTo(36, 34);
  ctx.lineTo(36, 60);
  ctx.lineTo(54, 47);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.font = '500 28px "DM Sans", sans-serif';
  ctx.fillText('MOTION', 68, 57);

  ctx.fillStyle = '#75797E';
  ctx.font = '300 18px "IBM Plex Mono", monospace';
  ctx.fillText(`16MM · ${year}`, 188, 55);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#52565A';
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  ctx.fillText(`${reelCount} REELS`, width - 24, 55);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createCineReelHubTexture(
  year: ArchiveYear,
  reelNumber: number,
  title: string,
  filmStock: string,
  durationLabel: string,
  fps: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const cfg = YEAR_MAP[year];
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#F3EFE7';
  ctx.fillRect(0, 0, size, size);

  // Subtle paper grain
  ctx.fillStyle = 'rgba(34, 36, 38, 0.03)';
  for (let i = 0; i < 600; i++) {
    ctx.fillRect((i * 197) % size, (i * 313) % size, 2, 2);
  }

  // Year color ring arc on upper half of circular hub sticker
  ctx.fillStyle = cfg.color;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#222426';
  ctx.fillRect(0, cy - 3, size, 3);

  // Top half typography
  ctx.fillStyle = '#F6F3EE';
  ctx.textAlign = 'center';
  ctx.font = '400 22px "IBM Plex Mono", monospace';
  ctx.fillText(`${year} · REEL ${String(reelNumber).padStart(2, '0')}`, cx, cy - 118);

  ctx.font = '500 30px "DM Sans", sans-serif';
  const shortTitle = title.length > 16 ? title.slice(0, 15) + '…' : title;
  ctx.fillText(shortTitle, cx, cy - 72);

  // Bottom half typography
  ctx.fillStyle = '#222426';
  ctx.font = '500 22px "IBM Plex Mono", monospace';
  ctx.fillText(`${fps} FPS · ${durationLabel}`, cx, cy + 88);

  ctx.fillStyle = '#6A6E72';
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  ctx.fillText(filmStock, cx, cy + 124);

  // Outer perimeter ring hairline
  ctx.strokeStyle = 'rgba(34, 36, 38, 0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.47, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createDeskSurfaceTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Smooth honed architectural darkroom basalt base (clean satin matte finish, no distracting dots/grid)
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#1B1D21');
  grad.addColorStop(0.5, '#1E2025');
  grad.addColorStop(1, '#191B1F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Ultra-fine subtle satin mineral variation so surface feels tactile rather than flat plastic
  let seed = 9187;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 4200; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const isLight = rand() > 0.5;
    const alpha = 0.014 + rand() * 0.022;
    ctx.fillStyle = isLight ? `rgba(210,216,226,${alpha})` : `rgba(8,9,11,${alpha})`;
    ctx.fillRect(x, y, 2, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export interface MotionFrameStripeMeta {
  fps: number;
  timecode: string;
  durationLabel: string;
}

/**
 * Generates an authentic translucent amber 35mm (dual-perforation) or 16mm cinema
 * (single-perforation + timecode track) film frame texture.
 */
export function createFilmFrameCanvasTexture(
  frame: Pick<PhotoFrame, 'frameNumber' | 'frameCode' | 'filmStock' | 'cropFocus'>,
  yearColor: string,
  maxAnisotropy: number,
  motionMeta?: MotionFrameStripeMeta
): { texture: THREE.CanvasTexture; updateWithImage: (img: HTMLImageElement) => void } {
  const width = 512;
  const height = 384; // 35mm/16mm strip height ratio
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const drawFrame = (img?: HTMLImageElement) => {
    ctx.clearRect(0, 0, width, height);

    // Deeper C-41 honey-amber film base (opaque base so sprocket holes stay cleanly punched at alpha=0)
    ctx.fillStyle = 'rgba(202, 138, 70, 1.0)';
    ctx.fillRect(0, 0, width, height);

    // Subtle acetate cut-edge highlight along top & bottom edges
    ctx.fillStyle = 'rgba(224, 166, 102, 0.42)';
    ctx.fillRect(0, 0, width, 2);
    ctx.fillRect(0, height - 2, width, 2);

    const punchHole = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.restore();
    };

    if (motionMeta) {
      // 16mm / Super 8 cinema strip: single-side perforated top track + optical magnetic stripe at bottom
      const perfCount = 6;
      const perfStep = width / perfCount;
      const perfW = 28;
      const perfH = 34;
      for (let i = 0; i < perfCount; i++) {
        const px = i * perfStep + (perfStep - perfW) / 2;
        punchHole(px, 14, perfW, perfH, 5);
      }

      // Optical audio waveform / magnetic track stripe along bottom track
      ctx.fillStyle = 'rgba(66, 26, 6, 0.9)';
      for (let i = 0; i < 42; i++) {
        const wx = 20 + i * 11;
        const amp = 4 + ((i * 13 + frame.frameNumber * 7) % 14);
        ctx.fillRect(wx, height - 34 - amp / 2, 4, amp);
      }

      ctx.fillStyle = 'rgba(66, 26, 6, 0.94)';
      ctx.font = '500 15px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`CINE ${motionMeta.fps}FPS · ${frame.filmStock}`, 26, 66);

      ctx.textAlign = 'right';
      ctx.fillText(`${motionMeta.timecode} / ${motionMeta.durationLabel}`, width - 56, 66);
      ctx.fillStyle = yearColor;
      ctx.fillRect(width - 44, 55, 20, 8);

      // Subtle bottom timecode stamp + play triangle
      ctx.fillStyle = 'rgba(66, 26, 6, 0.94)';
      ctx.textAlign = 'left';
      ctx.fillText(`▶ KF ${frame.frameCode}`, 26, height - 55);
      ctx.textAlign = 'right';
      ctx.fillText(motionMeta.timecode, width - 26, height - 55);
    } else {
      // Standard 35mm dual-track sprocket holes (8 per frame)
      const perfCount = 8;
      const perfStep = width / perfCount;
      const perfW = 24;
      const perfH = 34;
      const perfRadius = 5;

      for (let i = 0; i < perfCount; i++) {
        const px = i * perfStep + (perfStep - perfW) / 2;
        punchHole(px, 14, perfW, perfH, perfRadius);
        punchHole(px, height - 14 - perfH, perfW, perfH, perfRadius);
      }

      // Dark burnt-brown optical DX barcode strips & sub-frame numbers along top rebate
      ctx.fillStyle = 'rgba(66, 26, 6, 0.94)';
      for (let i = 0; i < 22; i++) {
        const bx = 26 + i * 20;
        const bw = (i * 7) % 3 === 0 ? 8 : 4;
        const bh = i % 2 === 0 ? 11 : 7;
        ctx.fillRect(bx, 54 + (11 - bh), bw, bh);
      }

      // Dark burnt-brown bottom rebate typography (film stock, frame index, half-frame marker)
      ctx.font = '500 15px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`KEVIN ${frame.filmStock}`, 26, height - 55);

      ctx.textAlign = 'center';
      ctx.fillText(`${frame.frameNumber}`, width * 0.56, height - 55);

      ctx.textAlign = 'right';
      ctx.fillText(frame.frameCode, width - 56, height - 55);
      ctx.fillStyle = yearColor;
      ctx.fillRect(width - 44, height - 65, 20, 8);
    }

    // Image window (clean honey-apricot border gap between adjacent frames matching reference strip)
    const winX = 26;
    const winY = 76;
    const winW = width - 52;
    const winH = height - 152;

    // Crisp dark amber-brown inner gate hairline
    ctx.fillStyle = 'rgba(78, 32, 8, 0.85)';
    ctx.fillRect(winX - 1, winY - 1, winW + 2, winH + 2);

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(winX, winY, winW, winH);
      ctx.clip();

      // Draw true-color photograph with curated cropFocus (C-41 negative tone applied dynamically via shader)
      const { x: fx, y: fy, scale } = frame.cropFocus;
      const drawW = winW * scale;
      const drawH = winH * scale;
      const offsetX = winX - (drawW - winW) * fx;
      const offsetY = winY - (drawH - winH) * fy;

      ctx.globalAlpha = 1.0;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(132, 68, 22, 0.96)';
      ctx.fillRect(winX, winY, winW, winH);
    }

    // Subtle glossy film reflection diagonal
    const sheen = ctx.createLinearGradient(winX, winY, winX + winW, winY + winH);
    sheen.addColorStop(0, 'rgba(255, 245, 230, 0.04)');
    sheen.addColorStop(0.45, 'rgba(255, 245, 230, 0.0)');
    sheen.addColorStop(1, 'rgba(255, 245, 230, 0.03)');
    ctx.fillStyle = sheen;
    ctx.fillRect(winX, winY, winW, winH);
  };

  drawFrame();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.needsUpdate = true;

  return {
    texture,
    updateWithImage: (img: HTMLImageElement) => {
      drawFrame(img);
      texture.needsUpdate = true;
    },
  };
}

export function createFilmLeaderTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const width = 256;
  const height = 384;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(202, 138, 70, 1.0)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(224, 166, 102, 0.42)';
  ctx.fillRect(0, 0, width, 2);
  ctx.fillRect(0, height - 2, width, 2);

  // Clean die-cut sprocket holes on leader
  const perfCount = 4;
  const perfStep = width / perfCount;
  const perfW = 24;
  const perfH = 34;
  for (let i = 0; i < perfCount; i++) {
    const px = i * perfStep + (perfStep - perfW) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(px, 14, perfW, perfH, 5);
    ctx.roundRect(px, height - 14 - perfH, perfW, perfH, 5);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(66, 26, 6, 0.94)';
  ctx.font = '500 17px "IBM Plex Mono", monospace';
  ctx.fillText('SAFETY FILM', 22, height / 2 + 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

export interface PbrMapPair {
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export interface VelvetMapSet extends PbrMapPair {
  map: THREE.CanvasTexture;
}

let cachedBeadBlasted: PbrMapPair | null = null;
let cachedBrushedMetal: PbrMapPair | null = null;
let cachedHonedStone: PbrMapPair | null = null;
let cachedSatinPaper: THREE.CanvasTexture | null = null;
let cachedVelvetFlock: VelvetMapSet | null = null;
let cachedFilmAcetate: PbrMapPair | null = null;

/**
 * Fine isotropic bead-blasted anodized aluminum / matte ceramic micro-texture.
 */
export function getBeadBlastedMaps(maxAnisotropy: number): PbrMapPair {
  if (cachedBeadBlasted) return cachedBeadBlasted;

  const size = 256;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  rCtx.fillStyle = '#C8C8C8';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 22000; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const v = rand();
    const rVal = Math.round(145 + v * 105);
    const bVal = Math.round(82 + v * 92);
    rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.fillRect(x, y, 1, 1);
    bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
    bCtx.fillRect(x, y, 1, 1);
  }

  const configure = (c: HTMLCanvasElement, repeatX: number, repeatY: number) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = Math.min(8, maxAnisotropy);
    t.needsUpdate = true;
    return t;
  };

  cachedBeadBlasted = {
    roughnessMap: configure(rCanvas, 6, 6),
    bumpMap: configure(bCanvas, 6, 6),
  };
  return cachedBeadBlasted;
}

/**
 * Precision directional hairline brushed anodized aluminum maps.
 */
export function getBrushedMetalMaps(maxAnisotropy: number): PbrMapPair {
  if (cachedBrushedMetal) return cachedBrushedMetal;

  const size = 256;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  rCtx.fillStyle = '#B8B8B8';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  let seed = 4099;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < size; y++) {
    const streakCount = 6 + Math.floor(rand() * 6);
    for (let s = 0; s < streakCount; s++) {
      const x = Math.floor(rand() * size);
      const len = 32 + Math.floor(rand() * 130);
      const v = rand();
      const rVal = Math.round(95 + v * 148);
      const bVal = Math.round(70 + v * 116);
      rCtx.fillStyle = `rgba(${rVal},${rVal},${rVal},0.58)`;
      rCtx.fillRect(x, y, len, 1);
      if (x + len > size) rCtx.fillRect(0, y, (x + len) % size, 1);
      bCtx.fillStyle = `rgba(${bVal},${bVal},${bVal},0.58)`;
      bCtx.fillRect(x, y, len, 1);
      if (x + len > size) bCtx.fillRect(0, y, (x + len) % size, 1);
    }
  }

  const configure = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.anisotropy = Math.min(8, maxAnisotropy);
    t.needsUpdate = true;
    return t;
  };

  cachedBrushedMetal = {
    roughnessMap: configure(rCanvas),
    bumpMap: configure(bCanvas),
  };
  return cachedBrushedMetal;
}

/**
 * Honed architectural stone / matte composite tabletop maps with subtle satin mineral variation.
 */
export function getHonedStoneMaps(maxAnisotropy: number): PbrMapPair {
  if (cachedHonedStone) return cachedHonedStone;

  const size = 512;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  rCtx.fillStyle = '#B8B8B8';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  let seed = 8821;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Soft cloudy mineral sheen variations
  for (let i = 0; i < 220; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rad = 20 + rand() * 64;
    const v = rand();
    const rVal = Math.round(135 + v * 110);
    const grad = rCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(${rVal},${rVal},${rVal},0.28)`);
    grad.addColorStop(1, `rgba(${rVal},${rVal},${rVal},0)`);
    rCtx.fillStyle = grad;
    rCtx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }

  // Ultra-fine micro-pores for honed stone tactility
  for (let i = 0; i < 9500; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const v = rand();
    const bVal = Math.round(85 + v * 86);
    bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
    bCtx.fillRect(x, y, 1 + (i % 2), 1);
  }

  const configure = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 10);
    t.anisotropy = Math.min(8, maxAnisotropy);
    t.needsUpdate = true;
    return t;
  };

  cachedHonedStone = {
    roughnessMap: configure(rCanvas),
    bumpMap: configure(bCanvas),
  };
  return cachedHonedStone;
}

/**
 * Fine satin archival paper roughness map for canister labels.
 */
export function getSatinPaperRoughnessMap(maxAnisotropy: number): THREE.CanvasTexture {
  if (cachedSatinPaper) return cachedSatinPaper;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#DCDCDC';
  ctx.fillRect(0, 0, size, size);

  let seed = 2719;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const v = Math.round(198 + rand() * 44);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 2, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  cachedSatinPaper = tex;
  return tex;
}

/**
 * Deep obsidian-black flocked velvet lining textures (diffuse nap patches, micro-fiber bump, roughness).
 */
export function getVelvetFlockMaps(maxAnisotropy: number): VelvetMapSet {
  if (cachedVelvetFlock) return cachedVelvetFlock;

  const size = 512;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  // Deep obsidian-charcoal base
  dCtx.fillStyle = '#0D0E11';
  dCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#E6E6E6';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  let seed = 6421;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Organic brushed velvet nap clouds (subtle directionality across plush pile)
  for (let i = 0; i < 160; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rad = 26 + rand() * 68;
    const bright = rand() > 0.48;
    const dGrad = dCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    dGrad.addColorStop(0, bright ? 'rgba(24, 26, 32, 0.26)' : 'rgba(6, 7, 9, 0.30)');
    dGrad.addColorStop(1, 'rgba(13, 14, 17, 0)');
    dCtx.fillStyle = dGrad;
    dCtx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);

    const bVal = bright ? 156 : 98;
    const bGrad = bCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    bGrad.addColorStop(0, `rgba(${bVal},${bVal},${bVal},0.22)`);
    bGrad.addColorStop(1, `rgba(${bVal},${bVal},${bVal},0)`);
    bCtx.fillStyle = bGrad;
    bCtx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }

  // Dense multi-directional flocked micro-fibers for authentic plush velvet grain
  for (let i = 0; i < 24000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const angle = rand() * Math.PI * 2;
    const len = 1.6 + rand() * 2.8;
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    const v = rand();

    const dShade = Math.round(7 + v * 20);
    dCtx.strokeStyle = `rgba(${dShade},${dShade + 1},${dShade + 3},0.65)`;
    dCtx.lineWidth = 0.85;
    dCtx.beginPath();
    dCtx.moveTo(x, y);
    dCtx.lineTo(x + dx, y + dy);
    dCtx.stroke();

    const bShade = Math.round(52 + v * 155);
    bCtx.strokeStyle = `rgba(${bShade},${bShade},${bShade},0.72)`;
    bCtx.lineWidth = 0.9;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x + dx, y + dy);
    bCtx.stroke();

    const rShade = Math.round(206 + v * 46);
    rCtx.fillStyle = `rgb(${rShade},${rShade},${rShade})`;
    rCtx.fillRect(Math.floor(x), Math.floor(y), 2, 2);
  }

  const configure = (c: HTMLCanvasElement, isColor: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3.5, 3.5);
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, maxAnisotropy);
    t.needsUpdate = true;
    return t;
  };

  cachedVelvetFlock = {
    map: configure(dCanvas, true),
    roughnessMap: configure(rCanvas, false),
    bumpMap: configure(bCanvas, false),
  };
  return cachedVelvetFlock;
}

/**
 * Physical 35mm cellulose triacetate film surface maps:
 * - Matte-satin emulsion gate vs. sleek celluloid sprocket border roughness
 * - Subtle horizontal film-transport micro-lines & silver-halide grain
 */
export function getFilmAcetateMaps(maxAnisotropy: number): PbrMapPair {
  if (cachedFilmAcetate) return cachedFilmAcetate;

  const width = 512;
  const height = 384;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = width;
  rCanvas.height = height;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = width;
  bCanvas.height = height;
  const bCtx = bCanvas.getContext('2d')!;

  // Smooth glossy celluloid rebate border vs. slightly denser emulsion window
  rCtx.fillStyle = '#3E3E3E';
  rCtx.fillRect(0, 0, width, height);
  rCtx.fillStyle = '#7A7A7A';
  rCtx.fillRect(20, 74, width - 40, height - 148);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, width, height);
  // Very subtle recessed emulsion gate shelf
  bCtx.fillStyle = '#737373';
  bCtx.fillRect(20, 74, width - 40, height - 148);

  let seed = 9311;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Faint horizontal camera-transport roller micro-lines
  for (let i = 0; i < 240; i++) {
    const y = Math.floor(rand() * height);
    const x = Math.floor(rand() * width * 0.5);
    const len = 80 + Math.floor(rand() * 320);
    const shade = Math.round(108 + rand() * 44);
    bCtx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    bCtx.fillRect(x, y, Math.min(len, width - x), 1);

    const rShade = Math.round(52 + rand() * 58);
    rCtx.fillStyle = `rgba(${rShade},${rShade},${rShade},0.28)`;
    rCtx.fillRect(x, y, Math.min(len, width - x), 1);
  }

  // Ultra-fine silver-halide emulsion micro-grain inside frame gate
  for (let i = 0; i < 12000; i++) {
    const x = 20 + Math.floor(rand() * (width - 40));
    const y = 74 + Math.floor(rand() * (height - 148));
    const v = Math.round(98 + rand() * 58);
    bCtx.fillStyle = `rgb(${v},${v},${v})`;
    bCtx.fillRect(x, y, 1, 1);
  }

  const configure = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = Math.min(8, maxAnisotropy);
    t.needsUpdate = true;
    return t;
  };

  cachedFilmAcetate = {
    roughnessMap: configure(rCanvas),
    bumpMap: configure(bCanvas),
  };
  return cachedFilmAcetate;
}


