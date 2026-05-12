import { useState, type FormEvent } from 'react';
import { Lock, User } from 'lucide-react';
import { tryLogin } from '../lib/authSession';
import RemoteSyncIndicator from '../components/RemoteSyncIndicator';
import ForgotPasswordModal from './ForgotPasswordModal';

type LoginScreenProps = {
  onSuccess: () => void;
};

export default function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = tryLogin(loginId, password);
    setBusy(false);
    if (r.ok) onSuccess();
    else setError(r.message);
  };

  return (
    <div className="relative min-h-[100dvh] flex flex-col items-center justify-center bg-[#0d0d0d] text-[#f5f2ed] px-4 py-10 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-center gap-2">
        <RemoteSyncIndicator />
      </div>
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#111111] p-8 shadow-xl shadow-black/40">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/30">
            <img
              src="/brand-logo-v2.png"
              alt="達客東山鴨頭 Logo"
              className="h-full w-full object-contain p-1"
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight">達客東山鴨頭訂單系統</h1>
        </div>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">登入帳號</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                autoComplete="username"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 py-2.5 pl-10 pr-4 text-[#f5f2ed] outline-none transition-colors focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">密碼</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 py-2.5 pl-10 pr-4 text-[#f5f2ed] outline-none transition-colors focus:border-amber-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-amber-600 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? '登入中…' : '登入系統'}
          </button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm text-amber-500/90 underline-offset-4 hover:text-amber-400 hover:underline"
            >
              忘記密碼？（信箱驗證）
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
