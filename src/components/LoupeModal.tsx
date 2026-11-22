import { TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { FilmRoll, MotionReel, YEAR_MAP } from '../data/archiveData';

interface LoupeModalProps {
  roll: FilmRoll | null;
  frameIndex: number | null;
  motionReel: MotionReel | null;
  keyframeIndex: number | null;
  initialFullscreen?: boolean;
  initialTimeSec?: number;
  onSyncTimeSec?: (timeSec: number) => void;
  onClose: () => void;
  onSelectFrame: (index: number) => void;
  onSelectKeyframe?: (index: number) => void;
  onReturnToDrawer: () => void;
}

function formatTimecode(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

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

export function LoupeModal({
  roll,
  frameIndex,
  motionReel,
  keyframeIndex,
  initialFullscreen = false,
  initialTimeSec,
  onSyncTimeSec,
  onClose,
  onSelectFrame,
  onSelectKeyframe,
  onReturnToDrawer,
}: LoupeModalProps) {
  const [imgError, setImgError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Motion projector playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);

  isPlayingRef.current = isPlaying;
  currentTimeRef.current = currentTime;

  const isStills = roll !== null && frameIndex !== null;
  const isMotion = motionReel !== null && keyframeIndex !== null;
  const isOpen = isStills || isMotion;

  const frame = isStills && roll && frameIndex !== null ? roll.frames[frameIndex] : null;
  const activeKeyframeIdx =
    isMotion && motionReel
      ? (() => {
          let found = 0;
          for (let i = 0; i < motionReel.keyframes.length; i++) {
            if (currentTime >= motionReel.keyframes[i].timeSec - 0.15) {
              found = i;
            }
          }
          return found;
        })()
      : 0;
  const activeKeyframe =
    isMotion && motionReel
      ? motionReel.keyframes[activeKeyframeIdx] ?? motionReel.keyframes[0]
      : null;

  useEffect(() => {
    setImgError(false);
  }, [frame?.id]);

  // Sync initial fullscreen mode whenever modal opens or mode/target switches
  useEffect(() => {
    if (isOpen) {
      setIsFullscreen(initialFullscreen);
    }
  }, [isOpen, initialFullscreen, roll?.id, motionReel?.id]);

  // Reset projector time & load reel images when opening or switching motion reels
  useEffect(() => {
    if (!isMotion || !motionReel || keyframeIndex === null) return;
    const startSec =
      typeof initialTimeSec === 'number'
        ? initialTimeSec
        : motionReel.keyframes[keyframeIndex]?.timeSec ?? 0;
    setCurrentTime(startSec);
    currentTimeRef.current = startSec;
    setIsPlaying(true);

    if (videoRef.current) {
      videoRef.current.currentTime = startSec;
    }

    const cache = imageCacheRef.current;
    motionReel.keyframes.forEach((kf) => {
      if (!cache.has(kf.imageUrl)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.src = kf.imageUrl;
        cache.set(kf.imageUrl, img);
      }
    });
  }, [isMotion, motionReel?.id]);

  // Sync seek when external keyframeIndex changes while already open
  useEffect(() => {
    if (!isMotion || !motionReel || keyframeIndex === null) return;
    if (typeof initialTimeSec === 'number') return;
    const targetSec = motionReel.keyframes[keyframeIndex]?.timeSec;
    if (typeof targetSec === 'number' && Math.abs(currentTimeRef.current - targetSec) > 0.75) {
      setCurrentTime(targetSec);
      currentTimeRef.current = targetSec;
      if (videoRef.current) {
        videoRef.current.currentTime = targetSec;
      }
    }
  }, [isMotion, motionReel, keyframeIndex, initialTimeSec]);

  // Clean up subtle projector audio context when modal closes or unmounts
  useEffect(() => {
    if (!isOpen || !isMotion || isMuted || !isPlaying) {
      if (audioGainRef.current && audioCtxRef.current) {
        audioGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
      }
      return;
    }

    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioCtxRef.current) {
        const ctx = new AudioCtor();
        const bufferSize = ctx.sampleRate * 2;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          const pulse = i % Math.floor(ctx.sampleRate / 24) < 90 ? 0.22 : 0.04;
          data[i] = (Math.random() * 2 - 1) * pulse;
        }
        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 380;

        const gain = ctx.createGain();
        gain.gain.value = 0.045;

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();

        audioCtxRef.current = ctx;
        audioGainRef.current = gain;
      } else {
        if (audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume();
        }
        audioGainRef.current?.gain.setTargetAtTime(0.045, audioCtxRef.current.currentTime, 0.08);
      }
    } catch {
      // Ignore Web Audio restrictions cleanly
    }
  }, [isOpen, isMotion, isMuted, isPlaying]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
        audioGainRef.current = null;
      }
    };
  }, []);

  // HTML5 Canvas 24fps / 18fps Film Projector Simulation Loop (when no external videoUrl)
  useEffect(() => {
    if (!isMotion || !motionReel || motionReel.videoUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTs = performance.now();
    let gateTickAccum = 0;
    let weaveX = 0;
    let weaveY = 0;

    const renderFrame = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      if (isPlayingRef.current) {
        let next = currentTimeRef.current + dt;
        if (next >= motionReel.durationSec) {
          next = 0;
        }
        currentTimeRef.current = next;
        setCurrentTime(next);
      }

      gateTickAccum += dt;
      const frameStep = 1 / Math.max(12, motionReel.fps);
      if (gateTickAccum >= frameStep) {
        gateTickAccum %= frameStep;
        if (isPlayingRef.current) {
          weaveX = (Math.random() - 0.5) * 1.4;
          weaveY = (Math.random() - 0.5) * 1.1;
        } else {
          weaveX = 0;
          weaveY = 0;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(320, Math.round(rect.width * dpr));
      const targetH = Math.max(180, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const cw = canvas.width;
      const ch = canvas.height;
      ctx.fillStyle = '#090A0C';
      ctx.fillRect(0, 0, cw, ch);

      const kfs = motionReel.keyframes;
      if (kfs.length > 0) {
        const t = currentTimeRef.current;
        let segIdx = 0;
        for (let i = 0; i < kfs.length; i++) {
          if (t >= kfs[i].timeSec) {
            segIdx = i;
          }
        }
        const currKf = kfs[segIdx];
        const nextKf = kfs[(segIdx + 1) % kfs.length];
        const segStart = currKf.timeSec;
        const segEnd =
          segIdx < kfs.length - 1 ? kfs[segIdx + 1].timeSec : motionReel.durationSec;
        const segSpan = Math.max(0.5, segEnd - segStart);
        const segProgress = Math.max(0, Math.min(1, (t - segStart) / segSpan));

        const imgCurr = imageCacheRef.current.get(currKf.imageUrl);
        const imgNext = imageCacheRef.current.get(nextKf.imageUrl);

        const zoomCurr = 1.02 + segProgress * 0.065;
        const panSign = segIdx % 2 === 0 ? 1 : -1;
        const panCurrX = (segProgress - 0.5) * 18 * panSign * dpr;
        const panCurrY = (segProgress - 0.5) * 7 * dpr;

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
            weaveX * dpr,
            weaveY * dpr
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
            -9 * panSign * dpr,
            -3 * dpr,
            blend,
            weaveX * dpr,
            weaveY * dpr
          );
        }

        const grad = ctx.createRadialGradient(
          cw * 0.5,
          ch * 0.5,
          Math.min(cw, ch) * 0.34,
          cw * 0.5,
          ch * 0.5,
          Math.max(cw, ch) * 0.74
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(6,7,8,0.42)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);

        if (isPlayingRef.current) {
          ctx.fillStyle = 'rgba(246, 243, 238, 0.06)';
          const specks = 6;
          for (let s = 0; s < specks; s++) {
            const sx = ((Math.sin((now * 0.037 + s * 91.7) * 12.9898) * 43758.5453) % 1 + 1) % 1;
            const sy = ((Math.cos((now * 0.043 + s * 47.3) * 78.233) * 19341.123) % 1 + 1) % 1;
            ctx.fillRect(sx * cw, sy * ch, 1.4 * dpr, 1.4 * dpr);
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isMotion, motionReel, isFullscreen]);

  const handleCloseWithSync = useCallback(() => {
    if (isMotion) {
      onSyncTimeSec?.(currentTimeRef.current);
    }
    onClose();
  }, [isMotion, onClose, onSyncTimeSec]);

  const handleSeekReel = useCallback(
    (nextTime: number) => {
      if (!motionReel) return;
      const clamped = Math.max(0, Math.min(motionReel.durationSec, nextTime));
      setCurrentTime(clamped);
      currentTimeRef.current = clamped;
      if (videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
    },
    [motionReel]
  );

  const handleSelectKeyframeIndex = useCallback(
    (idx: number) => {
      if (!motionReel) return;
      const clampedIdx = (idx + motionReel.keyframes.length) % motionReel.keyframes.length;
      const targetSec = motionReel.keyframes[clampedIdx]?.timeSec ?? 0;
      handleSeekReel(targetSec);
      onSelectKeyframe?.(clampedIdx);
    },
    [motionReel, handleSeekReel, onSelectKeyframe]
  );

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      if (videoRef.current) {
        if (next) {
          void videoRef.current.play();
        } else {
          videoRef.current.pause();
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseWithSync();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setIsFullscreen((v) => !v);
      } else if (isStills && roll && frameIndex !== null) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onSelectFrame((frameIndex - 1 + roll.frames.length) % roll.frames.length);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSelectFrame((frameIndex + 1) % roll.frames.length);
        }
      } else if (isMotion && motionReel) {
        if (e.key === ' ') {
          e.preventDefault();
          togglePlayPause();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleSelectKeyframeIndex(activeKeyframeIdx - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleSelectKeyframeIndex(activeKeyframeIdx + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    isOpen,
    isStills,
    isMotion,
    roll,
    frameIndex,
    motionReel,
    activeKeyframeIdx,
    handleCloseWithSync,
    onSelectFrame,
    togglePlayPause,
    handleSelectKeyframeIndex,
  ]);

  if (!isOpen) return null;

  // =========================================================================
  // 1. MOTION REEL SCREENING MODE (FULLSCREEN CINEMA + NOTES SPLIT)
  // =========================================================================
  if (isMotion && motionReel && activeKeyframe) {
    const yearCfg = YEAR_MAP[motionReel.year];

    const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
      const t = e.touches[0];
      if (t) {
        touchStartRef.current = { x: t.clientX, y: t.clientY };
      }
    };

    const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (dx < 0) {
          handleSelectKeyframeIndex(activeKeyframeIdx + 1);
        } else {
          handleSelectKeyframeIndex(activeKeyframeIdx - 1);
        }
      }
    };

    if (isFullscreen) {
      return (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fullscreen screening: ${motionReel.title}`}
          className="fixed inset-0 z-50 bg-[#050507] text-[#F6F3EE] overflow-hidden select-none"
        >
          {/* Fullscreen Cinema Media Stage */}
          <div
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center cursor-pointer touch-pan-y"
          >
            {motionReel.videoUrl ? (
              <video
                ref={videoRef}
                src={motionReel.videoUrl}
                playsInline
                autoPlay
                loop
                muted={isMuted}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="w-full h-full object-contain bg-[#050507]"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  aria-label={`Fullscreen 16mm screening of ${motionReel.title}`}
                  className="w-full h-full max-w-[177.78vh] max-h-[56.25vw] block"
                />
              </div>
            )}

            {!isPlaying && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="w-14 h-14 flex items-center justify-center bg-black/70 border border-white/25 text-white">
                  <Play className="w-6 h-6 translate-x-0.5" />
                </span>
              </div>
            )}
          </div>

          {/* Top Floating Cinema Controls */}
          <div className="pointer-events-none fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-4 sm:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-8 bg-gradient-to-b from-black/70 via-black/25 to-transparent">
            <div className="pointer-events-auto flex items-center gap-2.5 text-xs font-mono-tabular text-white/80">
              <span
                className="inline-block w-1.5 h-4 shrink-0"
                style={{ backgroundColor: yearCfg.color }}
                aria-hidden="true"
              />
              <span>{motionReel.year}</span>
              <span aria-hidden="true">/</span>
              <span>{motionReel.reelCode}</span>
              <span aria-hidden="true">·</span>
              <span className="hidden sm:inline">{motionReel.format}</span>
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-white/85 hover:text-white bg-black/55 hover:bg-black/80 border border-white/15 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Archival Notes</span>
                <span className="sm:hidden">Notes</span>
              </button>
              <button
                type="button"
                onClick={handleCloseWithSync}
                aria-label="Exit fullscreen video"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-[#F6F3EE] bg-black/60 hover:bg-black/85 border border-white/20 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit</span>
              </button>
            </div>
          </div>

          {/* Bottom Scrim Metadata + Cinema Scrubber */}
          <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-10 px-4 sm:px-8 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/88 via-black/45 to-transparent">
            <div className="pointer-events-auto flex flex-col gap-3 max-w-6xl mx-auto">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-light text-[#F6F3EE] tracking-tight truncate">
                    {motionReel.title}
                  </h2>
                  <p className="text-[11px] sm:text-xs font-mono-tabular text-white/70 mt-0.5 truncate">
                    {motionReel.filmStock} · {motionReel.camera} · {motionReel.fps}fps ·{' '}
                    {activeKeyframe.frameCode} {activeKeyframe.title}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
                  {motionReel.keyframes.map((kf, idx) => {
                    const active = idx === activeKeyframeIdx;
                    return (
                      <button
                        key={kf.id}
                        type="button"
                        onClick={() => handleSelectKeyframeIndex(idx)}
                        className={`px-2.5 py-1 text-[11px] font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#F6F3EE] text-[#222426]'
                            : 'bg-white/10 text-white/75 hover:bg-white/20 hover:text-white'
                        }`}
                      >
                        {kf.frameCode}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pause projection' : 'Play projection'}
                  className="w-9 h-9 flex items-center justify-center bg-white/12 hover:bg-white/22 text-[#F6F3EE] transition-colors shrink-0 cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 translate-x-0.5" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={motionReel.durationSec}
                  step={0.05}
                  value={Math.min(motionReel.durationSec, currentTime)}
                  onChange={(e) => handleSeekReel(parseFloat(e.target.value))}
                  aria-label="Seek motion reel timecode"
                  className="flex-1 h-[2px] accent-[#F6F3EE] bg-white/25 cursor-pointer"
                />

                <span className="text-xs font-mono-tabular text-white/85 whitespace-nowrap shrink-0">
                  {formatTimecode(currentTime)} / {motionReel.durationLabel}
                </span>

                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  aria-label={isMuted ? 'Unmute projector audio' : 'Mute projector audio'}
                  className="w-9 h-9 flex items-center justify-center text-white/80 hover:text-white bg-white/10 hover:bg-white/20 transition-colors shrink-0 cursor-pointer"
                >
                  {isMuted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${motionReel.title} — ${motionReel.reelCode}`}
        className="fixed inset-0 z-50 flex flex-col justify-between bg-[#141517]/96 text-[#F6F3EE] px-4 sm:px-6 md:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* Top Screening Bar */}
        <div className="flex items-center justify-between gap-3 sm:gap-4 border-b border-white/10 pb-3 sm:pb-4 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <span
              className="inline-block w-2 sm:w-2.5 h-5 shrink-0"
              style={{ backgroundColor: yearCfg.color }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-[#A3A7AC] font-mono-tabular truncate">
                <span>{motionReel.year}</span>
                <span aria-hidden="true">/</span>
                <span>{motionReel.reelCode}</span>
                <span aria-hidden="true">·</span>
                <span>{motionReel.format}</span>
                <span className="hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="hidden sm:inline">{motionReel.filmStock}</span>
              </div>
              <h2 className="text-sm sm:text-base md:text-lg font-light tracking-tight text-[#F6F3EE] truncate">
                {motionReel.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              aria-label="Enter fullscreen video screening"
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-normal text-[#F6F3EE] bg-white/10 hover:bg-white/20 border border-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fullscreen</span>
            </button>
            <button
              type="button"
              onClick={() => {
                handleCloseWithSync();
                onReturnToDrawer();
              }}
              className="px-3 sm:px-4 py-2 text-xs font-normal tracking-wide text-[#D8D3CA] border border-white/15 hover:border-white/40 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            >
              <span className="sm:hidden">Return</span>
              <span className="hidden sm:inline">Return Reel to Drawer</span>
            </button>
            <button
              type="button"
              onClick={handleCloseWithSync}
              aria-label="Close motion screening viewer"
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-normal text-[#F6F3EE] bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Main Screening Stage + Editorial Metadata */}
        <div className="flex-1 flex flex-col lg:flex-row items-center lg:justify-center gap-5 sm:gap-8 lg:gap-12 py-4 sm:py-6 min-h-0 overflow-y-auto lg:overflow-hidden no-scrollbar">
          <div className="flex flex-col w-full max-w-4xl shrink-0 lg:shrink bg-[#090A0C] border border-white/10">
            <div
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onClick={togglePlayPause}
              className="relative flex items-center justify-center w-full h-[38vh] sm:h-[48vh] lg:h-[56vh] overflow-hidden cursor-pointer touch-pan-y"
            >
              {motionReel.videoUrl ? (
                <video
                  ref={videoRef}
                  src={motionReel.videoUrl}
                  playsInline
                  autoPlay
                  loop
                  muted={isMuted}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  className="w-full h-full object-contain bg-[#090A0C]"
                />
              ) : (
                <canvas
                  ref={canvasRef}
                  aria-label={`16mm screening projection of ${motionReel.title}`}
                  className="w-full h-full block"
                />
              )}

              <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 text-[11px] font-mono-tabular text-white/75 bg-black/45 px-2 py-1">
                <Film className="w-3 h-3" />
                <span>
                  {activeKeyframe.frameCode} · {activeKeyframe.title}
                </span>
              </div>

              {!isPlaying && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                  <span className="w-12 h-12 flex items-center justify-center bg-black/70 border border-white/25 text-white">
                    <Play className="w-5 h-5 translate-x-0.5" />
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 sm:gap-4 px-3.5 sm:px-4 py-2.5 bg-[#0E1012] border-t border-white/10">
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? 'Pause projection' : 'Play projection'}
                className="w-9 h-9 flex items-center justify-center bg-white/8 hover:bg-white/16 text-[#F6F3EE] transition-colors shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
              >
                {isPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 translate-x-0.5" />
                )}
              </button>

              <input
                type="range"
                min={0}
                max={motionReel.durationSec}
                step={0.05}
                value={Math.min(motionReel.durationSec, currentTime)}
                onChange={(e) => handleSeekReel(parseFloat(e.target.value))}
                aria-label="Seek motion reel timecode"
                className="flex-1 h-[2px] accent-[#F6F3EE] bg-white/20 cursor-pointer"
              />

              <span className="text-xs font-mono-tabular text-[#D8D3CA] whitespace-nowrap shrink-0">
                {formatTimecode(currentTime)} / {motionReel.durationLabel}
              </span>

              <button
                type="button"
                onClick={() => setIsMuted((m) => !m)}
                aria-label={isMuted ? 'Unmute projector audio' : 'Mute projector audio'}
                className="w-9 h-9 flex items-center justify-center text-[#A3A7AC] hover:text-white bg-white/5 hover:bg-white/12 transition-colors shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-4 sm:gap-5 text-left pb-2 lg:pb-0">
            <div className="border-b border-white/10 pb-3 sm:pb-4">
              <p className="text-xs text-[#888C90] font-mono-tabular">
                {motionReel.year} · {motionReel.month} · {motionReel.fps} FPS
              </p>
              <h3 className="text-lg sm:text-xl font-light text-[#F6F3EE] mt-1 tracking-tight">
                {motionReel.title}
              </h3>
              <p className="text-sm font-light text-[#B8BABC] mt-0.5 sm:mt-1">
                {motionReel.location}
              </p>
            </div>

            <p className="text-sm font-light leading-relaxed text-[#D8D3CA]">
              {motionReel.notes}
            </p>

            <dl className="grid grid-cols-2 gap-y-3 gap-x-4 pt-3 sm:pt-4 border-t border-white/10 text-xs">
              <div>
                <dt className="text-[#888C90]">Camera</dt>
                <dd className="text-[#EAE5DC] mt-0.5 font-light">{motionReel.camera}</dd>
              </div>
              <div>
                <dt className="text-[#888C90]">Optics</dt>
                <dd className="text-[#EAE5DC] mt-0.5 font-light">{motionReel.lens}</dd>
              </div>
              <div>
                <dt className="text-[#888C90]">Emulsion</dt>
                <dd className="text-[#EAE5DC] mt-0.5 font-mono-tabular">{motionReel.filmStock}</dd>
              </div>
              <div>
                <dt className="text-[#888C90]">Duration</dt>
                <dd className="text-[#EAE5DC] mt-0.5 font-mono-tabular">
                  {motionReel.durationLabel} · {motionReel.fps}fps
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        {/* Bottom Keyframe Cue Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 border-t border-white/10 pt-3 sm:pt-4 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
            {motionReel.keyframes.map((kf, idx) => {
              const active = idx === activeKeyframeIdx;
              return (
                <button
                  key={kf.id}
                  type="button"
                  onClick={() => handleSelectKeyframeIndex(idx)}
                  className={`px-3 py-1.5 text-xs font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${
                    active
                      ? 'bg-[#F6F3EE] text-[#222426] font-normal'
                      : 'bg-white/5 text-[#A3A7AC] hover:bg-white/15 hover:text-white'
                  }`}
                >
                  {kf.frameCode} · {kf.timecode}
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-[#888C90] font-mono-tabular">
            <button
              type="button"
              onClick={() => handleSelectKeyframeIndex(activeKeyframeIdx - 1)}
              className="hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              Prev Cue
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => handleSelectKeyframeIndex(activeKeyframeIdx + 1)}
              className="hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              Next Cue
            </button>
            <span aria-hidden="true">·</span>
            <span>F Fullscreen · Space Play</span>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. STILLS LOUPE MODE (FULLSCREEN LIGHTBOX + ARCHIVAL LOUPE SHEET)
  // =========================================================================
  if (!isStills || !roll || frameIndex === null || !frame) return null;

  const yearCfg = YEAR_MAP[roll.year];
  const totalFrames = roll.frames.length;

  const handlePrev = () => {
    onSelectFrame((frameIndex - 1 + totalFrames) % totalFrames);
  };

  const handleNext = () => {
    onSelectFrame((frameIndex + 1) % totalFrames);
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (t) {
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    }
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
  };

  if (isFullscreen) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Fullscreen photo: ${roll.title} — ${frame.title}`}
        className="fixed inset-0 z-50 bg-[#050507] text-[#F6F3EE] overflow-hidden select-none"
      >
        {/* Edge-to-Edge Fullscreen Image Stage */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="absolute inset-0 flex items-center justify-center p-3 sm:p-6 md:p-10 touch-pan-y"
        >
          {!imgError ? (
            <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
              <img
                src={frame.imageUrl}
                alt={`${frame.title} — ${frame.location}`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="max-w-full max-h-full object-contain select-none"
                style={{
                  transform: `scale(${frame.cropFocus.scale})`,
                  transformOrigin: `${frame.cropFocus.x * 100}% ${frame.cropFocus.y * 100}%`,
                }}
              />
            </div>
          ) : (
            <div className="w-full max-w-lg h-72 flex flex-col items-center justify-center text-center px-6 bg-[#1C1E20]">
              <p className="text-sm font-light text-[#EAE5DC]">{frame.title}</p>
              <p className="text-xs text-[#888C90] mt-1 font-mono-tabular">
                {frame.location} · {frame.date}
              </p>
            </div>
          )}

          {/* Subtle Side Navigation Arrows */}
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous photo"
            className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center bg-black/45 hover:bg-black/75 text-white/80 hover:text-white border border-white/15 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next photo"
            className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center bg-black/45 hover:bg-black/75 text-white/80 hover:text-white border border-white/15 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Top-Right Fullscreen Controls */}
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-10 flex items-center justify-end gap-2 px-4 sm:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-6 bg-gradient-to-b from-black/60 via-black/20 to-transparent">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-white/85 hover:text-white bg-black/55 hover:bg-black/80 border border-white/15 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Loupe Sheet</span>
            </button>
            <button
              type="button"
              onClick={handleCloseWithSync}
              aria-label="Close fullscreen photo viewer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-[#F6F3EE] bg-black/60 hover:bg-black/85 border border-white/20 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
          </div>
        </div>

        {/* Bottom-Left Film Roll Name + Photo Parameters & Info (with Measured Scrim) */}
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-10 px-5 sm:px-8 md:px-10 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/86 via-black/45 to-transparent">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 max-w-7xl mx-auto">
            <div className="min-w-0 max-w-2xl">
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-block w-1.5 h-4 shrink-0"
                  style={{ backgroundColor: yearCfg.color }}
                  aria-hidden="true"
                />
                <p className="text-sm sm:text-base font-light text-[#F6F3EE] tracking-tight truncate">
                  {roll.title}
                </p>
                <span className="text-[11px] font-mono-tabular text-white/60 whitespace-nowrap shrink-0">
                  {roll.year} · {roll.rollCode} · {frame.frameCode}
                </span>
              </div>

              <p className="text-[11px] sm:text-xs font-mono-tabular text-white/78 mt-1.5 leading-relaxed">
                {frame.title} · {frame.camera} · {frame.lens} · {frame.filmStock} ·{' '}
                {frame.exposure} · {frame.location} · {frame.date}
              </p>

              <p className="text-[11px] sm:text-xs font-light text-white/60 mt-1 line-clamp-2">
                {frame.notes}
              </p>
            </div>

            <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
              {roll.frames.map((f, idx) => {
                const active = idx === frameIndex;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onSelectFrame(idx)}
                    className={`px-2 py-1 text-[11px] font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#F6F3EE] text-[#222426]'
                        : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {f.frameCode}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${roll.title} — Frame ${frame.frameCode}`}
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#141517]/96 text-[#F6F3EE] px-4 sm:px-6 md:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {/* Top Loupe Bar */}
      <div className="flex items-center justify-between gap-3 sm:gap-4 border-b border-white/10 pb-3 sm:pb-4 shrink-0">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <span
            className="inline-block w-2 sm:w-2.5 h-5 shrink-0"
            style={{ backgroundColor: yearCfg.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-[#A3A7AC] font-mono-tabular truncate">
              <span>{roll.year}</span>
              <span aria-hidden="true">/</span>
              <span>{roll.rollCode}</span>
              <span aria-hidden="true">·</span>
              <span>FRAME {frame.frameCode}</span>
              <span className="hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="hidden sm:inline">{roll.filmStock}</span>
            </div>
            <h2 className="text-sm sm:text-base md:text-lg font-light tracking-tight text-[#F6F3EE] truncate">
              {frame.title}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            aria-label="View photo in fullscreen"
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-normal text-[#F6F3EE] bg-white/10 hover:bg-white/20 border border-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Fullscreen</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleCloseWithSync();
              onReturnToDrawer();
            }}
            className="px-3 sm:px-4 py-2 text-xs font-normal tracking-wide text-[#D8D3CA] border border-white/15 hover:border-white/40 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <span className="sm:hidden">Return</span>
            <span className="hidden sm:inline">Return Roll to Drawer</span>
          </button>
          <button
            type="button"
            onClick={handleCloseWithSync}
            aria-label="Close loupe viewer"
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-normal text-[#F6F3EE] bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Main Centered Photographic Plate */}
      <div className="flex-1 flex flex-col lg:flex-row items-center lg:justify-center gap-5 sm:gap-8 lg:gap-12 py-4 sm:py-6 min-h-0 overflow-y-auto lg:overflow-hidden no-scrollbar">
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="relative flex items-center justify-center w-full max-w-4xl h-[42vh] sm:h-[50vh] lg:h-full lg:max-h-[64vh] shrink-0 lg:shrink bg-[#0D0E10] border border-white/10 p-2.5 sm:p-3 md:p-5 touch-pan-y"
        >
          {!imgError ? (
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              aria-label="Expand photo to fullscreen"
              className="relative w-full h-full overflow-hidden flex items-center justify-center cursor-zoom-in focus-visible:outline-2 focus-visible:outline-white"
            >
              <img
                src={frame.imageUrl}
                alt={`${frame.title} — ${frame.location}`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="max-w-full max-h-full object-contain select-none"
                style={{
                  transform: `scale(${frame.cropFocus.scale})`,
                  transformOrigin: `${frame.cropFocus.x * 100}% ${frame.cropFocus.y * 100}%`,
                }}
              />
            </button>
          ) : (
            <div className="w-full h-64 sm:h-72 flex flex-col items-center justify-center text-center px-6 bg-[#1C1E20]">
              <p className="text-sm font-light text-[#EAE5DC]">{frame.title}</p>
              <p className="text-xs text-[#888C90] mt-1 font-mono-tabular">
                {frame.location} · {frame.date}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous frame"
            className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-black/50 hover:bg-black/80 text-white/80 hover:text-white border border-white/15 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next frame"
            className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-black/50 hover:bg-black/80 text-white/80 hover:text-white border border-white/15 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-4 sm:gap-5 text-left pb-2 lg:pb-0">
          <div className="border-b border-white/10 pb-3 sm:pb-4">
            <p className="text-xs text-[#888C90] font-mono-tabular">
              {roll.title} · {frame.date}
            </p>
            <h3 className="text-lg sm:text-xl font-light text-[#F6F3EE] mt-1 tracking-tight">
              {frame.title}
            </h3>
            <p className="text-sm font-light text-[#B8BABC] mt-0.5 sm:mt-1">{frame.location}</p>
          </div>

          <p className="text-sm font-light leading-relaxed text-[#D8D3CA]">{frame.notes}</p>

          <dl className="grid grid-cols-2 gap-y-3 gap-x-4 pt-3 sm:pt-4 border-t border-white/10 text-xs">
            <div>
              <dt className="text-[#888C90]">Camera</dt>
              <dd className="text-[#EAE5DC] mt-0.5 font-light">{frame.camera}</dd>
            </div>
            <div>
              <dt className="text-[#888C90]">Optics</dt>
              <dd className="text-[#EAE5DC] mt-0.5 font-light">{frame.lens}</dd>
            </div>
            <div>
              <dt className="text-[#888C90]">Emulsion</dt>
              <dd className="text-[#EAE5DC] mt-0.5 font-mono-tabular">{frame.filmStock}</dd>
            </div>
            <div>
              <dt className="text-[#888C90]">Exposure</dt>
              <dd className="text-[#EAE5DC] mt-0.5 font-mono-tabular">{frame.exposure}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* Bottom Contact Strip Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 border-t border-white/10 pt-3 sm:pt-4 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
          {roll.frames.map((f, idx) => {
            const active = idx === frameIndex;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectFrame(idx)}
                className={`px-3 py-1.5 text-xs font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${
                  active
                    ? 'bg-[#F6F3EE] text-[#222426] font-normal'
                    : 'bg-white/5 text-[#A3A7AC] hover:bg-white/15 hover:text-white'
                }`}
              >
                {f.frameCode}
              </button>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-[#888C90] font-mono-tabular">
          <button
            type="button"
            onClick={handlePrev}
            className="hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            Prev
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={handleNext}
            className="hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            Next
          </button>
          <span aria-hidden="true">·</span>
          <span>F Fullscreen · Esc Close</span>
        </div>
      </div>
    </div>
  );
}
