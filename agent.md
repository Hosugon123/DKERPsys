# Agent Git 同步規則

## 0. 開始操作前必做：同步檢查

- 每次開始新的修改、排查、提交或推送前，必須先執行 `git fetch origin`，再檢查 `git status --short --branch`。
- 若本機落後遠端，先整合遠端最新版本（例如 rebase / pull）並確認沒有衝突，再開始修改。
- 若本機與遠端同時各有新 commit，禁止直接硬推；必須先合併或 rebase，保留兩邊修改意圖，避免多裝置或多助手開發互相覆蓋。
- 完成修改並推送前，也要再檢查一次遠端是否有新版本，必要時先重新 fetch/rebase 後再 push。

## 0.1 營運核心功能分級與守門規則

### S0：永遠不能壞的營運核心

這一級功能壞掉會直接讓員工、加盟主、管理者不信任系統。任何改動只要碰到相關資料流、UI、storage、同步、權限、金額或訂單狀態，都必須視為高風險。

- 叫貨／批貨：建立訂單、常用訂單帶入、扣除盤點剩餘、昨日剩貨/參考單、送出訂單、加盟自備品扣款。
- 攤上盤點：植入訂單、填剩餘貨量、已售完、帶出量、送出盤點、盤點快照、銷售紀錄同步。
- 訂單管理：管理員/員工/加盟主可見性、待出貨/已出貨/已取消、訂單清單、訂單明細。
- 改單與調整數量：已送出未出貨訂單改量、已出貨訂單盤點快照調整、加盟/直營雙庫同步、最新操作不可被舊資料覆蓋。
- 金額與結帳：訂單總額、應付金額、自備品扣除、消耗品貨款、實收、落差、流水帳連動、Dashboard 營收/支出主指標。
- 遠端同步與多端資料一致性：`withRemoteStorageWrite`、bundle merge、scope 隔離、dirty/local wins、刪除墓碑、跨裝置同時操作。

S0 守門規則：

- 修改前先找出會碰到哪些 S0 流程，並在回覆或工作紀錄中明確說明。
- 不得在輸入中途做正式寫入或觸發會刷新頁面的遠端同步，除非該操作本身就是明確的「送出／儲存／完成」。
- 不得讓 UI 直接寫 `localStorage`；S0 寫入必須經由 `apiService` 或既有 storage helper，並保留 scope、updatedAt、merge 語意。
- 不得讓「舊遠端資料、舊分頁、舊快照」覆蓋使用者最新操作。
- 每次碰到 S0，至少跑 `npm run lint`、相關 vitest、`npm test`、`npm run build`。若因時間限制不能全跑，必須明確告知未跑項目，且不得把高風險改動說成已完整驗證。
- 必須補或更新回歸測試；測試要覆蓋真實業務語意，而不是只測函式有回傳。

### 0.2 測試與正式環境驗證（必守）

**原則：以線上正式版為驗證基準，但絕不可污染正式資料。**

- **正式環境 URL**：`https://dksys.vercel.app/`（部署完成後以 `build-version.json` 的 `buildId` 確認是否為目標 commit）。
- **預設流程**（S0／叫貨扣餘／盤點／同步相關改動必做）：
  1. 先跑本機 **vitest 回歸**（`localStorage` mock、隔離環境，見下方「允許」）。
  2. 再對正式版做 **唯讀煙霧檢查**（見下方「允許」），確認 build 已上線、關鍵靜態資源可載入。
  3. 若需確認 UI 行為，僅做 **不送出、不儲存** 的瀏覽檢查；不得在未隔離環境對正式站執行叫貨送出、盤點完成、刪單、匯入 bundle 等寫入。
- **允許（不影響正式資料庫／Redis bundle）**：
  - 本機 `vitest`／`npm test`（mock、`beforeEach` 清空 `localStorage`，不帶正式 `VITE_API_SYNC_TOKEN`）。
  - 對正式站 **GET**：首頁、`/build-version.json`、靜態 `assets/*`（只讀）。
  - 正式站登入後 **僅瀏覽、不點送出**：例如打開批貨頁確認扣餘按鈕狀態、帳上售出數字是否顯示（不修改購物車、不送出訂單）。
