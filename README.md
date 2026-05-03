# DKERPsys

達客東山鴨頭 ERP 系統（React + Vite + TypeScript）

## 本機開發

**環境：** Node.js

1. 安裝依賴：`npm install`
2. 可選：複製 `.env.example` 為 `.env` 並依說明調整
3. 啟動開發伺服器：`npm run dev`（預設 `http://localhost:3000`）

## 建置

```bash
npm run build
```

## Vercel 跨裝置同步（可選）

此專案預設資料存在瀏覽器 `localStorage`。若要在不同裝置共享資料，可在 Vercel 啟用 remote 同步：

1. 安裝並啟用 Vercel KV（或既有 Upstash Redis 整合）。
2. 在 Vercel 專案環境變數設定：
   - `VITE_STORAGE_MODE=remote`
   - `VITE_API_SYNC_TOKEN=<長隨機字串>`
   - `API_SYNC_TOKEN=<同上字串>`
   - `KV_REST_API_URL`、`KV_REST_API_TOKEN`（由 Vercel KV 提供）
3. 重新部署後，前端會透過 `/api/sync-bundle` 同步整包資料。

行為摘要：**每次開啟／重新整理**會先 `GET` 雲端並覆蓋本地；**每次經 `apiService` 的寫入**會先改 `localStorage` 再自動 `PUT`；雲端為空且本地有資料時會**首次自動上傳**。同步失敗時右上角會顯示紅點提示。
