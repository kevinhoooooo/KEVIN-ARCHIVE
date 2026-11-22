import { useMemo, useState } from 'react';
import { ArrowUpRight, Film, X } from 'lucide-react';
import {
  ARCHIVE_DATA,
  ArchiveYear,
  DrawerCategory,
  FilmRoll,
  MOTION_ARCHIVE_DATA,
  MotionReel,
  YEAR_CONFIGS,
  YearConfig,
} from '../data/archiveData';

interface ArchiveIndexDrawerProps {
  isOpen: boolean;
  activeYear: ArchiveYear | null;
  activeCategory?: DrawerCategory;
  activeRollId: string | null;
  activeMotionReelId?: string | null;
  years?: YearConfig[];
  rollsByYear?: Record<ArchiveYear, FilmRoll[]>;
  reelsByYear?: Record<ArchiveYear, MotionReel[]>;
  onClose: () => void;
  onSelectRoll: (roll: FilmRoll) => void;
  onSelectMotionReel: (reel: MotionReel) => void;
}

type IndexCategoryFilter = 'all' | DrawerCategory;

export function ArchiveIndexDrawer({
  isOpen,
  activeYear,
  activeCategory = 'stills',
  activeRollId,
  activeMotionReelId = null,
  years = YEAR_CONFIGS,
  rollsByYear = ARCHIVE_DATA,
  reelsByYear = MOTION_ARCHIVE_DATA,
  onClose,
  onSelectRoll,
  onSelectMotionReel,
}: ArchiveIndexDrawerProps) {
  const [filterYear, setFilterYear] = useState<ArchiveYear | 'all'>(activeYear ?? 'all');
  const [filterCategory, setFilterCategory] = useState<IndexCategoryFilter>('all');

  const { totalRolls, totalReels, newestYear, oldestYear } = useMemo(() => {
    const rSum = years.reduce((sum, cfg) => sum + (rollsByYear[cfg.year]?.length ?? 0), 0);
    const mSum = years.reduce((sum, cfg) => sum + (reelsByYear[cfg.year]?.length ?? 0), 0);
    return {
      totalRolls: rSum,
      totalReels: mSum,
      newestYear: years[0]?.year ?? '—',
      oldestYear: years[years.length - 1]?.year ?? '—',
    };
  }, [years, rollsByYear, reelsByYear]);

  if (!isOpen) return null;

  const effectiveYearFilter =
    filterYear !== 'all' && !years.some((y) => y.year === filterYear) ? 'all' : filterYear;

  const visibleYears =
    effectiveYearFilter === 'all'
      ? years
      : years.filter((cfg) => cfg.year === effectiveYearFilter);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#222426]/20">
      <div className="fixed inset-0" aria-hidden="true" onClick={onClose} />

      <aside
        aria-label="Film Archive Index"
        className="relative z-10 w-full max-w-md h-[100dvh] bg-[#F6F3EE] border-l border-[#222426]/12 flex flex-col text-[#222426] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-[#222426]/10">
          <div>
            <h2 className="text-base font-normal tracking-tight text-[#222426]">
              Archive Index
            </h2>
            <p className="text-xs text-[#888C90] mt-0.5 font-mono-tabular">
              {totalRolls} Stills · {totalReels} Motion Reels · {oldestYear}–{newestYear}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close archive index"
            className="p-2.5 text-[#222426] hover:bg-[#EAE5DC] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#222426]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filter Bar */}
        <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-2.5 border-b border-[#222426]/10 bg-[#F6F3EE]">
          <div className="flex items-center gap-1">
            {(
              [
                { key: 'all', label: 'All Media' },
                { key: 'stills', label: 'Stills · 135' },
                { key: 'motion', label: 'Motion · 16mm' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilterCategory(opt.key)}
                className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterCategory === opt.key
                    ? 'bg-[#222426] text-[#F6F3EE]'
                    : 'text-[#6A6E72] hover:text-[#222426] hover:bg-[#EAE5DC]/60'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-mono-tabular text-[#888C90] whitespace-nowrap">
            {activeCategory === 'motion' ? 'Motion Drawer' : 'Stills Drawer'}
          </span>
        </div>

        {/* Interactive Year Filter Bar */}
        <div className="flex items-center gap-1 px-5 sm:px-6 py-2.5 border-b border-[#222426]/10 bg-[#EAE5DC]/50 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setFilterYear('all')}
            className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              effectiveYearFilter === 'all'
                ? 'bg-[#222426] text-[#F6F3EE]'
                : 'text-[#6A6E72] hover:text-[#222426]'
            }`}
          >
            All Years
          </button>
          {years.map((cfg) => (
            <button
              key={cfg.year}
              type="button"
              onClick={() => setFilterYear(cfg.year)}
              className={`px-3 py-1.5 text-xs font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveYearFilter === cfg.year
                  ? 'bg-[#222426] text-[#F6F3EE]'
                  : 'text-[#6A6E72] hover:text-[#222426]'
              }`}
            >
              {cfg.year}
            </button>
          ))}
        </div>

        {/* Scrollable Rolls & Reels List */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-8">
          {visibleYears.length === 0 && (
            <div className="py-12 text-center text-xs text-[#888C90] font-mono-tabular">
              No public albums available yet.
            </div>
          )}
          {visibleYears.map((cfg) => {
            const rolls = rollsByYear[cfg.year] ?? [];
            const reels = reelsByYear[cfg.year] ?? [];
            const showStills = filterCategory === 'all' || filterCategory === 'stills';
            const showMotion = filterCategory === 'all' || filterCategory === 'motion';

            return (
              <section key={cfg.year}>
                <div className="flex items-baseline justify-between border-b border-[#222426]/12 pb-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-block w-2 h-3.5"
                      style={{ backgroundColor: cfg.color }}
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-medium tracking-tight text-[#222426]">
                      {cfg.year} — {cfg.seriesTheme}
                    </h3>
                  </div>
                  <span className="text-xs text-[#888C90] font-mono-tabular">
                    {cfg.filmStock}
                  </span>
                </div>

                {showMotion && reels.length > 0 && (
                  <div className="mb-4">
                    {filterCategory === 'all' && (
                      <p className="text-[11px] font-mono-tabular uppercase tracking-wider text-[#888C90] mb-1.5">
                        Motion · {reels.length} Reels
                      </p>
                    )}
                    <ul className="divide-y divide-[#222426]/8">
                      {reels.map((reel) => {
                        const isSelected = reel.id === activeMotionReelId;
                        return (
                          <li key={reel.id}>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectMotionReel(reel);
                                onClose();
                              }}
                              className={`w-full py-3 px-2 -mx-2 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer group ${
                                isSelected ? 'bg-[#EAE5DC]' : 'hover:bg-[#EAE5DC]/60'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs text-[#888C90] font-mono-tabular">
                                  <Film className="w-3 h-3 text-[#222426]/70 shrink-0" />
                                  <span>{reel.reelCode}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{reel.format}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{reel.durationLabel}</span>
                                </div>
                                <p className="text-sm font-normal text-[#222426] truncate mt-0.5">
                                  {reel.title}
                                </p>
                                <p className="text-xs font-light text-[#6A6E72] truncate">
                                  {reel.location} · {reel.filmStock}
                                </p>
                              </div>
                              <ArrowUpRight className="w-4 h-4 text-[#888C90] group-hover:text-[#222426] shrink-0 transition-colors" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {showStills && rolls.length > 0 && (
                  <div>
                    {filterCategory === 'all' && (
                      <p className="text-[11px] font-mono-tabular uppercase tracking-wider text-[#888C90] mb-1.5">
                        Stills · {rolls.length} Rolls
                      </p>
                    )}
                    <ul className="divide-y divide-[#222426]/8">
                      {rolls.map((roll) => {
                        const isSelected = roll.id === activeRollId;
                        return (
                          <li key={roll.id}>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectRoll(roll);
                                onClose();
                              }}
                              className={`w-full py-3 px-2 -mx-2 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer group ${
                                isSelected ? 'bg-[#EAE5DC]' : 'hover:bg-[#EAE5DC]/60'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs text-[#888C90] font-mono-tabular">
                                  <span>{roll.rollCode}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{roll.month}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{roll.frames.length} EXP</span>
                                </div>
                                <p className="text-sm font-normal text-[#222426] truncate mt-0.5">
                                  {roll.title}
                                </p>
                                <p className="text-xs font-light text-[#6A6E72] truncate">
                                  {roll.location}
                                  {roll.description ? ` — ${roll.description}` : ''}
                                </p>
                              </div>
                              <ArrowUpRight className="w-4 h-4 text-[#888C90] group-hover:text-[#222426] shrink-0 transition-colors" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