- **禁止（會寫入或覆蓋正式資料）**：
  - 對 `https://dksys.vercel.app/api/sync-bundle` 或任何正式 API 發 **PUT／POST／DELETE**（含測試用 token 推送 bundle）。
  - 在正式站執行：送出叫貨、盤點完成、改單儲存、刪除訂單、數據中心匯入、流水帳新增等 **任何持久化寫入**。
  - 使用正式環境的 `VITE_API_SYNC_TOKEN`／`REDIS_URL` 跑自動化腳本或「順手修資料」。
  - 以正式站為目標跑會觸發 `withRemoteStorageWrite` 且未 mock 的整合測試。
- **若必須驗證遠端同步行為**：僅能使用 **本機 remote 模式 + 測試用後端／測試 token**，或 **Staging**；不得拿正式 Redis 當測試場。
- **回報時**應註明：本機 vitest 結果、正式版 `buildId`、是否僅唯讀檢查正式站（勿宣稱「已在正式環境完整 E2E 送單」除非使用者本人於隔離流程下操作）。

S0 常用回歸測試線索：

- 叫貨/扣剩餘：`procurementBasisSync.test.ts`、`procurementBasisVisibility.test.ts`、`stallBringOutBehavior.test.ts`
- 盤點/銷售同步：`crossModuleDataIntegrity.test.ts`、`stallQtySync.test.ts`、`orderStallSnapshot.test.ts`、`stallScopeIsolation.test.ts`
- 改單/訂單管理：`orderLinePatchEitherStore.test.ts`、`orderStatusMerge.test.ts`、`orderEitherStore.test.ts`、`orderFranchiseeVisibility.test.ts`
- 多端同步/覆蓋：`multiDeviceSync.test.ts`、`remoteSyncHub.test.ts`、`appDataBundleMerge.test.ts`
- 金額/消耗品/帳務：`financeConsumable.test.ts`、`procurementLedgerDraft.test.ts`、`stallMathLedgerGap.test.ts`

### S1：重要但可快速補救

- 商品目錄、售價顯示、成本結構表、常用訂單管理、日期區間篩選、銷售/盤點輔助視覺化。
- 守門規則：至少跑 `npm run lint`、相關測試、必要時 `npm run build`；若會影響 S0 資料，升級為 S0。

### S2：低風險體驗與呈現

- 文案、排版、顏色、圖示、非核心統計視覺、說明區塊。
- 守門規則：至少跑 `npm run lint`；若碰到表單、按鈕、流程入口或手機操作，視影響升級為 S1/S0。

### 開發判斷原則

- 不確定級別時，一律往更高風險級別處理。
- 員工現場會用的按鈕、加盟主會用的送出流程、管理員會用的改單與金額功能，預設都是 S0。
- 每次修 S0 bug，必須順手檢查相鄰功能是否共用同一資料流，例如「叫貨扣剩餘」也要看盤點快照、scope、訂單可見性、送出後扣庫。

---
# Agent／開發者指引（專案羅盤）

本文件給 **人類開發者** 與 **AI 編輯代理** 共用：在程式變大、**頻繁換裝置開發**時，維持同一套產品邏輯與架構邊界，避免「畫面、儲存、財務規則」混寫導致方向跑偏。

**換裝置時請先讀：** §9 維護規範、§10 近期改動紀錄；再依任務查 §6 領域規則與 §4 同步契約。

---

## 1. 專案是什麼

- **技術棧**：React 19、Vite、TypeScript、Tailwind CSS、Recharts；資料主要存在 **瀏覽器 `localStorage`**。
- **部署模式**：
  - **本機模式**（預設）：僅 `localStorage`，無雲端。
  - **遠端模式**（`VITE_STORAGE_MODE=remote`）：啟動 GET 整包 bundle、寫入後 PUT 推送；見 §4.1。
- **產品定位**：鹹水雞／滷味相關門市營運工具：叫貨與訂單、攤上盤點、銷售紀錄、流水帳、品項與成本、管理員儀表板與 **JSON 數據中心**（匯出／匯入）。

---

## 2. 目錄分工（請維持）

| 區域 | 用途 | 禁忌 |
|------|------|------|
| `src/views/` | 頁面級 UI、路由對應 `App.tsx` 的 `currentView` | 不要在此寫長串財務公式或重複的 localStorage 讀寫邏輯 |
| `src/components/` | 可複用元件、側欄、圖表區塊 | 同上；避免直接操作多個 storage key |
| `src/hooks/` | 與 React 綁定的訂閱（例：`useAccountingLedger`、`useColorTheme`） | 業務規則仍應落在 `lib/` |
| `src/services/` | **`apiService.ts`**（UI 寫入入口）、`remoteSyncHub.ts`（雲端 bundle） | 不要在 view 直接 `localStorage.setItem` |
| `src/lib/` | **唯一**推薦的業務與持久化核心 | 不要依賴 React；不要 import `views/` |

