import { Bell, Settings, Menu, Search, ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { changeOwnPassword } from '../lib/authSession';
import { getSessionActorDisplayName } from '../lib/sessionActorDisplayName';
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

  const accountRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarUrl(getUserAvatar(loginId));
    setAvatarError(null);
  }, [loginId]);

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

  const openPwd = () => {
    setPwdError(null);
    setCurPwd('');
    setNewPwd('');
    setNewPwd2('');
    setPwdOpen(true);
    setAccountOpen(false);
  };

  const submitPwd = (e: FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPwd !== newPwd2) {
      setPwdError('兩次新密碼輸入不一致。');
      return;
    }
    setPwdBusy(true);
    try {
      changeOwnPassword(loginId, curPwd, newPwd);
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

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#111111] pt-[env(safe-area-inset-top)]">
        <div className="flex h-16 items-center justify-between px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="開啟選單"
              aria-expanded={isMobileMenuOpen}
              aria-controls="app-sidebar-drawer"
              className="-ml-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 md:hidden"
            >
              <Menu size={24} />
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
            <button
              type="button"
              onClick={openPwd}
              className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800"
              aria-label="變更密碼"
            >
              <Settings size={20} />
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
                className="flex h-11 max-w-[min(56vw,12rem)] items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-0 text-left transition-colors hover:bg-zinc-800/80 sm:h-11 sm:max-w-[14rem] sm:gap-2 sm:px-3"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                title={`已登入 ${actorDisplayName || loginId}`}
              >
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-xs font-semibold text-amber-500 sm:text-sm">
                    {actorDisplayName || loginId}
                  </p>
                  <p className="truncate text-[0.65rem] text-zinc-500">
                    {actorDisplayName ? `${loginId} · ${roleDisplayNames[userRole]}` : roleDisplayNames[userRole]}
                  </p>
                </div>
                <ChevronDown size={16} className="shrink-0 text-amber-500/90" />
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
