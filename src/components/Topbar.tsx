import { Bell, Settings, Menu, Search, ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { accounts } from '../services/apiService';
import { getSessionActorDisplayName } from '../lib/sessionActorDisplayName';
import {
  DEFAULT_PWA_ICON_URL,
  getCustomPwaIconDataUrl,
  getEffectivePwaIconUrl,
  normalizePwaIconFile,
  PWA_ICON_UPDATED_EVENT,
  removeCustomPwaIcon,
  setCustomPwaIconDataUrl,
} from '../lib/pwaIconStorage';
import { getUserAvatar, removeUserAvatar, setUserAvatar } from '../lib/userAvatarStorage';
import type { UserRole } from '../views/Orders';
import RemoteSyncIndicator from './RemoteSyncIndicator';

interface TopbarProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (isOpen: boolean) => void;
  loginId: string;
  userRole: UserRole;
  onLogout: () => void;
}

export default function Topbar({
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  loginId,
  userRole,
  onLogout,
}: TopbarProps) {
  const DEFAULT_AVATAR = `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(
    loginId
  )}&backgroundColor=27272a`;
  const roleDisplayNames: Record<UserRole, string> = {
    admin: 'BOSS',
    franchisee: '加盟主',
    employee: '直營店員工',
  };

  const actorDisplayName = getSessionActorDisplayName();

  const [accountOpen, setAccountOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pwaIconUrl, setPwaIconUrl] = useState(DEFAULT_PWA_ICON_URL);
  const [pwaIconBusy, setPwaIconBusy] = useState(false);
  const [pwaIconError, setPwaIconError] = useState<string | null>(null);
  const [pwaIconIsCustom, setPwaIconIsCustom] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const pwaIconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarUrl(getUserAvatar(loginId));
    setAvatarError(null);
  }, [loginId]);

  const refreshPwaIconPreview = () => {
    setPwaIconUrl(getEffectivePwaIconUrl());
    setPwaIconIsCustom(getCustomPwaIconDataUrl() != null);
  };

  useEffect(() => {
    refreshPwaIconPreview();
    const h = () => refreshPwaIconPreview();
    window.addEventListener(PWA_ICON_UPDATED_EVENT, h);
    return () => window.removeEventListener(PWA_ICON_UPDATED_EVENT, h);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    refreshPwaIconPreview();
    setPwaIconError(null);
  }, [settingsOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const fn = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [accountOpen]);

  const openSettings = () => {
    setPwaIconError(null);
    setSettingsOpen(true);
    setAccountOpen(false);
  };

  const openPwd = () => {
    setPwdError(null);
    setCurPwd('');
    setNewPwd('');
    setNewPwd2('');
    setPwdOpen(true);
    setAccountOpen(false);
    setSettingsOpen(false);
  };

  const submitPwd = async (e: FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPwd !== newPwd2) {
      setPwdError('兩次新密碼輸入不一致。');
      return;
    }
    setPwdBusy(true);
    try {
      await accounts.changeOwnPassword(loginId, curPwd, newPwd);
      setPwdOpen(false);
      setCurPwd('');
      setNewPwd('');
      setNewPwd2('');
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : '變更失敗');
    } finally {
      setPwdBusy(false);
    }
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('讀取圖片失敗，請稍後再試。'));
      };
      reader.onerror = () => reject(new Error('讀取圖片失敗，請稍後再試。'));
      reader.readAsDataURL(file);
    });

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('圖片格式不支援，請改用 JPG / PNG / WEBP。'));
      img.src = src;
    });

  const normalizeAvatar = async (file: File): Promise<string> => {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const target = 256;
    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法處理圖片，請稍後再試。');
    const crop = Math.min(img.width, img.height);
    const sx = Math.floor((img.width - crop) / 2);
    const sy = Math.floor((img.height - crop) / 2);
    ctx.drawImage(img, sx, sy, crop, crop, 0, 0, target, target);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const chooseAvatarFile = () => {
    setAvatarError(null);
    avatarInputRef.current?.click();
  };

  const onAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAvatarError('請選擇圖片檔案（JPG / PNG / WEBP）。');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setAvatarError('圖片過大，請使用 6MB 以下檔案。');
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const normalized = await normalizeAvatar(file);
      setUserAvatar(loginId, normalized);
      setAvatarUrl(normalized);
      setAccountOpen(false);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : '上傳失敗，請稍後再試。');
    } finally {
      setAvatarBusy(false);
    }
  };

  const onRemoveAvatar = () => {
    removeUserAvatar(loginId);
    setAvatarUrl(null);
    setAvatarError(null);
    setAccountOpen(false);
  };

  const choosePwaIconFile = () => {
    setPwaIconError(null);
    pwaIconInputRef.current?.click();
  };

  const onPwaIconSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPwaIconError('請選擇圖片檔案（JPG / PNG / WEBP）。');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setPwaIconError('圖片過大，請使用 8MB 以下檔案。');
      return;
    }
    setPwaIconBusy(true);
    setPwaIconError(null);
    try {
      const normalized = await normalizePwaIconFile(file);
      setCustomPwaIconDataUrl(normalized);
      setPwaIconUrl(normalized);
      setPwaIconIsCustom(true);
    } catch (err) {
      setPwaIconError(err instanceof Error ? err.message : '上傳失敗，請稍後再試。');
    } finally {
      setPwaIconBusy(false);
    }
  };

  const onResetPwaIcon = () => {
    removeCustomPwaIcon();
    refreshPwaIconPreview();
    setPwaIconError(null);
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#111111] pt-[env(safe-area-inset-top)]">
        <div className="flex h-12 sm:h-14 lg:h-16 items-center justify-between px-3 sm:px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="開啟選單"
              aria-expanded={isMobileMenuOpen}
              aria-controls="app-sidebar-drawer"
              className="-ml-1 flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 md:hidden"
            >
              <Menu size={22} />
            </button>
            <div className="hidden min-w-0 truncate text-lg font-black tracking-tighter text-[#f5f2ed] sm:block">
              達客東山鴨頭管理系統
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="搜尋系統..."
                className="w-64 rounded-full border border-zinc-800 bg-zinc-900 py-2 pl-10 pr-4 text-sm text-zinc-300 outline-none transition-all placeholder-zinc-500 focus:border-amber-500"
              />
            </div>

            <div className="hidden items-center gap-1.5 sm:flex">
              <RemoteSyncIndicator className="mr-0.5" />
              <button
                type="button"
                className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800"
                aria-label="通知（尚未啟用）"
              >
                <Bell size={20} />
              </button>
            </div>
            <div className="flex items-center sm:hidden">
              <RemoteSyncIndicator className="mr-1" />
            </div>
            <input
              ref={pwaIconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPwaIconSelected}
            />
            <button
              type="button"
              onClick={openSettings}
              className="rounded-full p-1.5 sm:p-2 text-zinc-400 transition-colors hover:bg-zinc-800"
              aria-label="系統設定"
            >
              <Settings size={18} className="sm:w-5 sm:h-5" />
            </button>

            <div className="relative ml-0 flex shrink-0 items-center sm:ml-1" ref={accountRef}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onAvatarSelected}
              />
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                className="flex h-9 max-w-[min(52vw,11rem)] items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2 py-0 text-left transition-colors hover:bg-zinc-800/80 sm:h-11 sm:max-w-[14rem] sm:gap-2 sm:rounded-xl sm:px-3"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                title={`已登入 ${actorDisplayName || loginId}`}
              >
                <div className="min-w-0 flex-1 leading-none py-1 sm:py-0 sm:leading-tight">
                  <p className="truncate text-[11px] font-semibold text-amber-500 sm:text-sm">
                    {actorDisplayName || loginId}
                  </p>
                  <p className="truncate text-[0.6rem] sm:text-[0.65rem] text-zinc-500">
                    {actorDisplayName ? `${loginId} · ${roleDisplayNames[userRole]}` : roleDisplayNames[userRole]}
                  </p>
                </div>
                <ChevronDown size={14} className="shrink-0 text-amber-500/90 sm:w-4 sm:h-4" />
              </button>
              {accountOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+0.25rem)] z-50 min-w-[11rem] rounded-xl border border-zinc-800 bg-[#141414] py-1 shadow-xl shadow-black/50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={chooseAvatarFile}
                    disabled={avatarBusy}
                    className="flex w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {avatarBusy ? '上傳中…' : '上傳大頭照'}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={onRemoveAvatar}
                      className="flex w-full px-4 py-2.5 text-left text-sm text-zinc-400 hover:bg-zinc-800"
                    >
                      移除大頭照
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openPwd}
                    className="flex w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    變更密碼
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      onLogout();
                    }}
                    className="flex w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-950/40"
                  >
                    登出系統
                  </button>
                </div>
              )}
            </div>
            {avatarError && <p className="hidden max-w-[11rem] text-[0.6875rem] text-rose-400 sm:block">{avatarError}</p>}

            <div className="ml-0.5 hidden h-11 w-11 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 sm:flex sm:items-center sm:justify-center">
              <img
                src={avatarUrl ?? DEFAULT_AVATAR}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </header>

      {settingsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-settings-title"
            className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl max-h-[min(90dvh,40rem)] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 sticky top-0 bg-zinc-900 z-10">
              <h2 id="app-settings-title" className="text-lg font-bold text-[#f5f2ed]">
                系統設定
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="關閉"
              >
                <X size={22} />
              </button>
            </div>
            <div className="space-y-6 px-5 py-5">
              <section>
                <h3 className="text-sm font-semibold text-amber-500/90 mb-1">主畫面 App 圖示</h3>
                <p className="text-xs text-zinc-500 leading-relaxed mb-3">
                  用於 iPhone「加入主畫面」後的圖示。更換後請刪除舊捷徑，再從 Safari 重新加入主畫面才會更新。
                </p>
                {pwaIconError && (
                  <p className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                    {pwaIconError}
                  </p>
                )}
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800 shadow-inner">
                    <img src={pwaIconUrl} alt="目前主畫面圖示預覽" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex flex-col gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={choosePwaIconFile}
                      disabled={pwaIconBusy}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"
                    >
                      {pwaIconBusy ? '處理中…' : '上傳新圖示'}
                    </button>
                    {pwaIconIsCustom && (
                      <button
                        type="button"
                        onClick={onResetPwaIcon}
                        disabled={pwaIconBusy}
                        className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        恢復預設圖示
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[0.6875rem] text-zinc-600">
                  建議正方形、512×512 以上；系統會自動裁切置中。
                </p>
              </section>

              <section className="border-t border-zinc-800 pt-5">
                <h3 className="text-sm font-semibold text-zinc-400 mb-2">帳號</h3>
                <button
                  type="button"
                  onClick={openPwd}
                  className="w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  變更密碼
                </button>
              </section>
            </div>
          </div>
        </div>
      )}

      {pwdOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chg-pw-title"
            className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h2 id="chg-pw-title" className="text-lg font-bold text-[#f5f2ed]">
                變更密碼
              </h2>
              <button
                type="button"
                onClick={() => setPwdOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="關閉"
              >
                <X size={22} />
              </button>
            </div>
            <form onSubmit={submitPwd} className="space-y-4 px-5 py-5">
              {pwdError && (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{pwdError}</p>
              )}
              <div>
                <label className="mb-1 block text-sm text-zinc-400">目前密碼</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={curPwd}
                  onChange={(e) => setCurPwd(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">新密碼（至少 4 字元）</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">確認新密碼</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPwd2}
                  onChange={(e) => setNewPwd2(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwdOpen(false)}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pwdBusy}
                  className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"
                >
                  {pwdBusy ? '處理中…' : '確認變更'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