新增功能時：**先決定資料由哪個 `*Storage` 擁有**，再決定要不要新事件名稱；UI 經 `apiService` 寫入。

---

## 3. 身分與導覽

- **角色**：`admin`（超級管理員）、`franchisee`（加盟）、`employee`（店員）。權限與選單見 `Sidebar.tsx`；**數據中心**僅 `admin`。
- **選單順序**：可拖曳排序，存於 `sidebarNavOrderStorage.ts`。
- **明暗主題**：側欄標題列 `ThemeToggleButton`；邏輯見 §7.2。

---

## 4. 資料與事件（同步契約）

- 各模組以 **`localStorage` + JSON** 持久化；鍵名前綴習慣為 `dongshan_*`。
- 寫入後應 **`window.dispatchEvent`** 通知其他畫面，例如：
  - 流水帳：`accountingLedgerUpdated`
  - 訂單：`orderHistoryUpdated`、`franchiseManagementOrdersUpdated`
  - 盤點：`stallInventoryUpdated`
  - 主題：`dongshanColorThemeChange`
  - 其他見各 `*Storage` 檔案
- **全量匯入**：`appDataBundle.ts` 匯入成功後會對多個事件補發同步，並額外發 `dongshanDataBundleImported`。

新增一塊持久化資料時：**請把該 key 加入 `appDataBundle.ts` 的 `DONGSHAN_EXPORT_STORAGE_KEYS` 白名單**，否則備份／還原／雲端同步會漏資料。

### 4.1 遠端同步與 `apiService`（換裝置必懂）

| 函式 | 行為 | 適用場景 |
|------|------|----------|
| `withRemoteStorageWrite` | 寫本機 → 排程推送 → **等待推送完成** | 刪單等需立刻與雲端一致的操作 |
| `withRemoteStorageWriteDeferPush` | 寫本機 → 排程推送 → **不等待** | 盤點自動儲存、**盤點完成提交**（本機先成功、背景推送） |
| `awaitRemotePushIdle` | 等目前推送佇列清空 | 刪單後、commit 成功後背景上雲 |
| `hasPendingRemotePush` | 是否有去抖動中／排隊中的推送 | 判斷能否安全從雲端拉回 |

- **UI 層規範**：優先呼叫 `src/services/apiService.ts` 的 async 方法，**不要**在 view 直接 `localStorage.setItem`。
- **多裝置合併**：`remoteSyncHub.ts` 推送前會與雲端 bundle 合併；訂單等依單號 union；409 自動合併重試。
- **效能陷阱**：高頻寫入若每次都 `withRemoteStorageWrite` 並等待，遠端模式會連續整包 PUT。**自動儲存**用 `deferRemotePush`；**盤點完成**亦用 defer 寫本機後 `void awaitRemotePushIdle()` 背景推送，避免彈窗卡住。
- **防覆寫**：
  - `refreshRemoteBundleVersionIfStale`（分頁重新可見）：若 `hasUnsavedWork()` 或 `hasPendingRemotePush()` → **跳過拉回**
  - `refreshAppPageData`（下拉重整）：改為 **merge** 而非整包覆蓋；編輯中則本機 keys 全 dirty、本機優先

---

## 5. 資料模型慣例（AI／匯出友善）

優先讓「可編輯實體」具備：

- **`id`**：唯一識別
- **`createdAt`**：ISO 時間
- **`updatedAt`**：ISO 時間（更新時必寫）

訂單、流水帳、自訂品項、叫貨常用單等已朝此對齊；舊資料在讀取路徑上會以合理預設補齊。新功能請延續此慣例。

---

## 6. 領域規則（易錯點）

### 6.1 訂單兩套儲存與刪除

- **加盟／店員叫貨**：`orderHistoryStorage`（`dongshan_order_history_v1`）
- **總部訂單管理**：`dongshan_franchise_mgmt_orders_v1`
- 合併列表、狀態更新、刪除等需遵守 **「先找管理庫再找歷史庫」**；`readMergedOrderByIdFromStores` 用於跨庫讀單筆。
- **刪除**（`deleteOrderByIdFromAnyStore`）：
  - 兩庫都刪（若存在且 scope 允許）
  - 寫入墓碑 `dongshan_deleted_order_ids_v1`（`DELETED_ORDER_IDS_KEY`），避免雲端合併時幽靈訂單復活
  - 連動清理該單相關攤上日紀錄（`purgeStallDayRecordsForDeletedOrder`）
  - UI 經 `ordersApi.deleteOrderByIdFromAnyStore`；remote 模式刪除後 `awaitRemotePushIdle`
