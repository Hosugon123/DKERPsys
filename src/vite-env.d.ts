/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORAGE_MODE?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_API_SYNC_TOKEN?: string;
  readonly VITE_ASYNC_STORAGE_DELAY_MS?: string;
  /** 忘記密碼：無郵件後端時是否在畫面顯示驗證碼（true/false；未設定時開發模式預設顯示） */
  readonly VITE_SHOW_RESET_CODE?: string;
  /** POST：JSON body `{ email, code }`，由後端寄送驗證信 */
  readonly VITE_PASSWORD_RESET_EMAIL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
