export const USER_ERROR_REPORTED_EVENT = 'dongshanUserErrorReported';

export type UserErrorSeverity = 'warning' | 'error';

export type UserErrorReport = {
  id: string;
  title: string;
  message: string;
  severity: UserErrorSeverity;
  source?: string;
  page?: string;
  action?: string;
  field?: string;
  technicalDetail?: string;
  occurredAt: string;
  url?: string;
  userAgent?: string;
};

type ReportInput = {
  title?: string;
  message?: string;
  severity?: UserErrorSeverity;
  source?: string;
  page?: string;
  action?: string;
  field?: string;
  error?: unknown;
  technicalDetail?: string;
};

function getErrorParts(error: unknown, fallbackMessage?: string): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'string') return { name: '', message: error };
  if (error && typeof error === 'object') {
    const obj = error as { name?: unknown; message?: unknown };
    return {
      name: typeof obj.name === 'string' ? obj.name : '',
      message: typeof obj.message === 'string' ? obj.message : fallbackMessage ?? '',
    };
  }
  return { name: '', message: fallbackMessage ?? '' };
}

export function shouldSuppressGlobalError(input: { error?: unknown; message?: string }): boolean {
  const { name, message } = getErrorParts(input.error, input.message);
  const normalizedName = name.trim().toLowerCase();
  const normalizedMessage = message.trim().toLowerCase();

  if (!input.error && !normalizedMessage) return true;
  if (normalizedName === 'aborterror') return true;
  if (normalizedMessage === 'script error.') return true;
  if (normalizedMessage.includes('resizeobserver loop')) return true;
  if (normalizedMessage.includes('the user aborted a request')) return true;
  if (normalizedMessage.includes('operation was aborted')) return true;
  if (normalizedMessage.includes('request was cancelled')) return true;
  if (normalizedMessage.includes('request was canceled')) return true;

  return false;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return [error.name, error.message, error.stack].filter(Boolean).join('\n');
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function defaultMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '系統遇到未預期狀況，請截圖或複製錯誤資訊後回報管理員。';
}

export function buildUserErrorReport(input: ReportInput): UserErrorReport {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title?.trim() || (input.severity === 'warning' ? '資料需要確認' : '系統操作發生錯誤'),
    message: input.message?.trim() || defaultMessage(input.error),
    severity: input.severity ?? 'error',
    source: input.source,
    page: input.page,
    action: input.action,
    field: input.field,
    technicalDetail: input.technicalDetail ?? (input.error == null ? undefined : stringifyError(input.error)),
    occurredAt: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

export function reportUserError(input: ReportInput): UserErrorReport {
  const report = buildUserErrorReport(input);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USER_ERROR_REPORTED_EVENT, { detail: report }));
  }
  return report;
}

export function formatUserErrorReport(report: UserErrorReport): string {
  return [
    `標題：${report.title}`,
    `訊息：${report.message}`,
    report.page ? `頁面：${report.page}` : undefined,
    report.action ? `操作：${report.action}` : undefined,
    report.field ? `欄位：${report.field}` : undefined,
    report.source ? `來源：${report.source}` : undefined,
    `時間：${report.occurredAt}`,
    report.url ? `網址：${report.url}` : undefined,
    report.userAgent ? `裝置：${report.userAgent}` : undefined,
    report.technicalDetail ? `技術資訊：\n${report.technicalDetail}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}