- 測試：`orderDelete.test.ts`、`orderDeleteStallCleanup.test.ts`

### 6.2 流水帳：食材 vs 滷料（大項分離）

- **`食材支出`**：僅 **主食材進貨** 子類（鴨貨類、加工食品、雞肉類、豬肉類、蔬菜類）→ 對應 **COGS** 統計。
- **`滷料`**：**獨立大類**，滷汁配料子類（糖、味精、醬油、中草藥、其他調味等）→ 對應 **滷汁成本**，**不可**再當成食材支出的子選項。
- 舊資料若將滷料子項誤列在食材下，UI 會標示 **誤列**；統計與 `ingredientSubSpendBreakdownForMonth` 會提示改列。

修改分類或統計前，請先讀 `accountingLedgerStorage.ts` 內註解與 `normalizeSubToMainBucket` / `normalizeSubToSeasoningBucket`。

### 6.3 產品與成本庫存：成本結構表

- `costStructureStorage.ts`（key：`dongshan_cost_structure_v1`，事件：`costStructureUpdated`）。
- 模型：使用者自訂欄位（`columns: { id, label, kind, order }`）＋ 品項列（`items` 含 `values: Record<columnId, string>`）。
- **彈性原則**：欄位／品項皆可隨時增減；數值統一以字串保存，由 `kind`（`currency`／`number`／`percent`／`text`）決定畫面提示，不做型別轉換以保留輸入彈性。
- **漲縮補充**：`findShrinkageRateColumnId` 以欄位標題辨識「漲縮／脹縮」；**僅當該欄有填寫時**才顯示列首展開與「未滷／成品成本」補充列。

### 6.4 財務計算放哪裡

- **儀表板／淨利／本月結構**：`financeLib.ts`（純函式）。
- **`dashboardFinance.ts`**：僅 **re-export** `financeLib`，保留舊 import 路徑相容。
- **滷料區間分析**：`accountingLedgerStorage.ts` 的 `computeMarinadeExpenseAnalysis`。

不要在 `Dashboard.tsx` 內新增「營收 − 支出」一類的核心公式；應加在 `financeLib.ts` 並由畫面呼叫。

### 6.5 消耗品（代訂不計加盟營收）

- 品項分類 **「消耗品」**（辣粉、紙袋、竹籤等）：加盟叫貨可代訂，但 **不計入總部加盟批貨營收**。
- `orderHistoryStorage`：`consumableLinesSubtotal` 加總消耗品列；`financeLib` 的 `franchiseeOrderTotal` 排除、`franchiseeConsumableGoodsTotal` 獨立加總。
- **攤上盤點／銷售紀錄帳面**：消耗品不納入「應有營業額」與盤點表列示（資料仍在庫、叫貨扣庫不變）。見 `supplyCatalog.ts`、`stallMath.ts`、`StallInventory.tsx` 註解。
- Dashboard 總部 KPI 有五欄：直營實收、加盟批貨、**消耗品貨款**、總支出、淨利。
- 測試：`financeConsumable.test.ts`

### 6.6 攤上盤點 → 銷售紀錄（跨模組一次看懂）

**資料擁有者：**

| 儲存 | Key／模組 | 內容 |
|------|-----------|------|
| 訂單押記 | `orderHistoryStorage` | `stallCountCompletedAt`、`stallCountBasisYmd`、`stallCountSnapshot` |
| 攤上日 | `stallInventoryStorage` | 當日 lines、actualRevenue、落差草稿欄位 |
| 銷售日 | `salesRecordStorage` | 與押記 snapshot 對齊的日紀錄 |

**盤點營業日與 scope（易出小 bug，必守）：**

