import { useState, type FormEvent } from 'react';
import { Mail, X, KeyRound, ArrowLeft } from 'lucide-react';
import { accounts } from '../services/apiService';
import { shouldRevealResetCodeInUi } from '../lib/passwordResetOtp';

type ForgotPasswordModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [step, setStep] = useState<'email' | 'verify' | 'done'>('email');
  const [revealCode, setRevealCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetAndClose = () => {
    setEmail('');
    setCode('');
    setNewPassword('');
    setNewPassword2('');
    setStep('email');
    setRevealCode(null);
    setError(null);
    setBusy(false);
    onClose();
  };

  const handleClose = () => {
    if (busy) return;
    resetAndClose();
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    setRevealCode(null);
    try {
      const r = await accounts.passwordReset.requestCode(email);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setCode('');
      setRevealCode(r.revealCode ?? null);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : '寄送失敗');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== newPassword2) {
      setError('兩次新密碼輸入不一致。');
      return;
    }
    setBusy(true);
    try {
      const r = await accounts.passwordReset.confirm(email, code, newPassword);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重設失敗');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const showDevHint = shouldRevealResetCodeInUi();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-pw-title"
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#111111] shadow-xl max-h-[92dvh] sm:max-h-[88dvh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5 sm:py-4">
          <h2 id="forgot-pw-title" className="text-lg font-bold text-[#f5f2ed]">
            忘記密碼
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
            aria-label="關閉"
          >
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {step === 'done' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-emerald-400">密碼已更新，請返回使用新密碼登入。</p>
              <button
                type="button"
                onClick={resetAndClose}
                className="w-full rounded-lg bg-amber-600 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-500"
              >
                返回登入
              </button>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={(e) => void sendCode(e)} className="space-y-4">
              <p className="text-sm text-zinc-500">
                請輸入您於系統中登記的<strong className="text-zinc-400">電子信箱</strong>
                ，我們將寄送驗證碼以重設登入密碼。
              </p>
              {error && (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">電子信箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 py-2.5 pl-10 pr-4 text-[#f5f2ed] outline-none focus:border-amber-500"
                    placeholder="name@example.com"
                  />
                </div>
              </div>
              {showDevHint && (
                <p className="rounded-lg border border-amber-900/40 bg-amber-950/25 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-200/90">
                  目前未設定郵件寄送 API，驗證碼會在下一步顯示於畫面上（等同簡訊／郵件內容的示範）。正式上線請設定{' '}
                  <span className="font-mono text-amber-100/90">VITE_PASSWORD_RESET_EMAIL_URL</span> 由後端寄信，並將{' '}
                  <span className="font-mono">VITE_SHOW_RESET_CODE</span> 設為 false。
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-amber-600 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"
              >
                {busy ? '處理中…' : '寄送驗證碼'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void submitReset(e)} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  setStep('email');
                  setError(null);
                  setCode('');
                  setRevealCode(null);
                }}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-400"
              >
                <ArrowLeft size={14} /> 更改信箱
              </button>
              <p className="text-sm text-zinc-500">
                {showDevHint ? (
                  <>驗證碼已產生，請於下方輸入示範驗證碼與新密碼（本機未串郵件 API）。</>
                ) : (
                  <>
                    已請後端寄送驗證碼至 <span className="font-medium text-zinc-300">{email.trim()}</span>
                    （若未收到請查垃圾郵件匣）。請輸入信中的 {6} 位數驗證碼與新密碼。
                  </>
                )}
              </p>
              {revealCode && (
                <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-center">
                  <p className="text-[0.625rem] uppercase tracking-wider text-amber-500/90">示範用驗證碼（非實際郵件）</p>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-amber-300">{revealCode}</p>
                </div>
              )}
              {error && (
                <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">驗證碼</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 py-2.5 pl-10 pr-4 font-mono text-lg tracking-widest text-[#f5f2ed] outline-none focus:border-amber-500"
                    placeholder="000000"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">新密碼（至少 4 字元）</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">確認新密碼</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword2}
                  onChange={(e) => setNewPassword2(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-[#f5f2ed] outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendCode()}
                  className="flex-1 rounded-lg border border-zinc-600 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  重新寄送驗證碼
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 rounded-lg bg-amber-600 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-500 disabled:opacity-50"
                >
                  {busy ? '處理中…' : '確認重設密碼'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
