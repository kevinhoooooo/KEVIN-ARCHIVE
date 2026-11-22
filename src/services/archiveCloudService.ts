import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ARCHIVE_DATA,
  ArchiveYear,
  FilmRoll,
  MOTION_ARCHIVE_DATA,
  MotionKeyframe,
  MotionReel,
  PHOTO_ASSETS,
  PhotoFrame,
  YEAR_CONFIGS,
  YearConfig,
  isSafeMediaUrl,
} from '../data/archiveData';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  OperationType,
  User,
  db,
  handleFirestoreError,
} from '../firebase';

export interface ArchiveCatalog {
  years: YearConfig[];
  rollsByYear: Record<ArchiveYear, FilmRoll[]>;
  reelsByYear: Record<ArchiveYear, MotionReel[]>;
  cloudSeeded: boolean;
}

export interface MediaCheckResult {
  ok: boolean;
  corsOk: boolean;
  detail: string;
}

function clampStr(value: unknown, fallback: string, maxLen: number): string {
  const s = typeof value === 'string' ? value.trim() : fallback;
  return (s || fallback).slice(0, maxLen);
}

function clampOptionalStr(value: unknown, maxLen: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

function clampNum(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeSafeUrl(url: string, fallback = ''): string {
  const trimmed = url.trim().slice(0, 1000);
  return isSafeMediaUrl(trimmed) ? trimmed : fallback;
}

export function getDefaultArchiveCatalog(): ArchiveCatalog {
  const years = YEAR_CONFIGS.map((y, idx) => ({
    ...y,
    sortOrder: idx,
    enabled: true,
  }));
  const rollsByYear: Record<ArchiveYear, FilmRoll[]> = {};
  const reelsByYear: Record<ArchiveYear, MotionReel[]> = {};
  for (const y of years) {
    rollsByYear[y.year] = (ARCHIVE_DATA[y.year] ?? []).map((r) => ({ ...r, enabled: true }));
    reelsByYear[y.year] = (MOTION_ARCHIVE_DATA[y.year] ?? []).map((m) => ({
      ...m,
      enabled: true,
    }));
  }
  return {
    years,
    rollsByYear,
    reelsByYear,
    cloudSeeded: false,
  };
}

export async function checkIsAdminUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  if (user.email === BOOTSTRAP_ADMIN_EMAIL && user.emailVerified) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function fetchPublicArchiveCatalog(): Promise<ArchiveCatalog> {
  const fallback = getDefaultArchiveCatalog();
  try {
    const settingsSnap = await getDoc(doc(db, 'archiveSettings', 'config'));
    if (!settingsSnap.exists() || settingsSnap.data()?.cloudSeeded !== true) {
      return fallback;
    }

    const [yearsSnap, rollsSnap, reelsSnap] = await Promise.all([
      getDocs(query(collection(db, 'years'), where('enabled', '==', true))),
      getDocs(query(collection(db, 'filmRolls'), where('enabled', '==', true))),
      getDocs(query(collection(db, 'motionReels'), where('enabled', '==', true))),
    ]);

    const years: YearConfig[] = yearsSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          year: String(data.year ?? d.id),
          label: String(data.label ?? d.id),
          color: String(data.color ?? '#798B9C'),
          tintHex: Number(data.tintHex ?? 0x798b9c),
          filmStock: String(data.filmStock ?? 'PORTRA 400'),
          iso: Number(data.iso ?? 400),
          seriesTheme: String(data.seriesTheme ?? 'Personal Film Archive'),
          cabinetX: Number(data.cabinetX ?? 0),
          sortOrder: Number(data.sortOrder ?? 0),
          enabled: Boolean(data.enabled),
        };
      })
      .sort((a, b) => Number(b.year) - Number(a.year));

    const enabledYearSet = new Set(years.map((y) => y.year));
    const rollsByYear: Record<ArchiveYear, FilmRoll[]> = {};
    const reelsByYear: Record<ArchiveYear, MotionReel[]> = {};
    for (const y of years) {
      rollsByYear[y.year] = [];
      reelsByYear[y.year] = [];
    }

    for (const d of rollsSnap.docs) {
      const data = d.data();
      const y = String(data.year ?? '');
      if (!enabledYearSet.has(y)) continue;
      const frames: PhotoFrame[] = Array.isArray(data.frames) ? data.frames : [];
      rollsByYear[y].push({
        id: String(data.id ?? d.id),
        year: y,
        rollNumber: Number(data.rollNumber ?? 1),
        rollCode: String(data.rollCode ?? 'ROLL 01'),
        title: String(data.title ?? 'Untitled Roll'),
        description: typeof data.description === 'string' ? data.description : undefined,
        filmStock: String(data.filmStock ?? 'PORTRA 400'),
        iso: Number(data.iso ?? 400),
        location: String(data.location ?? 'Archive'),
        month: String(data.month ?? 'JAN'),
        enabled: true,
        frames,
      });
    }

    for (const d of reelsSnap.docs) {
      const data = d.data();
      const y = String(data.year ?? '');
      if (!enabledYearSet.has(y)) continue;
      const keyframes: MotionKeyframe[] = Array.isArray(data.keyframes) ? data.keyframes : [];
      reelsByYear[y].push({
        id: String(data.id ?? d.id),
        year: y,
        reelNumber: Number(data.reelNumber ?? 1),
        reelCode: String(data.reelCode ?? 'REEL 01'),
        title: String(data.title ?? 'Untitled Reel'),
        filmStock: String(data.filmStock ?? 'VISION3 250D'),
        format: String(data.format ?? '16MM · 24 FPS'),
        fps: Number(data.fps ?? 24),
        durationSec: Number(data.durationSec ?? 24),
        durationLabel: String(data.durationLabel ?? '00:24'),
        camera: String(data.camera ?? 'Bolex H16'),
        lens: String(data.lens ?? 'Switar 26mm'),
        location: String(data.location ?? 'Archive'),
        month: String(data.month ?? 'JAN'),
        notes: String(data.notes ?? ''),
        videoUrl: typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : undefined,
        enabled: true,
        keyframes,
      });
    }

    for (const y of years) {
      rollsByYear[y.year].sort((a, b) => a.rollNumber - b.rollNumber);
      reelsByYear[y.year].sort((a, b) => a.reelNumber - b.reelNumber);
    }

    return {
      years,
      rollsByYear,
      reelsByYear,
      cloudSeeded: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
      handleFirestoreError(err, OperationType.LIST, 'archiveSettings/years/filmRolls/motionReels');
    }
    console.warn('Using bundled static archive fallback:', msg);
    return fallback;
  }
}