- 盤點頁讀寫鍵 = **`stallBasisYmd`（所選訂單 `effectiveOrderDateYmd`）** + **`stallScopeId`（`resolveOrderStallStorageScopeId`）**，**不可**用畫面「今日」`dateStr` 存檔。
- 叫貨送出扣庫、`recomputeStallOutForStallYmdAndOrder`、`syncStallOutAfterOrderLinesChanged` 皆須帶訂單 scope，避免加盟帶出寫入 HQ 桶。
- 儲存鍵格式：`scope:hq|2026-06-14`；舊裸鍵 `YYYY-MM-DD` 視為 HQ。雲端合併時 `bundleRecordMerge.mergeByDateStore` 會正規化裸鍵再合併，避免雙份。
- 已盤點單改貨量：訂單管理若已押記會鎖 line；須走 **銷售紀錄** → `updateStallCountSnapshotByOrderId` → `syncBasisDayFromOrderSnapshot`。
- 雙庫押記／快照：`patchOrderStallFieldsInEveryStore` **兩庫皆須成功**；銷售調整時若僅一庫有押記，會從有押記庫補齊另一庫快照。

**盤點完成（關鍵路徑，勿拆回多次獨立 write）：**

1. UI：`StallInventory.tsx` → `ordersApi.commitStallInventoryComplete(...)`
2. API：`apiService.ts` → `withRemoteStorageWrite` → `stallInventoryStorage.commitStallInventoryComplete`
3. 單次寫入：`setOrderStallCountStamp` + `saveDay` + `saveSalesRecord` + `stallCountSnapshotPersistedMatches` 驗證
4. 失敗原因：`order_not_found`｜`stamp_failed`｜`persist_mismatch` — UI 須顯示錯誤，不可靜默卡住
5. 帳面落差寫流水帳：仍為獨立 `ledgerApi.append`（可選，在 commit 成功後）

**效能（盤點頁易崩潰／重整）：**

- 不要用 **每秒** `setState` 刷整頁時鐘；目前為 **60 秒**。
- 自動儲存：`stallInventoryApi.saveDay(..., { deferRemotePush: true })`。
- 大表重繪：避免在盤點輸入路徑綁定不必要的高頻 effect。

**測試：** `crossModuleDataIntegrity.test.ts`、`stallQtySync.test.ts`、`orderStallSnapshot.test.ts`

---

## 7. UI／文案

- 介面與本文件預設 **繁體中文**。
- 視覺：琥珀色重點；深／淺色由 CSS 變數驅動，見 §7.2。

### 7.1 行動版（iPhone Safari 等）

- **`index.html`**：`viewport-fit=cover`，以利 `env(safe-area-inset-*)`。
- **`App.tsx`**：側欄開啟時以 `body { position: fixed; top: -scrollY }` 鎖背景捲動；`<main>` 加 **`uio-touch-host`** 類別。
- **`index.css`**：`.uio-touch-host` 在寬度 `<640px` 時，將 `input`／`select`／`textarea` 字級至少 **16px**、最小高度約 **44px**。
- **`useIsNarrowScreen()`**：與 Tailwind `sm`（640px）對齊；圖表降載用。
- **`CostStructureTable`**：小螢幕橫向捲動；欄寬拖曳支援 touch。

### 7.2 明暗主題

- **`colorTheme.ts`**：`ColorTheme = 'dark' | 'light'`；`document.documentElement.dataset.theme`；token 為 `--ds-*` CSS 變數。
- **`lightTheme.css`**：淺色覆寫（與 `index.css` 深色預設並存）；`main.tsx` 兩者皆 import。
- **`initColorTheme()`**：啟動時套用；偏好存 `dongshan_color_theme_v1`。
- 新增頁面／元件：優先用 `bg-ds-surface`、`text-ds-primary`、`border-ds-border` 等 token 類名，**避免硬編 `#18181b` 等深色專用色**。
- sticky 列等：可用 `bg-ds-sticky-bar`（定義於主題 CSS）。

---

## 8. 修改時的自檢清單

1. 是否只動到「完成需求所需」的檔案？
2. 新資料是否需 **事件**、**匯出白名單**、`createdAt`／`updatedAt`？
3. 財務數字是否仍只來自 **`financeLib` + 既有 storage 聚合**？
4. 食材／滷料／消耗品邊界是否被破壞？
5. 遠端模式：高頻寫入是否該用 **`deferRemotePush`**？關鍵提交是否該 **批次寫入**？
6. 跨模組流程（叫貨→盤點→銷售）是否仍 **三庫一致**？
7. `npm run lint` 是否通過？有意義的領域變更是否補測試（`vitest`）？
8. S0 相關改動是否依 §0.2 完成：**本機 vitest + 正式版唯讀煙霧**（未對正式 bundle 寫入）？

