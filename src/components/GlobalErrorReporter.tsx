import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Copy, X } from 'lucide-react';
import {
  formatUserErrorReport,
  reportUserError,
  shouldSuppressGlobalError,
  USER_ERROR_REPORTED_EVENT,
  type UserErrorReport,
} from '../lib/userErrorReport';

type GlobalErrorReporterProps = {
  currentView?: string;
  loginId?: string;
  children?: ReactNode;
};

function describeTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const direct =
    target.getAttribute('aria-label') ||
    target.getAttribute('placeholder') ||
    target.getAttribute('name') ||
    target.id;
  if (direct?.trim()) return direct.trim();
  const label = target.closest('label');
  const labelText = label?.textContent?.replace(/\s+/g, ' ').trim();
  if (labelText) return labelText.slice(0, 80);
  return target.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
}

function friendlyPageName(view?: string): string {
  const map: Record<string, string> = {
    loading: '系統啟動',
    login: '登入',
    dashboard: '營運概況',
    orders: '訂單管理',
    products: '產品與成本庫存',
    permissions: '權限編輯',
    procurement: '批貨與下單',
    stallInventory: '攤上盤點',
    salesRecord: '銷售紀錄',
    accounting: '收入與支出',
    dataHub: '數據中心',
  };
  return view ? map[view] ?? view : '未知頁面';
}

export default function GlobalErrorReporter({
  currentView,
  loginId,
  children,
}: GlobalErrorReporterProps) {
  const [report, setReport] = useState<UserErrorReport | null>(null);
  const [copied, setCopied] = useState(false);
  const lastInvalidReportRef = useRef<{ key: string; at: number } | null>(null);
  const page = friendlyPageName(currentView);

  useEffect(() => {
    const onReported = (event: Event) => {
      const detail = (event as CustomEvent<UserErrorReport>).detail;
      if (!detail) return;
      setCopied(false);
      setReport({
        ...detail,
        page: detail.page ?? page,
        source: detail.source ?? (loginId ? `登入帳號 ${loginId}` : undefined),
      });
    };
    window.addEventListener(USER_ERROR_REPORTED_EVENT, onReported);
    return () => window.removeEventListener(USER_ERROR_REPORTED_EVENT, onReported);
  }, [loginId, page]);

  useEffect(() => {
    const onInvalid = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
        return;
      }
      const field = describeTarget(target);
      const message = target.validationMessage || '有欄位未填或格式不正確，請依照提示修正後再送出。';
      const dedupeKey = `${page}|${field ?? ''}|${message}`;
      const now = Date.now();
      const last = lastInvalidReportRef.current;
      if (last?.key === dedupeKey && now - last.at < 2000) return;
      lastInvalidReportRef.current = { key: dedupeKey, at: now };

      reportUserError({
        severity: 'warning',
        title: '欄位資料需要補齊',
        message,
        page,
        action: '表單送出',
        field,
        source: loginId ? `登入帳號 ${loginId}` : undefined,
      });
    };
    const onError = (event: ErrorEvent) => {
      if (shouldSuppressGlobalError({ error: event.error, message: event.message })) return;
      reportUserError({
        severity: 'error',
        title: '系統發生未預期錯誤',
        message: event.message || '畫面操作時發生錯誤，請截圖或複製錯誤資訊後回報管理員。',
        page,
        action: describeTarget(document.activeElement),
        source: loginId ? `登入帳號 ${loginId}` : undefined,
        error: event.error,
        technicalDetail: `${event.filename}:${event.lineno}:${event.colno}\n${event.message}`,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (shouldSuppressGlobalError({ error: event.reason })) return;
      reportUserError({
        severity: 'error',
        title: '系統操作未完成',
        message: event.reason instanceof Error ? event.reason.message : '操作發生未預期錯誤，請截圖或複製錯誤資訊後回報管理員。',
        page,
        action: describeTarget(document.activeElement),
        source: loginId ? `登入帳號 ${loginId}` : undefined,
        error: event.reason,
      });
    };
    document.addEventListener('invalid', onInvalid, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [loginId, page]);

  const reportText = useMemo(() => (report ? formatUserErrorReport(report) : ''), [report]);

  const copyReport = async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard?.writeText(reportText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      {children}
      {report && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="global-error-title"
            className="w-full max-w-lg rounded-2xl border border-amber-300/60 bg-[#fffaf3] p-5 text-[#2b2118] shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-1 rounded-full bg-amber-100 p-2 text-amber-700">
                <AlertTriangle size={24} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="global-error-title" className="text-xl font-semibold">
                  {report.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-[#4b4036]">
                  {report.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReport(null)}
                className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="關閉錯誤訊息"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-white/70 p-3 text-sm">
              <dt className="text-zinc-500">頁面</dt>
              <dd>{report.page ?? page}</dd>
              {report.action && (
                <>
                  <dt className="text-zinc-500">操作</dt>
                  <dd>{report.action}</dd>
                </>
              )}
              {report.field && (
                <>
                  <dt className="text-zinc-500">欄位</dt>
                  <dd>{report.field}</dd>
                </>
              )}
              <dt className="text-zinc-500">時間</dt>
              <dd className="font-mono text-xs">{report.occurredAt}</dd>
            </dl>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setReport(null)}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-3 font-medium text-zinc-700 hover:bg-zinc-50"
              >
                我知道了
              </button>
              <button
                type="button"
                onClick={() => void copyReport()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 font-semibold text-white hover:bg-amber-700"
              >
                <Copy size={18} aria-hidden="true" />
                {copied ? '已複製' : '複製錯誤資訊'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
