import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import type { UserRole } from './Orders';
import { DONGSHAN_APP_ID, DONGSHAN_EXPORT_STORAGE_KEYS, parseBundleJson } from '../lib/appDataBundle';
import { dataBundle } from '../services/apiService';
import { getApiBaseUrl, getApiSyncToken, getStorageMode } from '../services/storageMode';
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
  const [syncCheckRunning, setSyncCheckRunning] = useState(false);
  const [syncCheckReport, setSyncCheckReport] = useState<string[]>([]);

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

  const onSyncHealthCheck = useCallback(() => {
    setMessage(null);
    setSyncCheckReport([]);
    setSyncCheckRunning(true);
    void (async () => {
      const logs: string[] = [];
      const mode = getStorageMode();
      const base = getApiBaseUrl();
      const token = getApiSyncToken();

      logs.push(`儲存模式：${mode}`);
      logs.push(`API Base：${base}`);
      logs.push(`前端 Token：${token ? `已設定（長度 ${token.length}）` : '未設定'}`);

      if (mode !== 'remote') {
        logs.push('中止：VITE_STORAGE_MODE 不是 remote。');
        setSyncCheckReport(logs);
        setSyncCheckRunning(false);
        return;
      }
      if (!token) {
        logs.push('中止：VITE_API_SYNC_TOKEN 未設定。');
        setSyncCheckReport(logs);
        setSyncCheckRunning(false);
        return;
      }

      try {
        const getRes = await fetch(`${base}/sync-bundle`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        logs.push(`GET /sync-bundle：HTTP ${getRes.status}`);
        const getBodyText = await getRes.text();
        logs.push(`GET 回應：${getBodyText.slice(0, 280) || '(empty)'}`);
        if (!getRes.ok) {
          setSyncCheckReport(logs);
          setSyncCheckRunning(false);
          return;
        }

        let getBody: unknown = null;
        try {
          getBody = JSON.parse(getBodyText);
        } catch {
          logs.push('中止：GET 回應不是合法 JSON。');
          setSyncCheckReport(logs);
          setSyncCheckRunning(false);
          return;
        }
        const bundle = (getBody as { bundle?: unknown })?.bundle;
        if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
          logs.push('中止：GET 回應缺少合法 bundle。');
          setSyncCheckReport(logs);
          setSyncCheckRunning(false);
          return;
        }

        const putRes = await fetch(`${base}/sync-bundle`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ bundle }),
        });
        logs.push(`PUT /sync-bundle：HTTP ${putRes.status}`);
        const putBodyText = await putRes.text();
        logs.push(`PUT 回應：${putBodyText.slice(0, 280) || '(empty)'}`);

        if (putRes.ok) {
          logs.push('檢查完成：GET/PUT 皆成功，API 路由與授權看起來正常。');
        } else {
          logs.push('檢查完成：PUT 失敗，請依上方 HTTP 狀態碼與回應訊息排查。');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logs.push(`請求失敗：${msg}`);
      } finally {
        setSyncCheckReport(logs);
        setSyncCheckRunning(false);
      }
    })();
  }, []);

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400 text-sm">
        數據中心僅限超級管理員使用。
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Database className="text-amber-500 shrink-0" size={28} />
          數據中心
        </h2>
      </div>

      <div className="rounded-2xl border border-amber-900/25 bg-amber-950/20 px-4 py-3 flex gap-3 text-sm text-amber-200/90">
        <AlertTriangle className="shrink-0 mt-0.5 text-amber-500" size={18} />
        <p>
          匯入前建議先使用「匯出 JSON」備份。單筆資料已盡量包含 <code className="text-amber-100/95">id</code>、
          <code className="text-amber-100/95">createdAt</code>、<code className="text-amber-100/95">updatedAt</code>{' '}
         （訂單、流水帳、自訂品項等），便於外部工具與未來 API 對接。
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
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
              <Upload size={18} className="text-amber-400" />
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
            className="mt-auto px-4 py-2.5 rounded-xl border border-amber-700/60 bg-amber-950/40 hover:bg-amber-950/60 text-amber-200 text-sm font-semibold transition-colors"
          >
            選擇檔案並匯入
          </button>
        </section>
      </div>

      <section className="rounded-2xl border border-amber-900/40 bg-amber-950/15 p-5 space-y-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">雲端同步自我檢查（Vercel）</h3>
          <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
            檢查目前瀏覽器設定是否能成功呼叫 <code className="text-zinc-400">GET/PUT /api/sync-bundle</code>。
            會顯示 HTTP 狀態碼與回應內容，用來快速定位是 token、路由或 KV 問題。
          </p>
        </div>
        <button
          type="button"
          onClick={onSyncHealthCheck}
          disabled={syncCheckRunning}
          className={cn(
            'px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors',
            syncCheckRunning
              ? 'bg-zinc-800 text-zinc-500 cursor-wait'
              : 'bg-amber-700/80 hover:bg-amber-600 text-zinc-950'
          )}
        >
          {syncCheckRunning ? '檢查中…' : '開始檢查同步'}
        </button>
        {syncCheckReport.length > 0 ? (
          <pre className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words">
            {syncCheckReport.join('\n')}
          </pre>
        ) : null}
      </section>

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
