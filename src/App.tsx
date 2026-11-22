import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Film,
  Maximize2,
  Pause,
  Play,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ArchiveYear,
  DrawerCategory,
  FilmRoll,
  MotionKeyframe,
  MotionReel,
  PhotoFrame,
  getYearConfig,
  setRuntimeYearMap,
} from './data/archiveData';
import { ArchiveSceneManager, ArchiveViewMode } from './three/ArchiveSceneManager';
import { FILM_STRIP_CONSTANTS } from './three/canisterModel';
import { ProjectorPlaybackSnapshot } from './three/projectorModel';
import { LoupeModal } from './components/LoupeModal';
import { ArchiveIndexDrawer } from './components/ArchiveIndexDrawer';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import {
  ArchiveCatalog,
  fetchPublicArchiveCatalog,
  getDefaultArchiveCatalog,
} from './services/archiveCloudService';

function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneManagerRef = useRef<ArchiveSceneManager | null>(null);
  const cloudSyncedRef = useRef(false);

  const [catalog, setCatalog] = useState<ArchiveCatalog>(() => getDefaultArchiveCatalog());
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.hash === '#/admin'
  );

  const [mode, setMode] = useState<ArchiveViewMode>('overview');
  const [activeYear, setActiveYear] = useState<ArchiveYear | null>(null);
  const [activeCategory, setActiveCategory] = useState<DrawerCategory>('stills');
  const [activeRoll, setActiveRoll] = useState<FilmRoll | null>(null);
  const [activeMotionReel, setActiveMotionReel] = useState<MotionReel | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [hoveredYear, setHoveredYear] = useState<ArchiveYear | null>(null);
  const [hoveredRoll, setHoveredRoll] = useState<FilmRoll | null>(null);
  const [hoveredReel, setHoveredReel] = useState<MotionReel | null>(null);
  const [hoveredFrame, setHoveredFrame] = useState<PhotoFrame | MotionKeyframe | null>(null);

  const [loupeRoll, setLoupeRoll] = useState<FilmRoll | null>(null);
  const [loupeFrameIndex, setLoupeFrameIndex] = useState<number | null>(null);
  const [loupeMotionReel, setLoupeMotionReel] = useState<MotionReel | null>(null);
  const [loupeKeyframeIndex, setLoupeKeyframeIndex] = useState<number | null>(null);
  const [loupeFullscreen, setLoupeFullscreen] = useState(false);
  const [loupeInitialTime, setLoupeInitialTime] = useState<number | undefined>(undefined);

  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [filmScrollOffset, setFilmScrollOffset] = useState(0);
  const [projectorSnap, setProjectorSnap] = useState<ProjectorPlaybackSnapshot>({
    currentTime: 0,
    durationSec: 1,
    activeKeyframeIdx: 0,
    isPlaying: true,
  });
  const [isProjectorMuted, setIsProjectorMuted] = useState(true);
  const [visibleFilmSlots, setVisibleFilmSlots] = useState<number>(() =>
    typeof window !== 'undefined' &&
    window.innerWidth / Math.max(window.innerHeight, 1) < 0.85
      ? FILM_STRIP_CONSTANTS.MOBILE_VISIBLE_SLOTS
      : FILM_STRIP_CONSTANTS.VISIBLE_SLOTS
  );

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const manager = new ArchiveSceneManager(mountEl, {
      onModeChange: (nextMode, year, category, roll, motionReel) => {
        setMode(nextMode);
        setActiveYear(year);
        setActiveCategory(category);
        setActiveRoll(roll);
        setActiveMotionReel(motionReel);
        setFilmScrollOffset(0);
        if (motionReel) {
          setProjectorSnap({
            currentTime: 0,
            durationSec: motionReel.durationSec,
            activeKeyframeIdx: 0,
            isPlaying: true,
          });
        }
      },
      onHoverYearChange: setHoveredYear,
      onHoverRollChange: setHoveredRoll,
      onHoverReelChange: setHoveredReel,
      onHoverFrameChange: setHoveredFrame,
      onOpenFrame: (roll, frameIdx) => {
        setLoupeMotionReel(null);
        setLoupeKeyframeIndex(null);
        setLoupeInitialTime(undefined);
        setLoupeFullscreen(false);
        setLoupeRoll(roll);
        setLoupeFrameIndex(frameIdx);
      },
      onOpenMotionReel: (reel, keyframeIdx) => {
        setLoupeRoll(null);
        setLoupeFrameIndex(null);
        setLoupeInitialTime(undefined);
        setLoupeFullscreen(false);
        setLoupeMotionReel(reel);
        setLoupeKeyframeIndex(keyframeIdx);
      },
      onProjectorProgress: setProjectorSnap,
      onTransitionChange: setIsBusy,
      onFilmScrollChange: setFilmScrollOffset,
      onVisibleSlotsChange: setVisibleFilmSlots,
    });

    sceneManagerRef.current = manager;

    return () => {
      manager.dispose();
      sceneManagerRef.current = null;
    };
  }, []);

  const refreshCatalog = useCallback(async () => {
    const next = await fetchPublicArchiveCatalog();
    setRuntimeYearMap(next.years);
    setCatalog(next);
    if (next.cloudSeeded || cloudSyncedRef.current) {
      cloudSyncedRef.current = next.cloudSeeded;
      sceneManagerRef.current?.updateArchiveData(
        next.years,
        next.rollsByYear,
        next.reelsByYear
      );
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#/admin') {
        setIsAdminOpen(true);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleOpenAdmin = useCallback(() => {
    setIsAdminOpen(true);
    if (window.location.hash !== '#/admin') {
      window.history.replaceState(null, '', '#/admin');
    }
  }, []);

  const handleCloseAdmin = useCallback(() => {
    setIsAdminOpen(false);
    if (window.location.hash === '#/admin') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const { totalRolls, totalReels, newestYear, oldestYear } = useMemo(() => {
    const rSum = catalog.years.reduce(
      (sum, cfg) => sum + (catalog.rollsByYear[cfg.year]?.length ?? 0),
      0
    );
    const mSum = catalog.years.reduce(
      (sum, cfg) => sum + (catalog.reelsByYear[cfg.year]?.length ?? 0),
      0
    );
    return {
      totalRolls: rSum,
      totalReels: mSum,
      newestYear: catalog.years[0]?.year ?? '—',
      oldestYear: catalog.years[catalog.years.length - 1]?.year ?? '—',
    };
  }, [catalog]);

  const handleSelectOverview = useCallback(() => {
    sceneManagerRef.current?.goToOverview();
  }, []);

  const handleSelectYear = useCallback((year: ArchiveYear) => {
    sceneManagerRef.current?.openYearDrawer(year);
  }, []);

  const handleSwitchCategory = useCallback((category: DrawerCategory) => {
    sceneManagerRef.current?.switchCategory(category);
  }, []);

  const handleReturnToDrawer = useCallback(() => {
    sceneManagerRef.current?.returnToDrawer();
  }, []);

  const handleJumpToRoll = useCallback((roll: FilmRoll) => {
    sceneManagerRef.current?.jumpToRoll(roll);
  }, []);

  const handleJumpToMotionReel = useCallback((reel: MotionReel) => {
    sceneManagerRef.current?.jumpToMotionReel(reel);
  }, []);

  const handleOpenFrameFromDock = useCallback(
    (frameIdx: number, fullscreen = false) => {
      if (activeRoll) {
        sceneManagerRef.current?.scrollFilmToFrame(frameIdx);
        setLoupeMotionReel(null);
        setLoupeKeyframeIndex(null);
        setLoupeInitialTime(undefined);
        setLoupeFullscreen(fullscreen);
        setLoupeRoll(activeRoll);
        setLoupeFrameIndex(frameIdx);
      }
    },
    [activeRoll]
  );

  const handleToggleProjectorPlay = useCallback(() => {
    sceneManagerRef.current?.toggleProjectorPlay();
  }, []);

  const handleSeekProjector = useCallback((timeSec: number) => {
    sceneManagerRef.current?.seekProjectorTo(timeSec);
  }, []);

  const handleToggleProjectorMute = useCallback(() => {
    if (!sceneManagerRef.current) return;
    setIsProjectorMuted(sceneManagerRef.current.toggleProjectorMute());
  }, []);

  const handleOpenProjectorModal = useCallback(
    (fullscreen: boolean) => {
      if (!activeMotionReel) return;
      sceneManagerRef.current?.setProjectorPlaying(false);
      setLoupeRoll(null);
      setLoupeFrameIndex(null);
      setLoupeFullscreen(fullscreen);
      setLoupeInitialTime(projectorSnap.currentTime);
      setLoupeMotionReel(activeMotionReel);
      setLoupeKeyframeIndex(projectorSnap.activeKeyframeIdx);
    },
    [activeMotionReel, projectorSnap.activeKeyframeIdx, projectorSnap.currentTime]
  );

  const handleScrollFilm = useCallback((deltaFrames: number) => {
    sceneManagerRef.current?.scrollFilmByFrames(deltaFrames);
  }, []);

  const handleScrubFilm = useCallback((offsetFrames: number) => {
    sceneManagerRef.current?.scrollFilmToOffset(offsetFrames);
  }, []);

  const displayYear = activeYear ?? hoveredYear;
  const displayYearCfg = displayYear ? getYearConfig(displayYear) : null;

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#F6F3EE] text-[#222426] select-none">
      {/* Isolated 3D WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full"
        aria-label="Interactive 3D Film Archive Viewport"
      />

      {/* Strict 3-Zone Editorial Top Bar */}
      <header className="relative z-20 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-6 gap-y-2 px-4 sm:px-6 md:px-10 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 md:py-4 bg-[#F6F3EE]/92 backdrop-blur-sm border-b border-[#222426]/10">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={handleSelectOverview}
          disabled={isBusy}
          className="order-1 text-sm sm:text-base md:text-lg font-light tracking-[0.18em] text-[#222426] whitespace-nowrap shrink-0 cursor-pointer hover:opacity-75 transition-opacity focus-visible:outline-2 focus-visible:outline-[#222426]"
        >
          KEVIN ARCHIVE
        </button>

        {/* Zone 2: Clean Single-Line Year Navigation Links */}
        <nav
          aria-label="Archive years"
          className="order-3 md:order-2 w-full md:w-auto flex items-center justify-between sm:justify-start gap-4 md:gap-5 overflow-x-auto no-scrollbar border-t border-[#222426]/8 md:border-t-0 pt-2 md:pt-0"
        >
          <button
            type="button"
            onClick={handleSelectOverview}
            disabled={isBusy}
            className={`relative py-1.5 text-xs md:text-sm font-light transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#222426] ${
              mode === 'overview'
                ? 'text-[#222426] font-normal'
                : 'text-[#888C90] hover:text-[#222426]'
            }`}
          >
            Overview
            {mode === 'overview' && (
              <span
                className="absolute left-0 right-0 -bottom-0.5 h-[1.5px] bg-[#222426]"
                aria-hidden="true"
              />
            )}
          </button>

          {catalog.years.map((cfg) => {
            const isActive = activeYear === cfg.year;
            return (
              <button
                key={cfg.year}
                type="button"
                onClick={() => handleSelectYear(cfg.year)}
                disabled={isBusy}
                className={`relative py-1.5 px-0.5 text-xs md:text-sm font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#222426] ${
                  isActive
                    ? 'text-[#222426] font-normal'
                    : 'text-[#888C90] hover:text-[#222426]'
                }`}
              >
                {cfg.label}
                {isActive && (
                  <span
                    className="absolute left-0 right-0 -bottom-0.5 h-[2px]"
                    style={{ backgroundColor: cfg.color }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Admin & Archive Index Actions */}
        <div className="order-2 md:order-3 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenAdmin}
            aria-label="Open archive admin dashboard"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-normal tracking-wide text-[#222426] bg-[#F6F3EE] hover:bg-[#EAE5DC] border border-[#222426]/12 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#222426]"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Admin</span>
          </button>
          <button
            type="button"
            onClick={() => setIsIndexOpen(true)}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-normal tracking-wide text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/12 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#222426]"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Archive Index</span>
          </button>
        </div>
      </header>

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[calc(100vw-1.5rem)] sm:w-auto sm:max-w-[94vw]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          aria-expanded={!dockCollapsed}
          aria-label={dockCollapsed ? 'Show archive controls' : 'Hide archive controls'}
          className="mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono-tabular text-[#6A6E72] bg-[#F6F3EE]/94 border border-[#222426]/10 hover:text-[#222426] transition-colors whitespace-nowrap cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Hide</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="w-full sm:w-auto flex flex-wrap md:flex-nowrap items-center justify-between gap-3 md:gap-4 px-3.5 sm:px-5 py-2.5 sm:py-3 bg-[#F6F3EE]/95 backdrop-blur-sm border border-[#222426]/12 shadow-sm sm:min-w-[560px]">
            {/* OVERVIEW DOCK */}
            {mode === 'overview' && (
              <div className="flex items-center justify-between gap-3 sm:gap-6 w-full">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  {displayYearCfg ? (
                    <>
                      <span
                        className="inline-block w-2 h-4 shrink-0"
                        style={{ backgroundColor: displayYearCfg.color }}
                        aria-hidden="true"
                      />
                      <span className="text-xs md:text-sm font-normal text-[#222426] truncate">
                        {displayYearCfg.year} · {displayYearCfg.seriesTheme}
                      </span>
                      <span className="hidden sm:inline text-xs text-[#888C90] font-mono-tabular whitespace-nowrap">
                        {displayYearCfg.filmStock}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs md:text-sm font-light text-[#6A6E72] truncate">
                      <span className="sm:hidden">Tap upper Stills or lower Motion drawer</span>
                      <span className="hidden sm:inline">
                        Click upper Stills or lower Motion drawer · Drag to orbit
                      </span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] sm:text-xs text-[#888C90] font-mono-tabular whitespace-nowrap shrink-0">
                  {totalRolls} Rolls · {totalReels} Reels · {oldestYear}–{newestYear}
                </span>
              </div>
            )}

            {/* DRAWER INSPECTION DOCK (Stills + Motion Dual Drawer) */}
            {mode === 'drawer' && activeYear && (() => {
              const yearRollsCount = catalog.rollsByYear[activeYear]?.length ?? 0;
              const yearReelsCount = catalog.reelsByYear[activeYear]?.length ?? 0;

              return (
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 w-full">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                    <span
                      className="inline-block w-2 h-4 shrink-0"
                      style={{ backgroundColor: getYearConfig(activeYear).color }}
                      aria-hidden="true"
                    />
                    {activeCategory === 'stills' && hoveredRoll ? (
                      <div className="flex items-center gap-2 text-xs md:text-sm truncate">
                        <span className="font-mono-tabular text-[#888C90]">
                          {hoveredRoll.rollCode}
                        </span>
                        <span aria-hidden="true" className="text-[#888C90]">
                          ·
                        </span>
                        <span className="font-normal text-[#222426] truncate">
                          {hoveredRoll.title}
                        </span>
                        <span className="hidden sm:inline text-xs text-[#888C90] truncate">
                          — {hoveredRoll.location}
                        </span>
                      </div>
                    ) : activeCategory === 'motion' && hoveredReel ? (
                      <div className="flex items-center gap-2 text-xs md:text-sm truncate">
                        <Film className="w-3.5 h-3.5 text-[#222426] shrink-0" />
                        <span className="font-mono-tabular text-[#888C90]">
                          {hoveredReel.reelCode}
                        </span>
                        <span aria-hidden="true" className="text-[#888C90]">
                          ·
                        </span>
                        <span className="font-normal text-[#222426] truncate">
                          {hoveredReel.title}
                        </span>
                        <span className="hidden sm:inline text-xs text-[#888C90] font-mono-tabular whitespace-nowrap">
                          {hoveredReel.format} · {hoveredReel.durationLabel}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs md:text-sm font-light text-[#6A6E72] truncate">
                        {activeCategory === 'motion' ? (
                          <>
                            <span className="sm:hidden">{activeYear} Motion · Tap a reel</span>
                            <span className="hidden sm:inline">
                              {activeYear} Motion Drawer · Click a 16mm reel to screen
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="sm:hidden">
                              {activeYear} Stills · Tap a canister
                            </span>
                            <span className="hidden sm:inline">
                              {activeYear} Stills Drawer · Hover canister to inspect, click to
                              unroll
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0">
                    {/* Upper/Lower Drawer Switcher */}
                    <div
                      role="group"
                      aria-label="Drawer layer selector"
                      className="flex items-center border border-[#222426]/15 bg-[#EAE5DC]/70 p-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => handleSwitchCategory('stills')}
                        disabled={isBusy}
                        className={`px-2.5 py-1.5 sm:py-1 text-xs font-mono-tabular transition-colors whitespace-nowrap cursor-pointer ${
                          activeCategory === 'stills'
                            ? 'bg-[#222426] text-[#F6F3EE]'
                            : 'text-[#6A6E72] hover:text-[#222426]'
                        }`}
                      >
                        Stills · {yearRollsCount}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchCategory('motion')}
                        disabled={isBusy}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 sm:py-1 text-xs font-mono-tabular transition-colors whitespace-nowrap cursor-pointer ${
                          activeCategory === 'motion'
                            ? 'bg-[#222426] text-[#F6F3EE]'
                            : 'text-[#6A6E72] hover:text-[#222426]'
                        }`}
                      >
                        <Film className="w-3 h-3" />
                        <span>Motion · {yearReelsCount}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleSelectOverview}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 sm:py-1.5 text-xs font-normal text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/12 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span className="sm:hidden">Close</span>
                      <span className="hidden sm:inline">Close Drawer</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* 3D PROJECTOR SCREENING DOCK (Motion Reel Mounted on Projector) */}
            {mode === 'inspect' && activeMotionReel && (() => {
              const activeCue =
                activeMotionReel.keyframes[projectorSnap.activeKeyframeIdx] ??
                activeMotionReel.keyframes[0];

              return (
                <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 w-full">
                  <div className="flex items-center justify-between gap-3 w-full lg:w-auto min-w-0">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <span
                        className="inline-block w-2 h-5 shrink-0"
                        style={{ backgroundColor: getYearConfig(activeMotionReel.year).color }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-[#888C90] font-mono-tabular">
                          <span>{activeMotionReel.year}</span>
                          <span aria-hidden="true">/</span>
                          <span>{activeMotionReel.reelCode}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{activeMotionReel.format}</span>
                        </div>
                        <p className="text-xs md:text-sm font-normal text-[#222426] truncate">
                          {activeMotionReel.title}
                          {activeCue ? ` · ${activeCue.title}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="lg:hidden flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenProjectorModal(false)}
                        aria-label="Open archival notes"
                        className="p-2 text-[#222426] bg-[#EAE5DC] border border-[#222426]/15 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenProjectorModal(true)}
                        aria-label="Watch video fullscreen"
                        className="p-2 text-[#222426] bg-[#EAE5DC] border border-[#222426]/15 cursor-pointer"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleReturnToDrawer}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-normal text-[#F6F3EE] bg-[#222426] hover:bg-[#383B3E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Return</span>
                      </button>
                    </div>
                  </div>

                  {/* Projector Transport Controls */}
                  <div className="flex items-center gap-2 sm:gap-3 w-full lg:w-auto lg:min-w-[300px] shrink-0">
                    <button
                      type="button"
                      onClick={handleToggleProjectorPlay}
                      aria-label={projectorSnap.isPlaying ? 'Pause projector' : 'Play projector'}
                      className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center bg-[#222426] hover:bg-[#383B3E] text-[#F6F3EE] transition-colors shrink-0 cursor-pointer"
                    >
                      {projectorSnap.isPlaying ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5 translate-x-0.5" />
                      )}
                    </button>

                    <input
                      type="range"
                      min={0}
                      max={activeMotionReel.durationSec}
                      step={0.05}
                      value={Math.min(activeMotionReel.durationSec, projectorSnap.currentTime)}
                      onChange={(e) => handleSeekProjector(parseFloat(e.target.value))}
                      aria-label="Projector reel scrubber"
                      className="flex-1 sm:w-40 accent-[#222426] cursor-pointer h-1.5 bg-[#EAE5DC]"
                    />

                    <span className="text-[11px] font-mono-tabular text-[#6A6E72] whitespace-nowrap shrink-0">
                      {formatTimecode(projectorSnap.currentTime)} / {activeMotionReel.durationLabel}
                    </span>

                    <button
                      type="button"
                      onClick={handleToggleProjectorMute}
                      aria-label={isProjectorMuted ? 'Unmute video' : 'Mute video'}
                      className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/12 transition-colors shrink-0 cursor-pointer"
                    >
                      {isProjectorMuted ? (
                        <VolumeX className="w-3.5 h-3.5" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="hidden lg:flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenProjectorModal(false)}
                      aria-label="Open archival notes"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Notes</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenProjectorModal(true)}
                      aria-label="Watch video fullscreen"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Fullscreen</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleReturnToDrawer}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-normal text-[#F6F3EE] bg-[#222426] hover:bg-[#383B3E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Return Reel</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* STILLS FILM STRIP INSPECTION DOCK */}
            {mode === 'inspect' && activeRoll && (() => {
              const effectiveSlots = Math.min(activeRoll.frames.length, visibleFilmSlots);
              const isLongStrip = activeRoll.frames.length > effectiveSlots;
              const maxOffset = Math.max(0, activeRoll.frames.length - effectiveSlots);
              const windowStart = Math.min(
                maxOffset,
                Math.max(0, Math.round(filmScrollOffset))
              );
              const visibleItems = isLongStrip
                ? activeRoll.frames.slice(windowStart, windowStart + effectiveSlots)
                : activeRoll.frames;
              const gateFirstCode = visibleItems[0]?.frameCode ?? '01A';
              const gateLastCode =
                visibleItems[visibleItems.length - 1]?.frameCode ?? '06A';

              return (
                <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 w-full">
                  <div className="flex items-center justify-between gap-3 w-full lg:w-auto min-w-0">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <span
                        className="inline-block w-2 h-5 shrink-0"
                        style={{ backgroundColor: getYearConfig(activeRoll.year).color }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-[#888C90] font-mono-tabular">
                          <span>{activeRoll.year}</span>
                          <span aria-hidden="true">/</span>
                          <span>{activeRoll.rollCode}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{activeRoll.filmStock}</span>
                          <span aria-hidden="true">·</span>
                          <span>{activeRoll.frames.length} EXP</span>
                        </div>
                        <p className="text-xs md:text-sm font-normal text-[#222426] truncate">
                          {hoveredFrame ? (
                            `${hoveredFrame.frameCode} — ${hoveredFrame.title}`
                          ) : isLongStrip ? (
                            <>
                              <span className="sm:hidden">
                                {activeRoll.title} · Swipe to wind
                              </span>
                              <span className="hidden sm:inline">
                                {activeRoll.title} · Drag strip or scrub
                              </span>
                            </>
                          ) : (
                            `${activeRoll.title} · Tap any frame to inspect`
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="lg:hidden flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenFrameFromDock(windowStart, true)}
                        aria-label="Browse photos fullscreen"
                        className="p-2 text-[#222426] bg-[#EAE5DC] border border-[#222426]/15 cursor-pointer"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleReturnToDrawer}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-normal text-[#F6F3EE] bg-[#222426] hover:bg-[#383B3E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Return</span>
                      </button>
                    </div>
                  </div>

                  {/* Film Gate Scrubber + Frame Chips */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto shrink-0">
                    {isLongStrip && (
                      <div className="flex items-center gap-1.5 w-full sm:w-auto pr-0 sm:pr-1 sm:border-r border-[#222426]/10">
                        <button
                          type="button"
                          onClick={() => handleScrollFilm(-1)}
                          disabled={filmScrollOffset <= 0.05}
                          aria-label="Wind film left"
                          className="p-1.5 sm:p-1 text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] disabled:opacity-35 border border-[#222426]/12 cursor-pointer shrink-0"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={maxOffset}
                          step={0.05}
                          value={Math.min(maxOffset, filmScrollOffset)}
                          onChange={(e) => handleScrubFilm(parseFloat(e.target.value))}
                          aria-label="Film gate scrubber"
                          className="flex-1 sm:flex-none sm:w-28 accent-[#222426] cursor-pointer h-1.5 bg-[#EAE5DC]"
                        />
                        <button
                          type="button"
                          onClick={() => handleScrollFilm(1)}
                          disabled={filmScrollOffset >= maxOffset - 0.05}
                          aria-label="Wind film right"
                          className="p-1.5 sm:p-1 text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] disabled:opacity-35 border border-[#222426]/12 cursor-pointer shrink-0"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[11px] font-mono-tabular text-[#6A6E72] whitespace-nowrap pl-1">
                          {gateFirstCode}–{gateLastCode}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
                      {visibleItems.map((item) => {
                        const globalIdx = item.frameNumber - 1;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleOpenFrameFromDock(globalIdx)}
                            className={`px-2.5 sm:px-2 py-1.5 sm:py-1 text-[11px] font-mono-tabular border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                              hoveredFrame?.id === item.id
                                ? 'bg-[#222426] text-[#F6F3EE] border-[#222426]'
                                : 'bg-[#EAE5DC]/90 text-[#222426] border-[#222426]/18 hover:bg-[#EAE5DC]'
                            }`}
                          >
                            {item.frameCode}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="hidden lg:flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenFrameFromDock(windowStart, true)}
                      aria-label="Browse photos fullscreen"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal text-[#222426] bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Fullscreen</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleReturnToDrawer}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-normal text-[#F6F3EE] bg-[#222426] hover:bg-[#383B3E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Return to Drawer</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Fullscreen Loupe & 16mm Screening Modal */}
      <LoupeModal
        roll={loupeRoll}
        frameIndex={loupeFrameIndex}
        motionReel={loupeMotionReel}
        keyframeIndex={loupeKeyframeIndex}
        initialFullscreen={loupeFullscreen}
        initialTimeSec={loupeInitialTime}
        onSyncTimeSec={(timeSec) => {
          sceneManagerRef.current?.seekProjectorTo(timeSec);
        }}
        onClose={() => {
          const wasMotionNotes = loupeMotionReel !== null;
          setLoupeRoll(null);
          setLoupeFrameIndex(null);
          setLoupeMotionReel(null);
          setLoupeKeyframeIndex(null);
          setLoupeFullscreen(false);
          setLoupeInitialTime(undefined);
          if (wasMotionNotes && activeMotionReel) {
            sceneManagerRef.current?.setProjectorPlaying(true);
          }
        }}
        onSelectFrame={(idx) => {
          sceneManagerRef.current?.scrollFilmToFrame(idx);
          setLoupeFrameIndex(idx);
        }}
        onSelectKeyframe={(idx) => {
          setLoupeKeyframeIndex(idx);
          const cueSec = activeMotionReel?.keyframes[idx]?.timeSec;
          if (typeof cueSec === 'number') {
            sceneManagerRef.current?.seekProjectorTo(cueSec);
          }
        }}
        onReturnToDrawer={handleReturnToDrawer}
      />

      {/* Slide-Over Monograph Index Drawer */}
      <ArchiveIndexDrawer
        isOpen={isIndexOpen}
        activeYear={activeYear}
        activeCategory={activeCategory}
        activeRollId={activeRoll?.id ?? null}
        activeMotionReelId={activeMotionReel?.id ?? null}
        years={catalog.years}
        rollsByYear={catalog.rollsByYear}
        reelsByYear={catalog.reelsByYear}
        onClose={() => setIsIndexOpen(false)}
        onSelectRoll={handleJumpToRoll}
        onSelectMotionReel={handleJumpToMotionReel}
      />

      {/* Admin Dashboard Modal */}
      <AdminDashboardModal
        isOpen={isAdminOpen}
        onClose={handleCloseAdmin}
        onCatalogUpdated={refreshCatalog}
      />
    </div>
  );
}
