/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_STORAGE_MODE?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_API_SYNC_TOKEN?: string;
  readonly VITE_ASYNC_STORAGE_DELAY_MS?: string;
  readonly VITE_PERFORMANCE_DEBUG?: string;
  readonly VITE_PERFORMANCE_SLOW_MS?: string;
  /** 忘記密碼：無郵件後端時是否在畫面顯示驗證碼（true/false；未設定時開發模式預設顯示） */
  readonly VITE_SHOW_RESET_CODE?: string;
  /** 選填；未設定時 production 預設呼叫同網域 `/api/password-reset-email` */
  readonly VITE_PASSWORD_RESET_EMAIL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