---

## 9. 本檔維護方式（AI 代理必做）

開發者會 **頻繁換裝置**；每次完成具架構或產品意義的改動後，**同一個 PR／任務內**請更新本檔，不要只留在聊天紀錄。

### 9.1 什麼時候要寫

- 新增／變更 **持久化 key**、**全域事件**、**apiService 公開方法**
- 修正 **跨模組資料流**（訂單、盤點、財務、雲端同步）
- 新增 **領域規則**（什麼算營收、什麼不算、誰能刪誰）
- 修正 **效能／遠端同步** 相關陷阱與建議寫法
- 使用者明確要求記錄的決策
- **架構路線圖、尚未實作的階段規劃**（見 §11；與 §10 單次改動摘要分開）

### 9.2 怎麼寫

1. **長期規則** → 更新 §4～§7 對應小節（精簡、可搜尋）。
2. **單次改動摘要** → 在 §10 **最上方**新增一筆（日期 `YYYY-MM-DD`、標題、改了什麼、為何、關鍵檔案、測試）。
3. **待實作架構／多階段路線** → 更新 §11（標明「規劃中」與當前優先順序）。
4. 不要複製整段程式；寫 **檔名 + 函式名 + 行為** 即可。
5. 若改動 revert 或作廢，在 §10 該筆標註 ~~刪除線~~ 或「已取代」。

### 9.3 換裝置開發快速起手

```bash
npm install
npm run lint
npm test          # 或 npm test -- path/to.test.ts
npm run dev       # port 3000
```

**正式環境唯讀煙霧（可選，S0 建議做）**：

```bash
# 確認正式版 build 是否為預期 commit（唯讀 GET）
curl -s https://dksys.vercel.app/build-version.json
```

勿對正式站 `/api/sync-bundle` 做 PUT 或帶正式 token 寫入。詳 §0.2。

遠端模式需對應環境變數與後端 `/api/sync-bundle`；見部署設定。

---

## 10. 近期改動紀錄（新在上）

> **AI 代理**：完成重要改動後請在此新增一筆；人類換裝置時先看這裡。

### 2026-06-17｜叫貨扣餘架構路線圖（規劃紀錄，尚未實作）

- **背景**：加盟／直營扣盤點剩餘反覆回歸；根因為「剩餘量」多資料源（訂單快照、銷售日、攤上日、後續叫貨單反推）在讀取時合併，而非單一庫存帳本。詳 **§11**。
- **當前優先**：先完成 S0 bug 修復（`loadBasisOrderRemainForProcurementDeduction`、`resolveFrozenLineForItem` 品名 key、扣庫池同 scope、`Procurement.tsx` 合併數量草稿等）；**勿**在本輪順手做大重構。
- **後續**：依 §11 階段 0 → 1 逐步收斂；換後端（§11 階段 2）待營運擴店需求再排。

### 2026-06-17｜測試策略：以正式版為準、禁止污染正式資料

- **規則**：S0 改動驗證以 `https://dksys.vercel.app/` 為行為基準；本機 vitest 回歸後，對正式站僅允許唯讀煙霧（`build-version.json`、靜態資源、不送出的 UI 瀏覽）。
- **禁止**：對正式 `/api/sync-bundle` 或正式 Redis 做任何寫入；不得在正式站執行送單、盤點完成、匯入等持久化操作作為自動測試。
- **位置**：`agent.md` §0.2、§8、§9.3

### 2026-06-03｜送單／改貨量／盤點／銷售調整 — scope 與雙庫徹底修復

- **問題**：反覆出現帶出寫錯桶、盤點日與訂單日分裂、雲端合併裸鍵+scoped 雙份、雙庫快照不一致。
- **作法**：
  - `StallInventory.tsx` 統一 `stallBasisYmd`／`stallScopeId`（讀寫、自動儲存、事件重載、植入訂單）
  - `recomputeStallOut*`、`applyOrderDeductionToDayRemain` 全程帶 scope
  - `bundleRecordMerge` 裸鍵正規化；`patchOrderStallFieldsInEveryStore` 雙庫 AND
  - `updateStallCountSnapshotByOrderId`：一庫有押記時補寫另一庫快照
- **關鍵檔案**：`StallInventory.tsx`、`stallInventoryStorage.ts`、`orderHistoryStorage.ts`、`bundleRecordMerge.ts`、`scopedStallDateKey.ts`、`apiService.ts`
- **驗證**：vitest **72** 項通過；`npm run build` 通過

