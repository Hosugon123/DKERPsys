type PerfMetric = {
  name: string;
  durationMs?: number;
  startMs?: number;
  endMs?: number;
  details?: Record<string, unknown>;
};

type PerfWindow = Window & {
  __DONGSHAN_PERF__?: {
    enabled: boolean;
    displayMode: string;
    metrics: PerfMetric[];
    startedAt: number;
  };
};

const STORAGE_KEY = 'dongshan_performance_debug_v1';
const QUERY_KEY = 'perf';
const DEFAULT_SLOW_MS = 800;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function envFlag(): boolean {
  return String(import.meta.env.VITE_PERFORMANCE_DEBUG ?? '').toLowerCase() === 'true';
}

function slowThresholdMs(): number {
  const raw = Number(import.meta.env.VITE_PERFORMANCE_SLOW_MS ?? DEFAULT_SLOW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SLOW_MS;
}

function queryFlag(): boolean {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(QUERY_KEY)) return false;
    const value = String(url.searchParams.get(QUERY_KEY) ?? '1').toLowerCase();
    if (value === '0' || value === 'false' || value === 'off') {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    localStorage.setItem(STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function isPerformanceDebugEnabled(): boolean {
  if (typeof window === 'undefined') return envFlag();
  if (envFlag() || queryFlag()) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function detectDisplayMode(): string {
  if (typeof window === 'undefined') return 'unknown';
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return 'ios-standalone';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'standalone';
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return 'minimal-ui';
  return 'browser';
}

export function reportPerfMetric(metric: PerfMetric): void {
  if (typeof window === 'undefined') return;
  const w = window as PerfWindow;
  const enabled = isPerformanceDebugEnabled();
  if (!w.__DONGSHAN_PERF__) {
    w.__DONGSHAN_PERF__ = {
      enabled,
      displayMode: detectDisplayMode(),
      metrics: [],
      startedAt: now(),
    };
  }
  w.__DONGSHAN_PERF__.enabled = enabled;
  w.__DONGSHAN_PERF__.displayMode = detectDisplayMode();
  w.__DONGSHAN_PERF__.metrics.push(metric);
  if (!enabled) return;
  const prefix = metric.durationMs != null && metric.durationMs >= slowThresholdMs() ? '[perf:slow]' : '[perf]';
  console.info(prefix, metric.name, metric);
}

export function timeSync<T>(name: string, fn: () => T, details?: Record<string, unknown>): T {
  const startMs = now();
  try {
    return fn();
  } finally {
    const endMs = now();
    reportPerfMetric({ name, startMs, endMs, durationMs: endMs - startMs, details });
  }
}

export async function timeAsync<T>(
  name: string,
  fn: () => Promise<T>,
  details?: Record<string, unknown>,
): Promise<T> {
  const startMs = now();
  try {
    return await fn();
  } finally {
    const endMs = now();
    reportPerfMetric({ name, startMs, endMs, durationMs: endMs - startMs, details });
  }
}

function installFetchInstrumentation(): void {
  if (typeof window === 'undefined' || !isPerformanceDebugEnabled()) return;
  const w = window as Window & { __DONGSHAN_FETCH_INSTRUMENTED__?: boolean };
  if (w.__DONGSHAN_FETCH_INSTRUMENTED__) return;
  w.__DONGSHAN_FETCH_INSTRUMENTED__ = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const url = input instanceof Request ? input.url : String(input);
    return timeAsync(
      `fetch ${method} ${url}`,
      async () => {
        const res = await originalFetch(input, init);
        reportPerfMetric({
          name: `fetch-response ${method} ${url}`,
          details: {
            status: res.status,
            cacheControl: res.headers.get('cache-control'),
            serverTiming: res.headers.get('server-timing'),
          },
        });
        return res;
      },
      { method, url },
    );
  };
}

function installLongTaskObserver(): void {
  if (typeof window === 'undefined' || !isPerformanceDebugEnabled()) return;
  const AnyPerformanceObserver = window.PerformanceObserver as typeof PerformanceObserver | undefined;
  if (!AnyPerformanceObserver) return;
  try {
    const observer = new AnyPerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        reportPerfMetric({
          name: 'longtask',
          durationMs: entry.duration,
          startMs: entry.startTime,
          endMs: entry.startTime + entry.duration,
          details: { entryType: entry.entryType },
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    /* Browser does not support Long Task timing. */
  }
}

function installUnhandledPromiseProbe(): void {
  if (typeof window === 'undefined' || !isPerformanceDebugEnabled()) return;
  window.addEventListener('unhandledrejection', (event) => {
    reportPerfMetric({
      name: 'unhandledrejection',
      details: { reason: String(event.reason instanceof Error ? event.reason.message : event.reason) },
    });
  });
}

export function installPerformanceDebug(): void {
  if (typeof window === 'undefined') return;
  const enabled = isPerformanceDebugEnabled();
  (window as PerfWindow).__DONGSHAN_PERF__ = {
    enabled,
    displayMode: detectDisplayMode(),
    metrics: [],
    startedAt: now(),
  };
  reportPerfMetric({
    name: 'app.bootstrap',
    startMs: 0,
    endMs: now(),
    durationMs: now(),
    details: {
      displayMode: detectDisplayMode(),
      userAgent: navigator.userAgent,
      buildId: typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'unknown',
    },
  });
  installFetchInstrumentation();
  installLongTaskObserver();
  installUnhandledPromiseProbe();
  window.addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    reportPerfMetric({
      name: 'window.load',
      durationMs: nav ? nav.loadEventEnd : now(),
      details: nav
        ? {
            domContentLoadedMs: nav.domContentLoadedEventEnd,
            responseEndMs: nav.responseEnd,
            transferSize: nav.transferSize,
          }
        : undefined,
    });
  });
}
