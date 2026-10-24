export class RemoteWritePendingError<T = unknown> extends Error {
  constructor(readonly localResult: T, cause: unknown) {
    super(`資料已儲存在此裝置，但尚未完成雲端同步，系統會重試。請勿重複送單，並保留此裝置的網站資料。${cause instanceof Error ? `原因：${cause.message}` : ''}`, { cause });
    this.name = 'RemoteWritePendingError';
  }
}