export async function fetchAdminArchiveCatalog(): Promise<ArchiveCatalog> {
  try {
    const settingsSnap = await getDoc(doc(db, 'archiveSettings', 'config'));
    const cloudSeeded = settingsSnap.exists() && settingsSnap.data()?.cloudSeeded === true;

    if (!cloudSeeded) {
      return getDefaultArchiveCatalog();
    }

    const [yearsSnap, rollsSnap, reelsSnap] = await Promise.all([
      getDocs(collection(db, 'years')),
      getDocs(collection(db, 'filmRolls')),
      getDocs(collection(db, 'motionReels')),
    ]);

    const years: YearConfig[] = yearsSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          year: String(data.year ?? d.id),
          label: String(data.label ?? d.id),
          color: String(data.color ?? '#798B9C'),
          tintHex: Number(data.tintHex ?? 0x798b9c),
          filmStock: String(data.filmStock ?? 'PORTRA 400'),
          iso: Number(data.iso ?? 400),
          seriesTheme: String(data.seriesTheme ?? 'Personal Film Archive'),
          cabinetX: Number(data.cabinetX ?? 0),
          sortOrder: Number(data.sortOrder ?? 0),
          enabled: data.enabled !== false,
        };
      })
      .sort((a, b) => Number(b.year) - Number(a.year));

    const rollsByYear: Record<ArchiveYear, FilmRoll[]> = {};
    const reelsByYear: Record<ArchiveYear, MotionReel[]> = {};
    for (const y of years) {
      rollsByYear[y.year] = [];
      reelsByYear[y.year] = [];
    }

    for (const d of rollsSnap.docs) {
      const data = d.data();
      const y = String(data.year ?? '');
      if (!rollsByYear[y]) rollsByYear[y] = [];
      rollsByYear[y].push({
        id: String(data.id ?? d.id),
        year: y,
        rollNumber: Number(data.rollNumber ?? 1),
        rollCode: String(data.rollCode ?? 'ROLL 01'),
        title: String(data.title ?? 'Untitled Roll'),
        description: typeof data.description === 'string' ? data.description : undefined,
        filmStock: String(data.filmStock ?? 'PORTRA 400'),
        iso: Number(data.iso ?? 400),
        location: String(data.location ?? 'Archive'),
        month: String(data.month ?? 'JAN'),
        enabled: data.enabled !== false,
        frames: Array.isArray(data.frames) ? data.frames : [],
      });
    }

    for (const d of reelsSnap.docs) {
      const data = d.data();
      const y = String(data.year ?? '');
      if (!reelsByYear[y]) reelsByYear[y] = [];
      reelsByYear[y].push({
        id: String(data.id ?? d.id),
        year: y,
        reelNumber: Number(data.reelNumber ?? 1),
        reelCode: String(data.reelCode ?? 'REEL 01'),
        title: String(data.title ?? 'Untitled Reel'),
        filmStock: String(data.filmStock ?? 'VISION3 250D'),
        format: String(data.format ?? '16MM · 24 FPS'),
        fps: Number(data.fps ?? 24),
        durationSec: Number(data.durationSec ?? 24),
        durationLabel: String(data.durationLabel ?? '00:24'),
        camera: String(data.camera ?? 'Bolex H16'),
        lens: String(data.lens ?? 'Switar 26mm'),
        location: String(data.location ?? 'Archive'),
        month: String(data.month ?? 'JAN'),
        notes: String(data.notes ?? ''),
        videoUrl: typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : undefined,
        enabled: data.enabled !== false,
        keyframes: Array.isArray(data.keyframes) ? data.keyframes : [],
      });
    }

    for (const y of Object.keys(rollsByYear)) {
      rollsByYear[y].sort((a, b) => a.rollNumber - b.rollNumber);
    }
    for (const y of Object.keys(reelsByYear)) {
      reelsByYear[y].sort((a, b) => a.reelNumber - b.reelNumber);
    }

    return { years, rollsByYear, reelsByYear, cloudSeeded: true };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'admin/catalog');
  }
}

