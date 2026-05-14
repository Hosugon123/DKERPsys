/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORAGE_MODE?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_API_SYNC_TOKEN?: string;
  readonly VITE_ASYNC_STORAGE_DELAY_MS?: string;
  /** 忘記密碼：無郵件後端時是否在畫面顯示驗證碼（true/false；未設定時開發模式預設顯示） */
  readonly VITE_SHOW_RESET_CODE?: string;
  /** POST：JSON body `{ email, code, loginId, purpose, expiresInMinutes }`；可選 `Authorization` 見 VITE_PASSWORD_RESET_EMAIL_AUTH */
  readonly VITE_PASSWORD_RESET_EMAIL_URL?: string;
  /** 選填：寄信 API 的 Authorization 標頭全文（例如 `Bearer sk_…`） */
  readonly VITE_PASSWORD_RESET_EMAIL_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