### 2026-06-03｜遠端同步防覆寫＋盤點提交不卡網路

- **問題**：分頁切回／下拉重整可能蓋掉盤點草稿；盤點「確定送出」在 remote 模式等 PUT 完成而卡住。
- **作法**：
  - `hasPendingRemotePush`；`refreshRemoteBundleVersionIfStale` 編輯中跳過
  - `refreshAppPageData` 改 merge（編輯中本機全 dirty）
  - `commitStallInventoryComplete` 改 defer 寫本機 + 背景 `awaitRemotePushIdle`
- **關鍵檔案**：`remoteSyncHub.ts`、`appRefresh.ts`、`apiService.ts`
- **驗證**：vitest 70 項通過；本地瀏覽器 E2E 盤點完成 → 彈窗關閉、已寫入、訂單押記與 `scope:hq|2026-06-14` 銷售紀錄

### 2026-06-03｜攤上盤點：效能與「確定送出」修復

- **問題**：盤點時頁面頻繁卡頓／像崩潰重整；「確認送出盤點完成」卡住，銷售紀錄與「已盤點」未寫入。
- **根因**：每秒整頁重繪；自動儲存每次等雲端推送；盤點完成拆多次 `withRemoteStorageWrite` 且無錯誤處理。
- **作法**：
  - 時鐘改 60 秒；`saveDay` 支援 `deferRemotePush`
  - 新增 `commitStallInventoryComplete` 單次寫入三庫 + 驗證
  - `withRemoteStorageWriteDeferPush`（`remoteSyncHub.ts`）
  - UI：`stallCountSubmitting`、try/catch、錯誤訊息、`res.ok === false` 窄化
- **關鍵檔案**：`StallInventory.tsx`、`stallInventoryStorage.ts`、`apiService.ts`、`remoteSyncHub.ts`、`orderHistoryStorage.ts`
- **測試**：`crossModuleDataIntegrity.test.ts` 新增 commit 案例
- **狀態**：本地已改；部署前請確認已 push

### 2026-06-03｜消耗品代訂不計加盟營收

- **規則**：加盟叫貨中「消耗品」列不進 `franchiseeOrderTotal`；獨立 `franchiseeConsumableGoodsTotal`；Dashboard 多「消耗品貨款」KPI。
- **關鍵檔案**：`financeLib.ts`、`orderHistoryStorage.ts`、`Dashboard.tsx`
- **測試**：`financeConsumable.test.ts`

### 2026-06-03｜明暗主題切換

- **作法**：`colorTheme.ts` + `lightTheme.css` + `ThemeToggleButton`（側欄）；`--ds-*` token。
- **關鍵檔案**：`main.tsx`、`Sidebar.tsx`、`hooks/useColorTheme.ts`

### 2026-06-03｜訂單刪除（遠端／雙庫）

- **問題**：正式環境刪單無反應或刪後復活。
- **作法**：雙庫刪除 + 墓碑 `dongshan_deleted_order_ids_v1` + bundle 合併尊重墓碑 + 刪後 `awaitRemotePushIdle` + UI 錯誤提示。
- **關鍵檔案**：`orderHistoryStorage.ts`、`appDataBundle.ts`、`apiService.ts`
- **測試**：`orderDelete.test.ts`、`updatedFlowsIntegration.test.ts`

---

## 11. 叫貨扣餘／庫存架構路線圖（規劃中 · 尚未實作）

> **AI 代理**：本節為**決策與待辦紀錄**；使用者明確要求實作某階段前，**不要**擅自啟動大範圍重構。當前仍以 S0 bug 修復與 §0 守門測試為先。

### 11.1 現況診斷（2026-06-17）

| 面向 | 評估 |
|------|------|
| 模組划分、`apiService` 閘道、`scope` 隔離、`agent.md` S0 治理 | 方向正確，可延續 |
| 「剩餘量」資料來源 | **多源推導**（快照／銷售日／攤上日／叫貨單 qty 反推），為扣餘回歸溫床 |
| 扣庫實作 | 改 `remain` 字串欄位，非可追溯的庫存異動 |
| 遠端同步 | 整包 JSON merge 適合設定與備份，**不適合** S0 庫存交易的長期終態 |
| 品項 key | 歷史快照可能用品名；目錄用 `s01` 等 id，需正規化 |