export async function seedArchiveToCloud(uid: string): Promise<void> {
  try {
    const defaults = getDefaultArchiveCatalog();
    const ops: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = [];

    defaults.years.forEach((y, idx) => {
      ops.push({
        ref: doc(db, 'years', y.year),
        data: {
          year: y.year,
          label: y.label,
          color: y.color,
          tintHex: y.tintHex,
          filmStock: y.filmStock,
          iso: y.iso,
          seriesTheme: y.seriesTheme,
          cabinetX: y.cabinetX,
          sortOrder: idx,
          enabled: true,
          ownerUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    });

    for (const y of defaults.years) {
      for (const roll of defaults.rollsByYear[y.year] ?? []) {
        const rollPayload: Record<string, unknown> = {
          id: roll.id,
          year: roll.year,
          rollNumber: roll.rollNumber,
          rollCode: roll.rollCode,
          title: roll.title,
          filmStock: roll.filmStock,
          iso: roll.iso,
          location: roll.location,
          month: roll.month,
          enabled: true,
          frames: roll.frames.slice(0, 36),
          ownerUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (roll.description) {
          rollPayload.description = clampOptionalStr(roll.description, 1000);
        }
        ops.push({ ref: doc(db, 'filmRolls', roll.id), data: rollPayload });
      }

      for (const reel of defaults.reelsByYear[y.year] ?? []) {
        const reelPayload: Record<string, unknown> = {
          id: reel.id,
          year: reel.year,
          reelNumber: reel.reelNumber,
          reelCode: reel.reelCode,
          title: reel.title,
          filmStock: reel.filmStock,
          format: reel.format,
          fps: reel.fps,
          durationSec: reel.durationSec,
          durationLabel: reel.durationLabel,
          camera: reel.camera,
          lens: reel.lens,
          location: reel.location,
          month: reel.month,
          notes: clampOptionalStr(reel.notes, 1000),
          enabled: true,
          keyframes: reel.keyframes.slice(0, 12),
          ownerUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (reel.videoUrl) {
          reelPayload.videoUrl = sanitizeSafeUrl(reel.videoUrl);
        }
        ops.push({ ref: doc(db, 'motionReels', reel.id), data: reelPayload });
      }
    }

    ops.push({
      ref: doc(db, 'archiveSettings', 'config'),
      data: {
        cloudSeeded: true,
        archiveTitle: 'KEVIN ARCHIVE',
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      },
    });

    const chunkSize = 40;
    for (let i = 0; i < ops.length; i += chunkSize) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + chunkSize)) {
        batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'archiveSettings/seed');
  }
}

export async function saveYearConfig(
  cfg: YearConfig,
  isNew: boolean,
  uid: string
): Promise<void> {
  const yearId = clampStr(cfg.year, '2026', 4).replace(/[^0-9]/g, '').slice(0, 4);
  if (!/^[0-9]{4}$/.test(yearId)) {
    throw new Error('年份必须是 4 位数字（例如 2027）。');
  }
  const cleanColor = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : '#798B9C';
  const parsedTint = Number.parseInt(cleanColor.slice(1), 16);

  try {
    const ref = doc(db, 'years', yearId);
    if (isNew) {
      await setDoc(ref, {
        year: yearId,
        label: clampStr(cfg.label, yearId, 16),
        color: cleanColor,
        tintHex: Number.isFinite(parsedTint) ? parsedTint : 0x798b9c,
        filmStock: clampStr(cfg.filmStock, 'PORTRA 400', 40),
        iso: clampNum(cfg.iso, 400, 1, 102400),
        seriesTheme: clampStr(cfg.seriesTheme, 'Personal Archive', 120),
        cabinetX: clampNum(cfg.cabinetX, 0, -50, 50),
        sortOrder: clampNum(cfg.sortOrder, 0, 0, 999),
        enabled: cfg.enabled !== false,
        ownerUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        label: clampStr(cfg.label, yearId, 16),
        color: cleanColor,
        tintHex: Number.isFinite(parsedTint) ? parsedTint : 0x798b9c,
        filmStock: clampStr(cfg.filmStock, 'PORTRA 400', 40),
        iso: clampNum(cfg.iso, 400, 1, 102400),
        seriesTheme: clampStr(cfg.seriesTheme, 'Personal Archive', 120),
        cabinetX: clampNum(cfg.cabinetX, 0, -50, 50),
        sortOrder: clampNum(cfg.sortOrder, 0, 0, 999),
        enabled: cfg.enabled !== false,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, `years/${yearId}`);
  }
}

export async function toggleYearEnabled(yearId: string, enabled: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'years', yearId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `years/${yearId}`);
  }
}

export async function deleteYearConfig(yearId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'years', yearId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `years/${yearId}`);
  }
}

export async function saveFilmRoll(
  roll: FilmRoll,
  isNew: boolean,
  uid: string
): Promise<void> {
  const safeId = roll.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128) || `roll-${Date.now()}`;
  const cleanFrames: PhotoFrame[] = roll.frames.slice(0, 36).map((f, idx) => ({
    id: `${safeId}-f${idx + 1}`,
    frameNumber: idx + 1,
    frameCode: clampStr(f.frameCode, `${idx + 1}A`, 12),
    title: clampStr(f.title, `Frame ${idx + 1}`, 120),
    location: clampStr(f.location, roll.location || 'Archive', 120),
    date: clampStr(f.date, `${roll.year}.${roll.month}`, 32),
    camera: clampStr(f.camera, 'Leica M6', 80),
    lens: clampStr(f.lens, '35mm f/2', 80),
    filmStock: clampStr(f.filmStock, roll.filmStock || 'PORTRA 400', 40),
    exposure: clampStr(f.exposure, '1/250s · f/4', 40),
    notes: clampOptionalStr(f.notes, 500) || 'Captured on 35mm film.',
    imageUrl: sanitizeSafeUrl(f.imageUrl, PHOTO_ASSETS.slateArch),
    cropFocus: f.cropFocus ?? { x: 0.5, y: 0.5, scale: 1.0 },
  }));

  const cleanDesc = clampOptionalStr(roll.description, 1000);
  const sharedFields: Record<string, unknown> = {
    year: clampStr(roll.year, '2026', 4),
    rollNumber: clampNum(roll.rollNumber, 1, 1, 999),
    rollCode: clampStr(roll.rollCode, `ROLL ${String(roll.rollNumber || 1).padStart(2, '0')}`, 32),
    title: clampStr(roll.title, 'Untitled Roll', 120),
    filmStock: clampStr(roll.filmStock, 'PORTRA 400', 40),
    iso: clampNum(roll.iso, 400, 1, 102400),
    location: clampStr(roll.location, 'Archive', 120),
    month: clampStr(roll.month, 'JAN', 16),
    enabled: roll.enabled !== false,
    frames: cleanFrames,
    updatedAt: serverTimestamp(),
  };
  if (cleanDesc) {
    sharedFields.description = cleanDesc;
  } else if (!isNew) {
    sharedFields.description = '';
  }

  try {
    const ref = doc(db, 'filmRolls', safeId);
    if (isNew) {
      await setDoc(ref, {
        id: safeId,
        ...sharedFields,
        ownerUid: uid,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, sharedFields);
    }
  } catch (err) {
    handleFirestoreError(
      err,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      `filmRolls/${safeId}`
    );
  }
}

export async function toggleFilmRollEnabled(rollId: string, enabled: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'filmRolls', rollId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `filmRolls/${rollId}`);
  }
}

