/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 忘記密碼：無郵件後端時是否在畫面顯示驗證碼（true/false；未設定時開發模式預設顯示） */
  readonly VITE_SHOW_RESET_CODE?: string;
  /** POST：JSON body `{ email, code }`，由後端寄送驗證信 */
  readonly VITE_PASSWORD_RESET_EMAIL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
