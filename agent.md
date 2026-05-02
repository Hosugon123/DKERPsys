# Agent／開發者指引（專案羅盤）

本文件給 **人類開發者** 與 **AI 編輯代理** 共用：在程式變大時維持同一套產品邏輯與架構邊界，避免「畫面、儲存、財務規則」混寫導致方向跑偏。

---

## 1. 專案是什麼

- **技術棧**：React 19、Vite、TypeScript、Tailwind CSS、Recharts；資料主要存在 **瀏覽器 `localStorage`**（無後端則為單機／本機優先）。
- **產品定位**：鹹水雞／滷味相關門市營運工具：叫貨與訂單、攤上盤點、銷售紀錄、流水帳、品項與成本、管理員儀表板與 **JSON 數據中心**（匯出／匯入）。

---

## 2. 目錄分工（請維持）

| 區域 | 用途 | 禁忌 |
|------|------|------|
| `src/views/` | 頁面級 UI、路由對應 `App.tsx` 的 `currentView` | 不要在此寫長串財務公式或重複的 localStorage 讀寫邏輯 |
| `src/components/` | 可複用元件、側欄、圖表區塊 | 同上；避免直接操作多個 storage key |
| `src/hooks/` | 與 React 綁定的訂閱（例：`useAccountingLedger`） | 業務規則仍應落在 `lib/` |
| `src/lib/` | **唯一**推薦的業務與持久化核心：`orderHistoryStorage`、`accountingLedgerStorage`、`financeLib`、`appDataBundle` 等 | 不要依賴 React；不要 import `views/` |

新增功能時：**先決定資料由哪個 `*Storage` 擁有**，再決定要不要新事件名稱；不要從畫面直接 `localStorage.setItem` 散寫。

---

## 3. 身分與導覽

- **角色**：`admin`（超級管理員）、`franchisee`（加盟）、`employee`（店員）。權限與選單見 `Sidebar.tsx`；**數據中心**僅 `admin`。
- **選單順序**：可拖曳排序，存於 `sidebarNavOrderStorage.ts`。

---

## 4. 資料與事件（同步契約）

- 各模組以 **`localStorage` + JSON** 持久化；鍵名前綴習慣為 `dongshan_*`。
- 寫入後應 **`window.dispatchEvent`** 通知其他畫面，例如：
  - 流水帳：`accountingLedgerUpdated`（常數見 `accountingLedgerStorage.ts`）
  - 訂單：`orderHistoryUpdated`、`franchiseManagementOrdersUpdated`
  - 盤點：`stallInventoryUpdated`
  - 其他見各 `*Storage` 檔案
- **全量匯入**：`appDataBundle.ts` 匯入成功後會對多個事件補發同步，並額外發 `dongshanDataBundleImported`。

新增一塊持久化資料時：**請把該 key 加入 `appDataBundle.ts` 的匯出白名單**，否則備份／還原會漏資料。

---

## 5. 資料模型慣例（AI／匯出友善）

優先讓「可編輯實體」具備：

- **`id`**：唯一識別
- **`createdAt`**：ISO 時間
- **`updatedAt`**：ISO 時間（更新時必寫）

訂單、流水帳、自訂品項、叫貨常用單等已朝此對齊；舊資料在讀取路徑上會以合理預設補齊。新功能請延續此慣例。

---

## 6. 領域規則（易錯點）

### 6.1 訂單兩套儲存

- **加盟／店員叫貨**：`orderHistoryStorage`（`dongshan_order_history_v1`）
- **總部訂單管理**：`dongshan_franchise_mgmt_orders_v1`  
合併列表、狀態更新、刪除等需遵守現有 **「先找管理庫再找歷史庫」** 的 API，避免只改一邊。

### 6.2 流水帳：食材 vs 滷料（大項分離）

- **`食材支出`**：僅 **主食材進貨** 子類（鴨貨類、加工食品、雞肉類、豬肉類、蔬菜類）→ 對應 **COGS** 統計。
- **`滷料`**：**獨立大類**，滷汁配料子類（糖、味精、醬油、中草藥、其他調味等）→ 對應 **滷汁成本**，**不可**再當成食材支出的子選項。
- 舊資料若將滷料子項誤列在食材下，UI 會標示 **誤列**；統計與 `ingredientSubSpendBreakdownForMonth` 會提示改列。

修改分類或統計前，請先讀 `accountingLedgerStorage.ts` 內註解與 `normalizeSubToMainBucket` / `normalizeSubToSeasoningBucket`。

### 6.3 產品與成本庫存：成本結構表

- `costStructureStorage.ts`（key：`dongshan_cost_structure_v1`，事件：`costStructureUpdated`）。
- 模型：使用者自訂欄位（`columns: { id, label, kind, order }`）＋ 品項列（`items` 含 `values: Record<columnId, string>`）。
- **彈性原則**：欄位／品項皆可隨時增減；數值統一以字串保存，由 `kind`（`currency`／`number`／`percent`／`text`）決定畫面提示，不做型別轉換以保留輸入彈性。
- **漲縮補充**：`findShrinkageRateColumnId` 以欄位標題辨識「漲縮／脹縮」；**僅當該欄有填寫時**才顯示列首展開與「未滷／成品成本」補充列（主表漲縮率為準；不對全品項做漲縮統計）。若表上無漲縮欄可辨識，舊匯入之 `hasShrinkage` + 未滷／成品仍會顯示補充列。
- 寫入後務必呼叫 `saveStore` 內建的 `dispatchEvent`；新增持久化 key 已加入 `appDataBundle.ts` 白名單。

### 6.4 財務計算放哪裡

- **儀表板／淨利／本月結構**：`financeLib.ts`（純函式）。
- **`dashboardFinance.ts`**：僅 **re-export** `financeLib`，保留舊 import 路徑相容。
- **滷料區間分析**（圖表用的聚合）：`accountingLedgerStorage.ts` 的 `computeMarinadeExpenseAnalysis`（仍屬 domain + storage 邊界，勿搬到 View）。

不要在 `Dashboard.tsx` 內新增「營收 − 支出」一類的核心公式；應加在 `financeLib.ts` 並由畫面呼叫。

---

## 7. UI／文案

- 介面與本文件預設 **繁體中文**。
- 視覺：深色底、琥珀色重點，與現有 Tailwind 類名風格一致；大改主題需同步多頁。

---

## 8. 修改時的自檢清單

1. 是否只動到「完成需求所需」的檔案？（避免順手大重構）
2. 新資料是否需 **事件**、**匯出白名單**、`createdAt`／`updatedAt`？
3. 財務數字是否仍只來自 **`financeLib` + 既有 storage 聚合**？
4. 食材／滷料邊界是否被破壞？
5. `npm run lint`（`tsc --noEmit`）是否通過？（專案內若仍有歷史 TS 錯誤，至少不應新增與本次修改檔案相關的錯誤）

---

## 9. 本檔維護方式

- 若新增 **持久化模組**、**全域事件**、**核心領域規則** 或 **admin 專屬功能**，請同步更新本檔對應小節。
- 目的：**讓後續 agent 與人類在沒有完整聊天脈絡時，仍能對齊架構與產品假設。**