export async function deleteFilmRoll(rollId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'filmRolls', rollId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `filmRolls/${rollId}`);
  }
}

export async function saveMotionReel(
  reel: MotionReel,
  isNew: boolean,
  uid: string
): Promise<void> {
  const safeId = reel.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128) || `reel-${Date.now()}`;
  const cleanKeyframes: MotionKeyframe[] = reel.keyframes.slice(0, 12).map((kf, idx) => ({
    id: `${safeId}-k${idx + 1}`,
    frameNumber: idx + 1,
    frameCode: clampStr(kf.frameCode, `${String(idx + 1).padStart(2, '0')}M`, 12),
    timeSec: clampNum(kf.timeSec, idx * 4, 0, 7200),
    timecode: clampStr(kf.timecode, '00:00', 16),
    title: clampStr(kf.title, `Scene ${idx + 1}`, 120),
    notes: clampOptionalStr(kf.notes, 500) || clampOptionalStr(reel.notes, 500),
    imageUrl: sanitizeSafeUrl(kf.imageUrl, PHOTO_ASSETS.coastalMist),
    cropFocus: kf.cropFocus ?? { x: 0.5, y: 0.5, scale: 1.0 },
  }));

  const safeVideoUrl = sanitizeSafeUrl(reel.videoUrl ?? '');
  const durationSec = clampNum(reel.durationSec, 24, 1, 7200);
  const mins = Math.floor(durationSec / 60);
  const secs = Math.floor(durationSec % 60);
  const formattedDuration = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const sharedFields: Record<string, unknown> = {
    year: clampStr(reel.year, '2026', 4),
    reelNumber: clampNum(reel.reelNumber, 1, 1, 999),
    reelCode: clampStr(reel.reelCode, `REEL ${String(reel.reelNumber || 1).padStart(2, '0')}`, 32),
    title: clampStr(reel.title, 'Untitled Reel', 120),
    filmStock: clampStr(reel.filmStock, 'VISION3 250D', 40),
    format: clampStr(reel.format, '16MM · 24 FPS', 40),
    fps: clampNum(reel.fps, 24, 1, 120),
    durationSec,
    durationLabel: clampStr(reel.durationLabel, formattedDuration, 16),
    camera: clampStr(reel.camera, 'Bolex H16', 80),
    lens: clampStr(reel.lens, 'Switar 26mm', 80),
    location: clampStr(reel.location, 'Archive', 120),
    month: clampStr(reel.month, 'JAN', 16),
    notes: clampOptionalStr(reel.notes, 1000),
    enabled: reel.enabled !== false,
    keyframes:
      cleanKeyframes.length > 0
        ? cleanKeyframes
        : [
            {
              id: `${safeId}-k1`,
              frameNumber: 1,
              frameCode: '01M',
              timeSec: 0,
              timecode: '00:00',
              title: clampStr(reel.title, 'Opening Frame', 120),
              notes: clampOptionalStr(reel.notes, 500),
              imageUrl: PHOTO_ASSETS.coastalMist,
              cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
            },
          ],
    updatedAt: serverTimestamp(),
  };

  if (safeVideoUrl || !isNew) {
    sharedFields.videoUrl = safeVideoUrl;
  }

  try {
    const ref = doc(db, 'motionReels', safeId);
    if (isNew) {
      await setDoc(ref, {
        id: safeId,
        ...sharedFields,
        ownerUid: uid,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, sharedFields);
    }
  } catch (err) {
    handleFirestoreError(
      err,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      `motionReels/${safeId}`
    );
  }
}

