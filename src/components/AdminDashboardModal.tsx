import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Layers,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Video,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  FilmRoll,
  MotionReel,
  PHOTO_ASSETS,
  PhotoFrame,
  YearConfig,
  isSafeMediaUrl,
} from '../data/archiveData';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  User,
  auth,
  googleProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from '../firebase';
import {
  ArchiveCatalog,
  MediaCheckResult,
  checkIsAdminUser,
  deleteFilmRoll,
  deleteMotionReel,
  deleteYearConfig,
  fetchAdminArchiveCatalog,
  getDefaultArchiveCatalog,
  saveFilmRoll,
  saveMotionReel,
  saveYearConfig,
  seedArchiveToCloud,
  testMediaUrlAccess,
  toggleFilmRollEnabled,
  toggleMotionReelEnabled,
  toggleYearEnabled,
} from '../services/archiveCloudService';

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCatalogUpdated: () => Promise<void> | void;
}

type AdminTab = 'stills' | 'motion' | 'years';

export function AdminDashboardModal({
  isOpen,
  onClose,
  onCatalogUpdated,
}: AdminDashboardModalProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [catalog, setCatalog] = useState<ArchiveCatalog>(() => getDefaultArchiveCatalog());
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('stills');
  const [yearFilter, setYearFilter] = useState<string>('all');

  // Editors
  const [editingYear, setEditingYear] = useState<{ cfg: YearConfig; isNew: boolean } | null>(null);
  const [editingRoll, setEditingRoll] = useState<{ roll: FilmRoll; isNew: boolean } | null>(null);
  const [editingReel, setEditingReel] = useState<{ reel: MotionReel; isNew: boolean } | null>(null);
  const [batchUrlsText, setBatchUrlsText] = useState('');
  const [mediaCheckMap, setMediaCheckMap] = useState<Record<string, MediaCheckResult>>({});
  const [checkingKey, setCheckingKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      const adminOk = await checkIsAdminUser(nextUser);
      setIsAdmin(adminOk);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const loadAdminCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchAdminArchiveCatalog();
      setCatalog(next);
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '读取云端档案目录失败。',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && authReady && isAdmin) {
      void loadAdminCatalog();
    }
  }, [isOpen, authReady, isAdmin, loadAdminCatalog]);

  const handleSignIn = async () => {
    setBusyAction('auth');
    setStatusBanner(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Google 登录失败，请确认弹窗未被拦截。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setIsAdmin(false);
    setEditingRoll(null);
    setEditingReel(null);
    setEditingYear(null);
  };

  const handleSeedCloud = async () => {
    if (!user) return;
    setBusyAction('seed');
    setStatusBanner(null);
    try {
      await seedArchiveToCloud(user.uid);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({
        type: 'ok',
        text: '已成功将默认档案同步到 Firestore 云端，现在任何开关与链接修改都会实时同步给所有访客！',
      });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '初始化云端数据失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const ensureCloudReady = async (): Promise<boolean> => {
    if (catalog.cloudSeeded) return true;
    if (!user) return false;
    await seedArchiveToCloud(user.uid);
    return true;
  };

  const handleToggleYear = async (cfg: YearConfig) => {
    if (!user) return;
    setBusyAction(`year-${cfg.year}`);
    try {
      await ensureCloudReady();
      await toggleYearEnabled(cfg.year, !(cfg.enabled !== false));
      await loadAdminCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '切换年份状态失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleRoll = async (roll: FilmRoll) => {
    if (!user) return;
    setBusyAction(`roll-${roll.id}`);
    try {
      await ensureCloudReady();
      await toggleFilmRollEnabled(roll.id, !(roll.enabled !== false));
      await loadAdminCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '切换相册开关失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleReel = async (reel: MotionReel) => {
    if (!user) return;
    setBusyAction(`reel-${reel.id}`);
    try {
      await ensureCloudReady();
      await toggleMotionReelEnabled(reel.id, !(reel.enabled !== false));
      await loadAdminCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '切换片盘开关失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveYear = async () => {
    if (!editingYear || !user) return;
    setBusyAction('save-year');
    setStatusBanner(null);
    try {
      await ensureCloudReady();
      await saveYearConfig(editingYear.cfg, editingYear.isNew, user.uid);
      setEditingYear(null);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: `年份 ${editingYear.cfg.year} 已保存并同步。` });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '保存年份失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteYear = async (yearId: string) => {
    setBusyAction(`del-year-${yearId}`);
    try {
      await ensureCloudReady();
      await deleteYearConfig(yearId);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: `已移除年份柜 ${yearId}。` });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '删除年份失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveRoll = async () => {
    if (!editingRoll || !user) return;
    for (const f of editingRoll.roll.frames) {
      if (!isSafeMediaUrl(f.imageUrl)) {
        setStatusBanner({
          type: 'err',
          text: `第 ${f.frameNumber} 张照片链接格式不安全或包含空格，请检查后重试。`,
        });
        return;
      }
    }
    setBusyAction('save-roll');
    setStatusBanner(null);
    try {
      await ensureCloudReady();
      await saveFilmRoll(editingRoll.roll, editingRoll.isNew, user.uid);
      setEditingRoll(null);
      setBatchUrlsText('');
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: `胶卷相册「${editingRoll.roll.title}」已保存并同步！` });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '保存胶卷相册失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteRoll = async (rollId: string) => {
    setBusyAction(`del-roll-${rollId}`);
    try {
      await ensureCloudReady();
      await deleteFilmRoll(rollId);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: '胶卷相册已删除。' });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '删除胶卷相册失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveReel = async () => {
    if (!editingReel || !user) return;
    if (editingReel.reel.videoUrl && !isSafeMediaUrl(editingReel.reel.videoUrl)) {
      setStatusBanner({ type: 'err', text: '视频直链格式不合法，请使用 http(s):// 链接。' });
      return;
    }
    setBusyAction('save-reel');
    setStatusBanner(null);
    try {
      await ensureCloudReady();
      await saveMotionReel(editingReel.reel, editingReel.isNew, user.uid);
      setEditingReel(null);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: `电影片盘「${editingReel.reel.title}」已保存并同步！` });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '保存电影片盘失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteReel = async (reelId: string) => {
    setBusyAction(`del-reel-${reelId}`);
    try {
      await ensureCloudReady();
      await deleteMotionReel(reelId);
      await loadAdminCatalog();
      await onCatalogUpdated();
      setStatusBanner({ type: 'ok', text: '电影片盘已删除。' });
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text: err instanceof Error ? err.message : '删除电影片盘失败。',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunMediaCheck = async (key: string, url: string, kind: 'image' | 'video') => {
    setCheckingKey(key);
    try {
      const result = await testMediaUrlAccess(url, kind);
      setMediaCheckMap((prev) => ({ ...prev, [key]: result }));
    } finally {
      setCheckingKey(null);
    }
  };

  const handleExportBackup = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kevin-archive-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allRolls = useMemo(() => {
    const list: FilmRoll[] = [];
    for (const y of catalog.years) {
      for (const r of catalog.rollsByYear[y.year] ?? []) {
        if (yearFilter === 'all' || r.year === yearFilter) {
          list.push(r);
        }
      }
    }
    return list;
  }, [catalog, yearFilter]);

  const allReels = useMemo(() => {
    const list: MotionReel[] = [];
    for (const y of catalog.years) {
      for (const m of catalog.reelsByYear[y.year] ?? []) {
        if (yearFilter === 'all' || m.year === yearFilter) {
          list.push(m);
        }
      }
    }
    return list;
  }, [catalog, yearFilter]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="KEVIN ARCHIVE Admin Management"
      className="fixed inset-0 z-50 bg-[#F6F3EE] text-[#222426] flex flex-col overflow-hidden"
    >
      {/* Top Admin Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 py-3.5 border-b border-[#222426]/12 bg-[#F6F3EE]">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-4 h-4 text-[#222426]" />
          <div>
            <h1 className="text-sm sm:text-base font-normal tracking-[0.14em] uppercase">
              KEVIN ARCHIVE · 后台管理
            </h1>
            <p className="text-[11px] font-mono-tabular text-[#6A6E72]">
              控制相册显示开关 · 编辑简介参数 · 管理极空间照片/视频直链
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={handleExportBackup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/12 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">导出备份</span>
              </button>
              <button
                type="button"
                onClick={() => void loadAdminCatalog()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/12 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">刷新</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#6A6E72] hover:text-[#222426] border border-[#222426]/12 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">退出</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>返回展厅</span>
          </button>
        </div>
      </header>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {!authReady ? (
          <div className="max-w-md mx-auto mt-16 p-6 border border-[#222426]/12 bg-[#EAE5DC]/40 text-center text-xs font-mono-tabular text-[#6A6E72]">
            正在验证管理员权限…
          </div>
        ) : !user ? (
          <div className="max-w-md mx-auto mt-12 p-7 border border-[#222426]/14 bg-[#EAE5DC]/45 space-y-5">
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono-tabular uppercase tracking-widest text-[#6A6E72]">
                Admin Access
              </p>
              <h2 className="text-lg font-normal text-[#222426]">
                登录 KEVIN ARCHIVE 管理员账号
              </h2>
              <p className="text-xs text-[#6A6E72] leading-relaxed">
                请使用受信任的管理员 Google 账号（{BOOTSTRAP_ADMIN_EMAIL}）登录。登录后即可随时开关相册、编辑说明及管理极空间媒体直链。
              </p>
            </div>
            {statusBanner && (
              <p className="text-xs text-[#9B3B2E] border border-[#9B3B2E]/25 bg-[#9B3B2E]/8 p-2.5">
                {statusBanner.text}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={busyAction === 'auth'}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] transition-colors cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{busyAction === 'auth' ? '正在打开登录窗口…' : '使用 Google 账号登录'}</span>
            </button>
          </div>
        ) : !isAdmin ? (
          <div className="max-w-md mx-auto mt-12 p-7 border border-[#9B3B2E]/25 bg-[#EAE5DC]/45 space-y-4">
            <h2 className="text-base font-normal text-[#222426]">当前账号无管理权限</h2>
            <p className="text-xs text-[#6A6E72] leading-relaxed">
              当前登录账号为 <span className="font-mono-tabular text-[#222426]">{user.email}</span>，仅授权管理员（{BOOTSTRAP_ADMIN_EMAIL}）可修改档案配置。
            </p>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs bg-[#222426] text-[#F6F3EE] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>切换管理员账号</span>
            </button>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Cloud Initialization Banner */}
            {!catalog.cloudSeeded && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-[#222426]/20 bg-[#EAE5DC]/75">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#222426]">
                    云端管理尚未初始化（当前对外展示为本地内置示例）
                  </p>
                  <p className="text-xs text-[#6A6E72]">
                    点击右侧按钮把 2019–2026 基础相册写入 Firestore，之后你在后台开关任意相册或修改直链都会实时同步给访问 GitHub Pages 的朋友。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSeedCloud()}
                  disabled={busyAction === 'seed'}
                  className="px-4 py-2 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {busyAction === 'seed' ? '正在同步到云端…' : '一键启用云端实时管理'}
                </button>
              </div>
            )}

            {statusBanner && (
              <div
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs border ${
                  statusBanner.type === 'ok'
                    ? 'border-[#3E6B48]/30 bg-[#3E6B48]/8 text-[#28472F]'
                    : statusBanner.type === 'warn'
                    ? 'border-[#9A6E2B]/35 bg-[#9A6E2B]/10 text-[#664615]'
                    : 'border-[#9B3B2E]/30 bg-[#9B3B2E]/8 text-[#7C2B20]'
                }`}
              >
                <span>{statusBanner.text}</span>
                <button
                  type="button"
                  onClick={() => setStatusBanner(null)}
                  className="text-current opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Tabs + Year Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222426]/12 pb-3">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { key: 'stills', label: '胶卷相册 · Stills', icon: ImageIcon },
                    { key: 'motion', label: '电影片盘 · Motion', icon: Film },
                    { key: 'years', label: '年份展柜开关 · Years', icon: Layers },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setActiveTab(t.key);
                        setEditingRoll(null);
                        setEditingReel(null);
                        setEditingYear(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs transition-colors cursor-pointer ${
                        activeTab === t.key
                          ? 'bg-[#222426] text-[#F6F3EE]'
                          : 'bg-[#EAE5DC]/60 text-[#55585C] hover:text-[#222426]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {activeTab !== 'years' && (
                <div className="flex items-center gap-2">
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    aria-label="Filter by year"
                    className="px-3 py-1.5 text-xs font-mono-tabular bg-[#F6F3EE] border border-[#222426]/18 text-[#222426]"
                  >
                    <option value="all">全部年份</option>
                    {catalog.years.map((y) => (
                      <option key={y.year} value={y.year}>
                        {y.year}
                      </option>
                    ))}
                  </select>

                  {activeTab === 'stills' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const targetYear =
                          yearFilter !== 'all' ? yearFilter : catalog.years[0]?.year ?? '2026';
                        const existingRolls = catalog.rollsByYear[targetYear] ?? [];
                        const nextNum = existingRolls.length + 1;
                        const id = `${targetYear}-roll-${Date.now().toString(36)}`;
                        setEditingRoll({
                          isNew: true,
                          roll: {
                            id,
                            year: targetYear,
                            rollNumber: nextNum,
                            rollCode: `ROLL ${String(nextNum).padStart(2, '0')}`,
                            title: '新建极空间胶卷相册',
                            description: '填写这卷胶卷的拍摄背景、故事或补充说明。',
                            filmStock: 'PORTRA 400',
                            iso: 400,
                            location: 'Tokyo / Home',
                            month: 'NOV',
                            enabled: true,
                            frames: [
                              {
                                id: `${id}-f1`,
                                frameNumber: 1,
                                frameCode: '1A',
                                title: 'Frame 01',
                                location: 'Tokyo',
                                date: `${targetYear}.NOV`,
                                camera: 'Leica M6',
                                lens: '35mm f/2',
                                filmStock: 'PORTRA 400',
                                exposure: '1/250s · f/4',
                                notes: '',
                                imageUrl: PHOTO_ASSETS.slateArch,
                                cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
                              },
                            ],
                          },
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建胶卷相册</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const targetYear =
                          yearFilter !== 'all' ? yearFilter : catalog.years[0]?.year ?? '2026';
                        const existingReels = catalog.reelsByYear[targetYear] ?? [];
                        const nextNum = existingReels.length + 1;
                        const id = `${targetYear}-motion-${Date.now().toString(36)}`;
                        setEditingReel({
                          isNew: true,
                          reel: {
                            id,
                            year: targetYear,
                            reelNumber: nextNum,
                            reelCode: `REEL ${String(nextNum).padStart(2, '0')}`,
                            title: '新建极空间视频片盘',
                            filmStock: 'VISION3 250D',
                            format: '16MM · 24 FPS',
                            fps: 24,
                            durationSec: 30,
                            durationLabel: '00:30',
                            camera: 'Sony FX3 / Bolex',
                            lens: '35mm f/1.8',
                            location: 'Kyoto',
                            month: 'NOV',
                            notes: '粘贴极空间 MP4 视频公开直链后，将在 3D 放映机与全屏影院直接播放。',
                            videoUrl: '',
                            enabled: true,
                            keyframes: [
                              {
                                id: `${id}-k1`,
                                frameNumber: 1,
                                frameCode: '01M',
                                timeSec: 0,
                                timecode: '00:00',
                                title: 'Opening Still',
                                notes: '',
                                imageUrl: PHOTO_ASSETS.coastalMist,
                                cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
                              },
                            ],
                          },
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建视频片盘</span>
                    </button>
                  )}
                </div>
              )}

              {activeTab === 'years' && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingYear({
                      isNew: true,
                      cfg: {
                        year: String(Number(catalog.years[0]?.year || 2026) + 1),
                        label: String(Number(catalog.years[0]?.year || 2026) + 1),
                        color: '#798B9C',
                        tintHex: 0x798b9c,
                        filmStock: 'PORTRA 400',
                        iso: 400,
                        seriesTheme: 'New Year Archive',
                        cabinetX: 0,
                        sortOrder: 0,
                        enabled: true,
                      },
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增年份柜子</span>
                </button>
              )}
            </div>

            {/* TAB 1: STILLS ALBUMS */}
            {activeTab === 'stills' && !editingRoll && (
              <div className="divide-y divide-[#222426]/10 border border-[#222426]/12 bg-[#F6F3EE]">
                {allRolls.map((roll) => {
                  const enabled = roll.enabled !== false;
                  return (
                    <div
                      key={roll.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 hover:bg-[#EAE5DC]/35 transition-colors"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular text-[#6A6E72]">
                          <span className="px-1.5 py-0.5 bg-[#EAE5DC] text-[#222426]">
                            {roll.year}
                          </span>
                          <span>{roll.rollCode}</span>
                          <span>·</span>
                          <span>{roll.frames.length} 张照片</span>
                          <span>·</span>
                          <span>{roll.filmStock}</span>
                          <span
                            className={`px-1.5 py-0.5 text-[11px] ${
                              enabled
                                ? 'bg-[#3E6B48]/15 text-[#28472F]'
                                : 'bg-[#222426]/10 text-[#6A6E72]'
                            }`}
                          >
                            {enabled ? '公开展示中' : '已隐藏'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#222426] truncate">{roll.title}</p>
                        {roll.description && (
                          <p className="text-xs text-[#6A6E72] truncate">{roll.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleRoll(roll)}
                          disabled={busyAction === `roll-${roll.id}`}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors cursor-pointer ${
                            enabled
                              ? 'border-[#3E6B48]/35 bg-[#3E6B48]/10 text-[#28472F]'
                              : 'border-[#222426]/20 bg-[#EAE5DC] text-[#6A6E72]'
                          }`}
                        >
                          {enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{enabled ? '开启中' : '已关闭'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBatchUrlsText('');
                            setEditingRoll({
                              isNew: false,
                              roll: JSON.parse(JSON.stringify(roll)) as FilmRoll,
                            });
                          }}
                          className="px-3 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                        >
                          编辑相册 / 链接
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteRoll(roll.id)}
                          disabled={busyAction === `del-roll-${roll.id}`}
                          aria-label="Delete roll"
                          className="p-1.5 text-[#888C90] hover:text-[#9B3B2E] border border-[#222426]/12 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* STILLS ROLL EDITOR */}
            {activeTab === 'stills' && editingRoll && (
              <div className="border border-[#222426]/15 bg-[#EAE5DC]/35 p-5 space-y-6">
                <div className="flex items-center justify-between border-b border-[#222426]/12 pb-3">
                  <h2 className="text-base font-normal text-[#222426]">
                    {editingRoll.isNew ? '新建胶卷相册' : `编辑胶卷：${editingRoll.roll.title}`}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditingRoll(null)}
                    className="text-xs text-[#6A6E72] hover:text-[#222426] cursor-pointer"
                  >
                    取消返回列表
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">年份 Year</span>
                    <select
                      value={editingRoll.roll.year}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, year: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    >
                      {catalog.years.map((y) => (
                        <option key={y.year} value={y.year}>
                          {y.year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">相册标题 Title</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={editingRoll.roll.title}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, title: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">卷号 / 编号</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={editingRoll.roll.rollNumber}
                      onChange={(e) => {
                        const num = Math.max(1, Number(e.target.value) || 1);
                        setEditingRoll({
                          ...editingRoll,
                          roll: {
                            ...editingRoll.roll,
                            rollNumber: num,
                            rollCode: `ROLL ${String(num).padStart(2, '0')}`,
                          },
                        });
                      }}
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">胶片型号 Film Stock</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={editingRoll.roll.filmStock}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, filmStock: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">拍摄地点 Location</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={editingRoll.roll.location}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, location: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">月份 Month</span>
                    <input
                      type="text"
                      maxLength={16}
                      value={editingRoll.roll.month}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, month: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">感光度 ISO</span>
                    <input
                      type="number"
                      min={1}
                      max={102400}
                      value={editingRoll.roll.iso}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, iso: Number(e.target.value) || 400 },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingRoll.roll.enabled !== false}
                      onChange={(e) =>
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, enabled: e.target.checked },
                        })
                      }
                    />
                    <span>对外公开展示此相册</span>
                  </label>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="text-[#6A6E72] font-mono-tabular">
                    相册补充简介（会显示在放大看图页面中）
                  </span>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={editingRoll.roll.description ?? ''}
                    onChange={(e) =>
                      setEditingRoll({
                        ...editingRoll,
                        roll: { ...editingRoll.roll, description: e.target.value },
                      })
                    }
                    placeholder="填写这卷相册的背景故事、器材搭配或旅行随记…"
                    className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                  />
                </label>

                {/* Batch import ZSpace photo URLs */}
                <div className="p-3.5 bg-[#F6F3EE] border border-[#222426]/12 space-y-2 text-xs">
                  <p className="font-medium text-[#222426]">
                    批量粘贴极空间照片直链（每行一条 HTTPS 图片地址，最多 36 张）
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      rows={3}
                      value={batchUrlsText}
                      onChange={(e) => setBatchUrlsText(e.target.value)}
                      placeholder="https://nas.你的域名.com/photos/2025/01.jpg&#10;https://nas.你的域名.com/photos/2025/02.jpg"
                      className="flex-1 px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const urls = batchUrlsText
                          .split(/\r?\n/)
                          .map((u) => u.trim())
                          .filter((u) => u && isSafeMediaUrl(u));
                        if (urls.length === 0) return;
                        const current = editingRoll.roll.frames;
                        const appended: PhotoFrame[] = urls
                          .slice(0, Math.max(0, 36 - current.length))
                          .map((url, i) => {
                            const num = current.length + i + 1;
                            return {
                              id: `${editingRoll.roll.id}-f${num}`,
                              frameNumber: num,
                              frameCode: `${num}A`,
                              title: `Frame ${String(num).padStart(2, '0')}`,
                              location: editingRoll.roll.location,
                              date: `${editingRoll.roll.year}.${editingRoll.roll.month}`,
                              camera: 'Leica M6',
                              lens: '35mm f/2',
                              filmStock: editingRoll.roll.filmStock,
                              exposure: '1/250s · f/4',
                              notes: '',
                              imageUrl: url,
                              cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
                            };
                          });
                        setEditingRoll({
                          ...editingRoll,
                          roll: { ...editingRoll.roll, frames: [...current, ...appended] },
                        });
                        setBatchUrlsText('');
                      }}
                      className="px-3.5 py-2 bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 whitespace-nowrap cursor-pointer self-start"
                    >
                      导入为底片帧
                    </button>
                  </div>
                </div>

                {/* Frames Editor */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono-tabular uppercase tracking-wider text-[#6A6E72]">
                      底片列表 ({editingRoll.roll.frames.length} / 36)
                    </h3>
                    {editingRoll.roll.frames.length < 36 && (
                      <button
                        type="button"
                        onClick={() => {
                          const num = editingRoll.roll.frames.length + 1;
                          const nextFrame: PhotoFrame = {
                            id: `${editingRoll.roll.id}-f${num}`,
                            frameNumber: num,
                            frameCode: `${num}A`,
                            title: `Frame ${String(num).padStart(2, '0')}`,
                            location: editingRoll.roll.location,
                            date: `${editingRoll.roll.year}.${editingRoll.roll.month}`,
                            camera: 'Leica M6',
                            lens: '35mm f/2',
                            filmStock: editingRoll.roll.filmStock,
                            exposure: '1/250s · f/4',
                            notes: '',
                            imageUrl: PHOTO_ASSETS.slateArch,
                            cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
                          };
                          setEditingRoll({
                            ...editingRoll,
                            roll: {
                              ...editingRoll.roll,
                              frames: [...editingRoll.roll.frames, nextFrame],
                            },
                          });
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-[#EAE5DC] border border-[#222426]/15 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>添加 1 帧</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {editingRoll.roll.frames.map((frame, fIdx) => {
                      const checkKey = `frame-${fIdx}`;
                      const checkRes = mediaCheckMap[checkKey];
                      return (
                        <div
                          key={frame.id}
                          className="p-3 bg-[#F6F3EE] border border-[#222426]/12 space-y-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono-tabular font-medium">
                              #{String(fIdx + 1).padStart(2, '0')} · {frame.frameCode}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const remaining = editingRoll.roll.frames
                                  .filter((_, i) => i !== fIdx)
                                  .map((item, idx) => ({
                                    ...item,
                                    frameNumber: idx + 1,
                                    frameCode: `${idx + 1}A`,
                                  }));
                                setEditingRoll({
                                  ...editingRoll,
                                  roll: { ...editingRoll.roll, frames: remaining },
                                });
                              }}
                              className="text-[#888C90] hover:text-[#9B3B2E] cursor-pointer"
                            >
                              删除此帧
                            </button>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="照片标题"
                              value={frame.title}
                              onChange={(e) => {
                                const next = [...editingRoll.roll.frames];
                                next[fIdx] = { ...frame, title: e.target.value };
                                setEditingRoll({
                                  ...editingRoll,
                                  roll: { ...editingRoll.roll, frames: next },
                                });
                              }}
                              className="sm:w-44 px-2.5 py-1.5 border border-[#222426]/15"
                            />
                            <input
                              type="text"
                              placeholder="相机 (如 Leica M6)"
                              value={frame.camera}
                              onChange={(e) => {
                                const next = [...editingRoll.roll.frames];
                                next[fIdx] = { ...frame, camera: e.target.value };
                                setEditingRoll({
                                  ...editingRoll,
                                  roll: { ...editingRoll.roll, frames: next },
                                });
                              }}
                              className="sm:w-36 px-2.5 py-1.5 border border-[#222426]/15"
                            />
                            <input
                              type="text"
                              placeholder="镜头 / 曝光参数"
                              value={frame.exposure}
                              onChange={(e) => {
                                const next = [...editingRoll.roll.frames];
                                next[fIdx] = { ...frame, exposure: e.target.value };
                                setEditingRoll({
                                  ...editingRoll,
                                  roll: { ...editingRoll.roll, frames: next },
                                });
                              }}
                              className="sm:w-36 px-2.5 py-1.5 border border-[#222426]/15 font-mono-tabular"
                            />
                            <input
                              type="text"
                              placeholder="极空间照片公开直链 (https://...)"
                              value={frame.imageUrl}
                              onChange={(e) => {
                                const next = [...editingRoll.roll.frames];
                                next[fIdx] = { ...frame, imageUrl: e.target.value };
                                setEditingRoll({
                                  ...editingRoll,
                                  roll: { ...editingRoll.roll, frames: next },
                                });
                              }}
                              className="flex-1 px-2.5 py-1.5 border border-[#222426]/15 font-mono-tabular text-[11px]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunMediaCheck(checkKey, frame.imageUrl, 'image')
                              }
                              disabled={checkingKey === checkKey}
                              className="px-2.5 py-1.5 bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 whitespace-nowrap cursor-pointer"
                            >
                              {checkingKey === checkKey ? '检测中…' : '检测直链'}
                            </button>
                          </div>

                          {checkRes && (
                            <p
                              className={`flex items-center gap-1.5 text-[11px] ${
                                checkRes.ok && checkRes.corsOk
                                  ? 'text-[#28472F]'
                                  : checkRes.ok
                                  ? 'text-[#664615]'
                                  : 'text-[#7C2B20]'
                              }`}
                            >
                              {checkRes.ok && checkRes.corsOk ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{checkRes.detail}</span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[#222426]/12">
                  <button
                    type="button"
                    onClick={() => setEditingRoll(null)}
                    className="px-4 py-2 text-xs border border-[#222426]/15 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveRoll()}
                    disabled={busyAction === 'save-roll'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{busyAction === 'save-roll' ? '保存同步中…' : '保存到云端'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: MOTION REELS */}
            {activeTab === 'motion' && !editingReel && (
              <div className="divide-y divide-[#222426]/10 border border-[#222426]/12 bg-[#F6F3EE]">
                {allReels.map((reel) => {
                  const enabled = reel.enabled !== false;
                  return (
                    <div
                      key={reel.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 hover:bg-[#EAE5DC]/35 transition-colors"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular text-[#6A6E72]">
                          <span className="px-1.5 py-0.5 bg-[#EAE5DC] text-[#222426]">
                            {reel.year}
                          </span>
                          <span>{reel.reelCode}</span>
                          <span>·</span>
                          <span>{reel.format}</span>
                          <span>·</span>
                          <span>{reel.durationLabel}</span>
                          <span
                            className={`px-1.5 py-0.5 text-[11px] ${
                              reel.videoUrl
                                ? 'bg-[#222426] text-[#F6F3EE]'
                                : 'bg-[#EAE5DC] text-[#6A6E72]'
                            }`}
                          >
                            {reel.videoUrl ? '已填实拍视频直链' : '静帧动态模拟'}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 text-[11px] ${
                              enabled
                                ? 'bg-[#3E6B48]/15 text-[#28472F]'
                                : 'bg-[#222426]/10 text-[#6A6E72]'
                            }`}
                          >
                            {enabled ? '公开展示中' : '已隐藏'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#222426] truncate">{reel.title}</p>
                        <p className="text-xs text-[#6A6E72] truncate">{reel.notes}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleReel(reel)}
                          disabled={busyAction === `reel-${reel.id}`}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors cursor-pointer ${
                            enabled
                              ? 'border-[#3E6B48]/35 bg-[#3E6B48]/10 text-[#28472F]'
                              : 'border-[#222426]/20 bg-[#EAE5DC] text-[#6A6E72]'
                          }`}
                        >
                          {enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{enabled ? '开启中' : '已关闭'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingReel({
                              isNew: false,
                              reel: JSON.parse(JSON.stringify(reel)) as MotionReel,
                            })
                          }
                          className="px-3 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                        >
                          编辑影片 / 视频直链
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteReel(reel.id)}
                          disabled={busyAction === `del-reel-${reel.id}`}
                          aria-label="Delete reel"
                          className="p-1.5 text-[#888C90] hover:text-[#9B3B2E] border border-[#222426]/12 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* MOTION REEL EDITOR */}
            {activeTab === 'motion' && editingReel && (
              <div className="border border-[#222426]/15 bg-[#EAE5DC]/35 p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-[#222426]/12 pb-3">
                  <h2 className="text-base font-normal text-[#222426] flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    <span>
                      {editingReel.isNew ? '新建视频片盘' : `编辑视频片盘：${editingReel.reel.title}`}
                    </span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditingReel(null)}
                    className="text-xs text-[#6A6E72] hover:text-[#222426] cursor-pointer"
                  >
                    取消返回列表
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">年份 Year</span>
                    <select
                      value={editingReel.reel.year}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, year: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    >
                      {catalog.years.map((y) => (
                        <option key={y.year} value={y.year}>
                          {y.year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">影片名称 Title</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={editingReel.reel.title}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, title: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">画幅格式 Format</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={editingReel.reel.format}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, format: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">片长(秒) Duration</span>
                    <input
                      type="number"
                      min={1}
                      max={7200}
                      value={editingReel.reel.durationSec}
                      onChange={(e) => {
                        const sec = Math.max(1, Number(e.target.value) || 24);
                        const m = Math.floor(sec / 60);
                        const s = Math.floor(sec % 60);
                        setEditingReel({
                          ...editingRollOrReelCompat(editingReel),
                          reel: {
                            ...editingReel.reel,
                            durationSec: sec,
                            durationLabel: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
                          },
                        });
                      }}
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">摄影机 Camera</span>
                    <input
                      type="text"
                      maxLength={80}
                      value={editingReel.reel.camera}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, camera: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">镜头 Lens</span>
                    <input
                      type="text"
                      maxLength={80}
                      value={editingReel.reel.lens}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, lens: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[#6A6E72] font-mono-tabular">地点 Location</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={editingReel.reel.location}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, location: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingReel.reel.enabled !== false}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, enabled: e.target.checked },
                        })
                      }
                    />
                    <span>对外公开展示此视频片盘</span>
                  </label>
                </div>

                {/* ZSpace Video Direct URL */}
                <div className="p-4 bg-[#F6F3EE] border border-[#222426]/12 space-y-2.5 text-xs">
                  <label className="block font-medium text-[#222426]">
                    极空间 MP4 视频公开直链（推荐 H.264 + AAC 编码）
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      maxLength={1000}
                      placeholder="https://nas.你的域名.com/videos/2025-kyoto.mp4"
                      value={editingReel.reel.videoUrl ?? ''}
                      onChange={(e) =>
                        setEditingReel({
                          ...editingReel,
                          reel: { ...editingReel.reel, videoUrl: e.target.value },
                        })
                      }
                      className="flex-1 px-3 py-2 border border-[#222426]/15 font-mono-tabular text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void handleRunMediaCheck(
                          'reel-video',
                          editingReel.reel.videoUrl ?? '',
                          'video'
                        )
                      }
                      disabled={checkingKey === 'reel-video'}
                      className="px-3.5 py-2 bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 whitespace-nowrap cursor-pointer"
                    >
                      {checkingKey === 'reel-video' ? '检测视频流…' : '检测视频直链 & CORS'}
                    </button>
                  </div>
                  {mediaCheckMap['reel-video'] && (
                    <p
                      className={`flex items-center gap-1.5 text-[11px] ${
                        mediaCheckMap['reel-video'].ok && mediaCheckMap['reel-video'].corsOk
                          ? 'text-[#28472F]'
                          : mediaCheckMap['reel-video'].ok
                          ? 'text-[#664615]'
                          : 'text-[#7C2B20]'
                      }`}
                    >
                      {mediaCheckMap['reel-video'].ok && mediaCheckMap['reel-video'].corsOk ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{mediaCheckMap['reel-video'].detail}</span>
                    </p>
                  )}
                </div>

                {/* Cover Poster Image URL */}
                <div className="p-4 bg-[#F6F3EE] border border-[#222426]/12 space-y-2.5 text-xs">
                  <label className="block font-medium text-[#222426]">
                    片盘封面图 / 关键帧图片直链
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      maxLength={1000}
                      value={editingReel.reel.keyframes[0]?.imageUrl ?? PHOTO_ASSETS.coastalMist}
                      onChange={(e) => {
                        const existingKfs = editingReel.reel.keyframes;
                        const first = existingKfs[0] ?? {
                          id: `${editingReel.reel.id}-k1`,
                          frameNumber: 1,
                          frameCode: '01M',
                          timeSec: 0,
                          timecode: '00:00',
                          title: editingReel.reel.title,
                          notes: editingReel.reel.notes,
                          imageUrl: PHOTO_ASSETS.coastalMist,
                          cropFocus: { x: 0.5, y: 0.5, scale: 1.0 },
                        };
                        setEditingReel({
                          ...editingReel,
                          reel: {
                            ...editingReel.reel,
                            keyframes: [{ ...first, imageUrl: e.target.value }, ...existingKfs.slice(1)],
                          },
                        });
                      }}
                      className="flex-1 px-3 py-2 border border-[#222426]/15 font-mono-tabular text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void handleRunMediaCheck(
                          'reel-cover',
                          editingReel.reel.keyframes[0]?.imageUrl ?? '',
                          'image'
                        )
                      }
                      disabled={checkingKey === 'reel-cover'}
                      className="px-3.5 py-2 bg-[#EAE5DC] hover:bg-[#DFD9CE] border border-[#222426]/15 whitespace-nowrap cursor-pointer"
                    >
                      检测封面图
                    </button>
                  </div>
                  {mediaCheckMap['reel-cover'] && (
                    <p className="text-[11px] text-[#6A6E72]">{mediaCheckMap['reel-cover'].detail}</p>
                  )}
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="text-[#6A6E72] font-mono-tabular">影片介绍 / 笔记 Notes</span>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={editingReel.reel.notes}
                    onChange={(e) =>
                      setEditingReel({
                        ...editingReel,
                        reel: { ...editingReel.reel, notes: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                  />
                </label>

                <div className="flex justify-end gap-2 pt-2 border-t border-[#222426]/12">
                  <button
                    type="button"
                    onClick={() => setEditingReel(null)}
                    className="px-4 py-2 text-xs border border-[#222426]/15 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveReel()}
                    disabled={busyAction === 'save-reel'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{busyAction === 'save-reel' ? '保存同步中…' : '保存到云端'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: YEARS & CABINETS */}
            {activeTab === 'years' && (
              <div className="space-y-4">
                {editingYear && (
                  <div className="border border-[#222426]/15 bg-[#EAE5DC]/40 p-5 space-y-4 text-xs">
                    <h2 className="text-sm font-medium text-[#222426]">
                      {editingYear.isNew ? '新增年份展柜' : `编辑年份 ${editingYear.cfg.year}`}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <label className="space-y-1">
                        <span className="text-[#6A6E72] font-mono-tabular">4位年份 Year</span>
                        <input
                          type="text"
                          maxLength={4}
                          disabled={!editingYear.isNew}
                          value={editingYear.cfg.year}
                          onChange={(e) =>
                            setEditingYear({
                              ...editingYear,
                              cfg: {
                                ...editingYear.cfg,
                                year: e.target.value,
                                label: e.target.value,
                              },
                            })
                          }
                          className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular disabled:opacity-60"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[#6A6E72] font-mono-tabular">年度主题 Theme</span>
                        <input
                          type="text"
                          maxLength={120}
                          value={editingYear.cfg.seriesTheme}
                          onChange={(e) =>
                            setEditingYear({
                              ...editingYear,
                              cfg: { ...editingYear.cfg, seriesTheme: e.target.value },
                            })
                          }
                          className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[#6A6E72] font-mono-tabular">默认胶片 Film Stock</span>
                        <input
                          type="text"
                          maxLength={40}
                          value={editingYear.cfg.filmStock}
                          onChange={(e) =>
                            setEditingYear({
                              ...editingYear,
                              cfg: { ...editingYear.cfg, filmStock: e.target.value },
                            })
                          }
                          className="w-full px-3 py-2 bg-[#F6F3EE] border border-[#222426]/15 font-mono-tabular"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[#6A6E72] font-mono-tabular">色标 Hex</span>
                        <input
                          type="color"
                          value={editingYear.cfg.color}
                          onChange={(e) =>
                            setEditingYear({
                              ...editingYear,
                              cfg: { ...editingYear.cfg, color: e.target.value },
                            })
                          }
                          className="w-full h-9 px-1 py-1 bg-[#F6F3EE] border border-[#222426]/15 cursor-pointer"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingYear(null)}
                        className="px-3.5 py-1.5 border border-[#222426]/15 cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveYear()}
                        disabled={busyAction === 'save-year'}
                        className="px-4 py-1.5 bg-[#222426] text-[#F6F3EE] cursor-pointer"
                      >
                        保存年份
                      </button>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-[#222426]/10 border border-[#222426]/12 bg-[#F6F3EE]">
                  {catalog.years.map((cfg) => {
                    const enabled = cfg.enabled !== false;
                    const rollCount = catalog.rollsByYear[cfg.year]?.length ?? 0;
                    const reelCount = catalog.reelsByYear[cfg.year]?.length ?? 0;
                    return (
                      <div
                        key={cfg.year}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-2.5 h-8 shrink-0"
                            style={{ backgroundColor: cfg.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#6A6E72]">
                              <span className="text-sm font-medium text-[#222426]">{cfg.year}</span>
                              <span>·</span>
                              <span>{cfg.filmStock}</span>
                              <span>·</span>
                              <span>{rollCount} 卷静态 / {reelCount} 盘视频</span>
                            </div>
                            <p className="text-xs text-[#6A6E72] truncate">{cfg.seriesTheme}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleYear(cfg)}
                            disabled={busyAction === `year-${cfg.year}`}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border cursor-pointer ${
                              enabled
                                ? 'border-[#3E6B48]/35 bg-[#3E6B48]/10 text-[#28472F]'
                                : 'border-[#222426]/20 bg-[#EAE5DC] text-[#6A6E72]'
                            }`}
                          >
                            {enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            <span>{enabled ? '展柜显示中' : '展柜已隐藏'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingYear({ isNew: false, cfg: { ...cfg } })}
                            className="px-3 py-1.5 text-xs bg-[#222426] text-[#F6F3EE] cursor-pointer"
                          >
                            编辑主题
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteYear(cfg.year)}
                            disabled={busyAction === `del-year-${cfg.year}`}
                            aria-label="Delete year"
                            className="p-1.5 text-[#888C90] hover:text-[#9B3B2E] border border-[#222426]/12 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function editingRollOrReelCompat<T>(val: T): T {
  return val;
}
