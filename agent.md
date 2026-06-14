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

---

## 9. 本檔維護方式（AI 代理必做）

開發者會 **頻繁換裝置**；每次完成具架構或產品意義的改動後，**同一個 PR／任務內**請更新本檔，不要只留在聊天紀錄。

### 9.1 什麼時候要寫

- 新增／變更 **持久化 key**、**全域事件**、**apiService 公開方法**
- 修正 **跨模組資料流**（訂單、盤點、財務、雲端同步）
- 新增 **領域規則**（什麼算營收、什麼不算、誰能刪誰）
- 修正 **效能／遠端同步** 相關陷阱與建議寫法
- 使用者明確要求記錄的決策

### 9.2 怎麼寫

1. **長期規則** → 更新 §4～§7 對應小節（精簡、可搜尋）。
2. **單次改動摘要** → 在 §10 **最上方**新增一筆（日期 `YYYY-MM-DD`、標題、改了什麼、為何、關鍵檔案、測試）。
3. 不要複製整段程式；寫 **檔名 + 函式名 + 行為** 即可。
4. 若改動 revert 或作廢，在 §10 該筆標註 ~~刪除線~~ 或「已取代」。

### 9.3 換裝置開發快速起手

```bash
npm install
npm run lint
npm test          # 或 npm test -- path/to.test.ts
npm run dev       # port 3000
```

遠端模式需對應環境變數與後端 `/api/sync-bundle`；見部署設定。

---

## 10. 近期改動紀錄（新在上）

> **AI 代理**：完成重要改動後請在此新增一筆；人類換裝置時先看這裡。

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

*文件路徑：專案根目錄 `agent.md`（請納入 git，換裝置 `git pull` 即可同步）。*