**結論**：產品架構無需推倒；**資料／庫存模型**需從「多快照合併」演進為「單一可扣池 + 異動帳本（業界 stock movement / ledger 模式）」。

### 11.2 業界對照（精簡）

- **盤點完成** → 寫入不可變盤點 session／結存快照 + 一筆庫存異動。
- **次日叫貨扣前日剩** → 採購單帶 `basis_count_session_id`（或等價 `basisOrderId`），扣減寫 **負向 movement**，餘額查帳本，不在多個 JSON 上現場猜。
- **多店** → 所有列帶 `store_id`（本專案 `scopeId`），**伺服器端**過濾；避免僅靠客戶端雙庫 merge。
- **參考**：Odoo `stock.move`、ERPNext Stock Ledger、餐飲 POS 日結＋期初帶入——語意相同，規模可較小。

### 11.3 階段 0｜收斂讀取路徑（1～2 週，仍用 localStorage）

**目標**：S0 扣餘行為只經一個服務，停止新增平行 `load*` 合併函式。

| 待辦 | 說明 |
|------|------|
| `getProcurementRemainPool(basisOrderId)` | 唯一對外 API；回傳 `Record<productId, availableQty>` + 可選 `debugSource` |
| 統一呼叫點 | 批貨「昨日剩貨」、扣餘按鈕、送單 `buildProcurementRemainDeductionsFromLines`、植入帶出 **只讀此 API** |
| 盤點寫快照正規化 | `setOrderStallCountStamp`／完成盤點時 **lines key 強制轉 catalog id**；舊資料一次性 migration |
| 帳上售出顯示 | 可仍讀凍結快照，但數字須與 pool 同源或 UI 標註差異原因 |
| 測試 | 擴充 `procurementBasisSync.test.ts`、`procurementBasisVisibility.test.ts`；加盟 scope + 品名 key 案例 |

**關鍵檔案（預計）**：`stallInventoryStorage.ts`（或新檔 `procurementRemainPool.ts`）、`Procurement.tsx`、`apiService.ts`

### 11.4 階段 1｜StockMovement 本機帳本（1～2 月）

**目標**：可扣池 = 盤點結存 − 已寫入之 `procurement_offset` 異動；不再從後續訂單 `line.qty` 反推。

```typescript
// 規劃型別（尚未實作）
type StockMovement = {
  id: string;
  storeScopeId: string;
  productId: string;
  qtyDelta: number; // 負數 = 扣減
  reason: 'count_close' | 'procurement_offset' | 'manual_adjust';
  refType: 'order' | 'count_session';
  refId: string;
  basisOrderId?: string;
  createdAt: string;
  updatedAt: string;
};
```

| 待辦 | 說明 |
|------|------|
| 新 storage key | 納入 `DONGSHAN_EXPORT_STORAGE_KEYS` 與 bundle merge 白名單 |
| 盤點完成 | 寫 `count_close` + 更新 balance 視圖 |
| 叫貨送出 | 寫 `procurement_offset`（取代或對齊 `applyOrderDeductionToDayRemain`） |
| 向後相容 | 過渡期雙寫或讀取 fallback，需明確下線日 |

### 11.5 階段 2｜交易級後端（3～6 月，依營運排程）

| 待辦 | 說明 |
|------|------|
| PostgreSQL（或等價） | 訂單、盤點 session、movement、balance 分表 |
| API | S0 寫入走 server transaction；樂觀鎖／`updatedAt` |
| `VITE_STORAGE_MODE=remote` | bundle 保留備份／主檔；**交易不走整包 PUT** |
| RLS 或應用層 | `store_id` / `scopeId` 強制；總部代操作加審計欄 |

### 11.6 階段 3｜產品簡化（可選）

- 預設參考單 = 最近一筆已完成盤點訂單（延伸 `getPreferredProcurementBasisOrderId`）。
- 叫貨頁顯示「建議叫貨 = 目標 − 期初」；扣餘按鈕改「套用建議」。
- 降低選錯參考單造成的支援成本。

### 11.7 明確不做（除非使用者另議）

- 一次性大重寫 UI 或砍掉雙訂單庫而不做 migration。
- 在階段 0 完成前引入新平行 `remain` 讀取函式。
- 以正式 Redis／正式站送單作為自動化測試手段（見 §0.2）。

---

*文件路徑：專案根目錄 `agent.md`（請納入 git，換裝置 `git pull` 即可同步）。*
