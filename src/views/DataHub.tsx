import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { Braces, Download, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { UserRole } from './Orders';
import { DONGSHAN_APP_ID, DONGSHAN_EXPORT_STORAGE_KEYS, parseBundleJson } from '../lib/appDataBundle';
import { dataBundle } from '../services/apiService';
import { cn } from '../lib/utils';

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `dongshan-data-${stamp}.json`;
}

export default function DataHub({ userRole }: { userRole: UserRole }) {
  const isAdmin = userRole === 'admin';
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onExport = useCallback(() => {
    setMessage(null);
    void (async () => {
      const text = await dataBundle.serialize();
      downloadJson(exportFilename(), text);
      const meta = await dataBundle.build();
      setMessage({
        kind: 'ok',
        text: `已匯出 ${meta.exportedAt.slice(0, 19).replace('T', ' ')}（${DONGSHAN_APP_ID}），共 ${DONGSHAN_EXPORT_STORAGE_KEYS.length} 個儲存槽位。`,
      });
    })();
  }, []);

  const onPickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFile = useCallback((ev: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        try {
          const text = String(reader.result ?? '');
          const raw = parseBundleJson(text);
          const result = await dataBundle.importBundle(raw);
          if (result.ok === false) {
            setMessage({ kind: 'err', text: result.error });
            return;
          }
          setMessage({
            kind: 'ok',
            text: `匯入完成，已寫入 ${result.importedKeyCount} 個 localStorage 鍵。請確認各頁資料是否正確。`,
          });
        } catch {
          setMessage({ kind: 'err', text: '無法解析 JSON，請確認檔案未損毀。' });
        }
      })();
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-400 text-sm">
        數據中心僅限超級管理員使用。
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div>
        <div className="flex items-center gap-2 text-amber-500/90 mb-1">
          <Braces size={22} className="shrink-0" />
          <span className="text-sm font-medium tracking-wide">JSON</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight">數據中心</h2>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
          以標準 JSON 匯出／匯入本機資料（訂單、產品庫、流水帳、盤點與偏好設定等）。匯出檔可交給 ChatGPT、Claude
          等工具分析；匯入會覆寫對應之瀏覽器儲存槽，請先備份。
        </p>
      </div>

      <div className="rounded-2xl border border-amber-900/25 bg-amber-950/20 px-4 py-3 flex gap-3 text-sm text-amber-200/90">
        <AlertTriangle className="shrink-0 mt-0.5 text-amber-500" size={18} />
        <p>
          匯入前建議先使用「匯出 JSON」備份。單筆資料已盡量包含 <code className="text-amber-100/95">id</code>、
          <code className="text-amber-100/95">createdAt</code>、<code className="text-amber-100/95">updatedAt</code>{' '}
         （訂單、流水帳、自訂品項等），便於外部工具與未來 API 對接。
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Download size={18} className="text-emerald-400" />
              匯出 JSON 數據
            </h3>
            <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
              下載完整快照（鍵：{DONGSHAN_EXPORT_STORAGE_KEYS.length}）。格式欄位{' '}
              <code className="text-zinc-400">format: dongshan-localStorage-snapshot-v1</code>。
            </p>
          </div>
          <button
            type="button"
            onClick={onExport}
            className="mt-auto px-4 py-2.5 rounded-xl bg-emerald-700/90 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
          >
            下載 JSON
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Upload size={18} className="text-sky-400" />
              匯入 JSON 數據
            </h3>
            <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
              選擇先前匯出或經 AI 調整過的 bundle（僅寫入白名單內之 localStorage 鍵）。
            </p>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={onPickFile}
            className="mt-auto px-4 py-2.5 rounded-xl border border-sky-700/60 bg-sky-950/40 hover:bg-sky-950/60 text-sky-200 text-sm font-semibold transition-colors"
          >
            選擇檔案並匯入
          </button>
        </section>
      </div>

      {message ? (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm flex items-start gap-2',
            message.kind === 'ok'
              ? 'border-emerald-800/50 bg-emerald-950/25 text-emerald-200/95'
              : 'border-rose-800/50 bg-rose-950/25 text-rose-200/95'
          )}
          role="status"
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400 mt-0.5" />
          ) : (
            <AlertTriangle size={18} className="shrink-0 text-rose-400 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}
    </div>
  );
}