export async function toggleMotionReelEnabled(reelId: string, enabled: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'motionReels', reelId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `motionReels/${reelId}`);
  }
}

export async function deleteMotionReel(reelId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'motionReels', reelId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `motionReels/${reelId}`);
  }
}

export async function testMediaUrlAccess(
  rawUrl: string,
  kind: 'image' | 'video'
): Promise<MediaCheckResult> {
  const url = rawUrl.trim();
  if (!url) {
    return { ok: false, corsOk: false, detail: '请先输入链接地址。' };
  }
  if (!isSafeMediaUrl(url)) {
    return {
      ok: false,
      corsOk: false,
      detail: '链接格式不合法：仅支持 http(s):// 或相对路径，不能包含空格或脚本协议。',
    };
  }

  if (kind === 'image') {
    const corsPassed = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => resolve(false), 8000);
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(false);
      };
      img.src = url;
    });

    if (corsPassed) {
      return {
        ok: true,
        corsOk: true,
        detail: '直链与 3D 跨域均通过（可正常渲染进 3D 底片与全屏大图）。',
      };
    }

    const plainPassed = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => resolve(false), 7000);
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(false);
      };
      img.src = url;
    });

    if (plainPassed) {
      return {
        ok: true,
        corsOk: false,
        detail:
          '图片可访问（全屏看图可用），但服务端未开启跨域头 CORS，3D 底片条可能仅显示暗盒兜底色。建议在极空间反代加上 Access-Control-Allow-Origin: *。',
      };
    }

    return {
      ok: false,
      corsOk: false,
      detail: '无法作为图片加载，请确认填入的是图片直链（非带网页界面的分享链接）且网络可达。',
    };
  }

  // Video URL check
  const videoCorsPassed = await new Promise<boolean>((resolve) => {
    const video = document.createElement('video');
    const timer = window.setTimeout(() => {
      video.removeAttribute('src');
      resolve(false);
    }, 9000);
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      resolve(true);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      resolve(false);
    };
    video.src = url;
  });

  if (videoCorsPassed) {
    return {
      ok: true,
      corsOk: true,
      detail: '视频直链与 3D 跨域均通过（3D 放映机大银幕与全屏影院均可流畅播放）。',
    };
  }

  const videoPlainPassed = await new Promise<boolean>((resolve) => {
    const video = document.createElement('video');
    const timer = window.setTimeout(() => {
      video.removeAttribute('src');
      resolve(false);
    }, 8000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      resolve(true);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      resolve(false);
    };
    video.src = url;
  });

  if (videoPlainPassed) {
    return {
      ok: true,
      corsOk: false,
      detail:
        '视频可播（全屏观看可用），但未开启 CORS 跨域头，3D 银幕贴图会受浏览器限制。建议反代添加 Access-Control-Allow-Origin: *。',
    };
  }

  return {
    ok: false,
    corsOk: false,
    detail: '无法解析视频流，请确认是 .mp4 (H.264/AAC) 直链而非极空间分享网页地址。',
  };
}
