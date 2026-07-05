# DKERPsys 東山鴨頭 ERP 系統

這是東山鴨頭門市、加盟主、員工與管理員共同使用的 ERP 系統。系統核心不是單純的畫面，而是一整條「叫貨、出貨、盤點、銷售、剩餘、金額、同步」的資料流。

本文是專案的底層運算架構與保護契約。除非使用者明確要求修改這些規則，否則任何功能調整、UI 調整、效能調整、重構、套件升級，都不得破壞本文列出的按鈕行為、數字流動、計算法則與資料同步規則。

## 開發指令

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

## 效能量測與 PWA 檢查

系統讀取緩慢不得只靠感覺判斷。每次懷疑登入、首頁、Dashboard、PWA 或 API 變慢時，先跑以下量測，保留 `reports/performance/` 產出的 JSON 與 Markdown 報告，再決定是否重構。

```bash
npm run perf:test
npm run perf:mobile
npm run perf:pwa
npm run perf:report
```

預設量測目標是正式站：

```text
https://dksys.vercel.app
```

可用環境變數改目標與次數：

```bash
PERF_BASE_URL=https://dksys.vercel.app PERF_ITERATIONS=5 PERF_LOAD_ITERATIONS=10 npm run perf:report
```

如果要量測授權後的 `/api/sync-bundle` 真實 bundle 大小與 JSON parse 耗時，需在本機環境提供 token：

```bash
PERF_API_TOKEN=你的同步token npm run perf:report
```

效能腳本的安全規則：

- 預設只做 `GET`，不會 `PUT`，不會改 Redis，不會改正式資料。
- 沒有 token 時只量未授權 API latency、headers、首頁、manifest、assets、Service Worker 候選檔。
- 有 token 時只讀取 `/api/sync-bundle`，用來量 bundle 大小、Redis/API 回應時間、JSON parse 時間與最大 storage key。
- 10 天與 50 天資料量測使用本機 synthetic bundle，不會塞進正式資料庫。

重點觀察欄位：

| 指標 | 意義 | 優先判讀 |
| --- | --- | --- |
| Home p95 | 首頁 HTML 回應 | 若高，先查 Vercel/網路/cold start |
| Sync bundle p95 | `/api/sync-bundle` 回應 | 若高，查 Redis、payload、server timing |
| bundle approxChars | 整包資料大小 | 若持續變大，需拆資料或做摘要 API |
| JSON parse ms | 前端解析成本 | iPhone PWA 特別敏感 |
| localStorage import | 匯入本機儲存成本 | 若慢，需減少整包寫入 |
| dashboard.reload-primary | Dashboard 主要資料處理 | 若慢，需做 Dashboard summary/cache |
| dashboard.reload-sales-records.snapshots | 銷售快照讀取 | 若慢，需分頁或摘要 |
| longtask | 主執行緒卡住超過 50ms | iPhone 操作卡頓常見來源 |

iPhone 實測流程：

1. Safari 開啟 `https://dksys.vercel.app/?perf=1`，登入後進 Dashboard。
2. 刪除舊的主畫面圖示，重新加入主畫面，再用 PWA 開同一網址。
3. 用 Safari Web Inspector 看 console 的 `[perf]` / `[perf:slow]`。
4. 比較 Safari 與 PWA 的 `remote.fetch-bundle.request`、`remote.fetch-bundle.json`、`remote.init.import-bundle`、`dashboard.reload-primary`、`dashboard.reload-sales-records.snapshots`、`longtask`。
5. 若 PWA 比 Safari 慢，但 API 時間差不多，優先查 iOS standalone storage、localStorage 匯入、JS parse、Dashboard render。

目前架構結論：

- 正式資料流不是 SQL/ORM 查詢，而是 Vercel API 從 Redis 取回整包 localStorage snapshot。
- 因此慢點通常分成：網路/API、Redis get/set、JSON parse/stringify、localStorage 讀寫、Dashboard 前端計算、iOS PWA standalone 特性。
- 在沒有量測數據前，不得直接更換資料庫、框架或部署平台。

正式站：

```text
https://dksys.vercel.app/
```

每次開始開發前必須先檢查遠端版本：

```bash
git fetch origin
git status --short --branch
```

若本機落後遠端且工作樹乾淨，優先使用：

```bash
git pull --ff-only origin main
```

## 核心保護原則

以下功能屬於 S0 級別，壞掉會直接影響員工、加盟主與管理員對系統的信任：

- 批貨與下單
- 訂單管理
- 訂單修改貨量
- 出貨與待出貨狀態
- 攤上盤點
- 銷售紀錄
- 剩餘貨量
- 叫貨扣除指定訂單剩餘
- 盤點植入訂單
- 金額、營收、批貨款、消耗品、毛利、支出
- 多裝置同步與資料合併
- 管理員、加盟主、員工的資料可見範圍

除非使用者明確說要改這些底層規則，否則不得因為 UI、排版、效能、命名、重構而改變它們。

修改 S0 功能後至少要跑：

```bash
npm run lint
npm test
npm run build
```

如果有正式站相關疑慮，還要驗證：

```text
https://dksys.vercel.app/build-version.json
```

確認正式站 buildId 已經是目標 commit。

## 系統角色與資料範圍

系統主要角色：

- `admin`：管理員，可看總部與授權範圍內資料。
- `franchisee`：加盟主，只能看自己的店別資料。
- `employee`：員工，依總部或所屬加盟主範圍看資料。

資料範圍以 `scopeId` 區隔：

- 總部直營：`scope:hq`
- 加盟店：`scope:franchisee:<userId>`

任何訂單、盤點、銷售、扣餘、同步合併，都必須保留 scope 隔離。不得讓管理員自己的直營訂單誤用加盟店剩餘，也不得讓 DK002 的資料混到 DK003。

## 主要資料儲存

目前資料以 localStorage JSON bundle 為主，正式站 remote 模式會透過 `/api/sync-bundle` 同步整包資料。

重要 key：

- `dongshan_order_history_v1`：一般訂單歷史，多用於加盟主與部分訂單來源。
- `dongshan_franchise_mgmt_orders_v1`：管理端訂單管理資料。
- `dongshan_stall_inventory_v1`：攤上盤點工作資料。
- `dongshan_sales_records_v1`：銷售紀錄快照。
- `dongshan_deleted_order_ids_v1`：刪除訂單 tombstone，避免多裝置同步後復活。
- `dongshan_procurement_favorites_v1`：常用訂單。
- `dongshan_procurement_stall_basis_order_id`：批貨頁選取的扣餘基準訂單。
- `dongshan_system_users_v1`：使用者。
- `dongshan_login_credentials_v1`：登入帳密。

新增重要資料 key 時，必須確認有加入：

- `src/lib/appDataBundle.ts` 的 `DONGSHAN_EXPORT_STORAGE_KEYS`
- remote bundle merge 邏輯
- 必要的同步事件

## 遠端同步契約

正式站 remote 模式使用：

- `GET /api/sync-bundle`：讀取雲端 bundle。
- `PUT /api/sync-bundle`：推送本機 bundle。

UI 不應直接寫 localStorage 後就結束；應優先透過 `src/services/apiService.ts` 對外 API，讓 remote 模式能正確同步。

同步層規則：

- 一般寫入走 `withRemoteStorageWrite` 或 `withRemoteStorageWriteDeferPush`。
- 日常寫入應盡量避免阻塞 UI。
- 正常情況直接 PUT。
- 只有遇到 409 版本衝突時才 GET 雲端 bundle、merge、再重試 PUT。
- 多裝置合併必須保留本機 dirty keys 與訂單 union merge。
- 有未儲存工作或 pending push 時，不應強制拉遠端覆蓋本地。

不得為了效能直接移除同步、移除 tombstone、移除 scope merge、或改成最後寫入者無條件覆蓋全部資料。

## 訂單生命週期

訂單核心狀態：

- `待出貨`
- `已完成`
- `已取消`

在攤上盤點語境中，`已完成` 顯示為「已出貨」。

訂單日期以 `effectiveOrderDateYmd(order)` 為準：

- 優先使用 `orderDateYmd`
- 沒有時才從 `createdAt` 推得

訂單可同時存在於不同 store，讀取時必須透過合併入口：

- `readMergedOrderByIdFromStores`
- `listAllMergedOrdersFromStores`
- 訂單管理畫面自己的合併列邏輯

不得只讀其中一個 storage key 就判定訂單不存在。

刪除訂單必須：

- 從相關 store 移除。
- 寫入 `dongshan_deleted_order_ids_v1` tombstone。
- 清理該訂單相關盤點資料。
- 經 remote sync 合併時不得復活。

## 批貨與下單契約

批貨頁有三個核心數字：

- 基準叫貨量：使用者想要本次實際帶出的總量。
- 上張剩餘：所選已盤點訂單的剩餘貨量。
- 本次叫貨量：真正送出的新訂單數量。

扣除規則：

```text
本次叫貨量 = max(0, 基準叫貨量 - 上張剩餘)
```

例：

```text
基準叫貨 2000
上張剩餘 500
本次叫貨 1500
```

批貨頁「以目前購物車扣除盤點剩餘」按鈕必須：

- 使用目前購物車作為基準叫貨量。
- 使用所選「已完成盤點」訂單作為扣餘基準。
- 每個品項獨立扣除。
- 若剩餘大於等於基準量，該品項本次叫貨變 0。
- 不得只扣部分品項。
- 不得只吃 productId，必須相容舊資料的品名 key 或舊品項 key。

常用訂單帶入並扣除剩餘時，也必須使用同一套扣餘邏輯，不可另寫一套。

送出訂單後，如果有指定扣餘基準訂單，必須真正扣掉該基準單的可扣剩餘，避免同一份剩餘被後續訂單重複扣。

相關核心函式：

- `cartAfterDeductingStallRemainFromOrder`
- `cartAfterDeductingStallRemainFromSnapshot`
- `loadBasisOrderRemainForProcurementDeduction`
- `buildProcurementRemainDeductionsFromLines`
- `applyOrderDeductionToDayRemain`
- `ensureBasisDayFromOrderSnapshot`

## 舊資料與品名 key 相容契約

歷史訂單或盤點快照可能不是用目前 catalog 的 productId 儲存，而是用：

- 現行 productId，例如 `s01`
- 目前品名，例如 `黑輪`
- 舊品名 alias，例如 `legacy-s01`
- 訂單 line 當時的 name

讀取剩餘時必須相容上述 key。

核心規則：

- 直接 productId 有有效 remain 時，優先使用。
- 如果 productId remain 是 0 或空，但品名 key / 舊品名 key 有有效 remain，必須讀到該 remain。
- order lines 的 `name` 必須被視為該訂單快照的合法 alias。
- 批貨頁預覽扣除與送出訂單實際扣庫必須使用同一套 alias 邏輯。

不得恢復成只讀：

```ts
day.lines[id]?.remain
basis.lines[productId]?.remain
```

必須使用相容讀法，例如：

```ts
frozenRemainQtyForItem(day, id)
```

### 批貨頁「上週／最高／最低／平均」參考規則

批貨頁底部與品項卡片中的售出參考，屬於叫貨核心判斷資料。除非需求明確要求，不能任意改動資料來源或統計口徑。

- `上週`：以目前訂單歸屬日往前 7 天為參考日，只讀目前登入帳號所屬店鋪 scope 的銷售紀錄或盤點快照。
- `最高`：在目前登入帳號所屬店鋪、目標同星期幾的歷史資料中，選出營業額最高的那一天，再顯示該日各品項售出量。
- `最低`：在目前登入帳號所屬店鋪、目標同星期幾的歷史資料中，選出營業額最低的那一天，再顯示該日各品項售出量。
- `平均`：在目前登入帳號所屬店鋪、目標同星期幾的歷史資料中，逐品項加總售出量後除以有資料天數。

`最高`／`最低` 的營業額判定順序：

1. 優先使用銷售紀錄或盤點快照中的實收營業額 `actualRevenue`。
2. 若未填實收，使用該日銷售／盤點快照的「零售參考價 × 售出量」推估營業額。
3. 只有在無法取得零售推估時，才可退回保底比較值；不得把「總售出數量」當成正式營業額口徑。

此規則必須保持店鋪隔離：

- 總部／直營視角只看 `scope:hq` 的直營資料。
- 加盟主視角只看 `scope:franchisee:<userId>` 與該加盟主自己的歷史資料。
- 不可把 DK002、DK003、直營店或其他加盟店的參考日混在一起統計。

相關實作與測試：

- `src/lib/procurementWeekdayReference.ts`
- `src/lib/procurementWeekdayReference.test.ts`

## 盤點植入訂單契約

當下一張訂單是由「扣除上張盤點剩餘」產生時，攤上盤點植入訂單的帶出量必須還原成實際帶出：

```text
盤點帶出量 = 上張剩餘 + 本次叫貨量
```

例：

```text
上張剩餘 500
本次叫貨 1500
盤點植入帶出量 2000
```

這是非常重要的規則。批貨頁扣掉剩餘，是為了避免重複叫貨；盤點頁植入時加回剩餘，是為了現場實際帶出數正確。

相關核心函式：

- `computeStallOutImportBreakdown`
- `recomputeStallOutForStallYmdAndOrder`
- `syncStallOutAfterOrderLinesChanged`
- `prevRemainForBringOut`
- `loadRemainSnapshotForProcurementBringOut`

不得把「本次叫貨量」誤當成「實際帶出量」。

## 攤上盤點契約

盤點資料以品項為單位：

```text
帶出 out
剩餘 remain
售出 sold = max(0, out - remain)
```

盤點輸入必須支援：

- 手動輸入數字
- 加減按鈕
- 售完
- 儲存
- 植入訂單
- 完成盤點

完成盤點時必須：

- 保存 stall day snapshot。
- 保存 sales record snapshot。
- 在訂單上寫入 `stallCountBasisYmd`。
- 在訂單上寫入 `stallCountCompletedAt`。
- 在訂單上寫入 `stallCountSnapshot`。
- 驗證 snapshot 有成功寫回訂單，避免只存在畫面記憶體。

盤點日與 scope 必須由訂單決定，不可只用當天日期或目前登入者猜測。

相關核心函式：

- `commitStallInventoryComplete`
- `setOrderStallCountStamp`
- `saveDay`
- `saveSalesRecord`
- `stallCountSnapshotPersistedMatches`

## 銷售紀錄契約

銷售紀錄與訂單管理中的已盤點訂單必須一致。

已完成盤點的訂單顯示銷售數據時，優先使用 frozen snapshot，避免後續盤點日資料變動造成歷史訂單數字漂移。

銷售紀錄必須保留：

- out
- remain
- sold
- actualRevenue
- revenueGapAmount
- revenueGapReason
- frozen retail / wholesale unit price

訂單管理中的剩餘、銷售、應有營收、帶出金額，不得和銷售紀錄互相打架。

相關核心函式：

- `mergeSalesRecordWithCatalog`
- `getOrderStallDisplayEconomics`
- `getStallDisplayShouldRevenue`
- `getStallDisplaySoldAtRetail`
- `getStallDisplayRetailEstAndRemain`
- `getStallDisplayActualRevenue`

## 訂單管理契約

訂單管理必須支援：

- 查看訂單
- 篩選狀態
- 出貨
- 取消
- 刪除
- 修改未出貨或允許修改的訂單貨量
- 儲存貨量後回到非編輯狀態
- 顯示叫貨量、帶出量、剩餘、售出、金額
- 區分直營與加盟資料範圍

調整貨量時：

- UI 上按「儲存貨量」後，若後端成功，畫面必須回到一般狀態。
- 不得讓使用者看起來像沒儲存。
- 若訂單已關聯盤點帶出，改單後必須同步重算盤點帶出。
- 最新修改必須成為最終解釋，舊裝置同步不得覆蓋較新的 line updatedAt。

相關核心函式：

- `updatePendingOrderLinesById`
- `updateEditableOrderLinesById`
- `patchOrderLinesInEitherStore`
- `orderLineQtyMapsEqual`
- `stampChangedOrderLines`
- `syncStallOutAfterOrderLinesChanged`

## 金額與計算契約

一般公式：

```text
售出數量 = max(0, 帶出 - 剩餘)
應有營收 = Σ(售出數量 × 零售單價)
批貨金額 = Σ(叫貨數量 × 批貨單價)
帶出估值 = Σ(帶出數量 × 零售單價)
```

批貨金額與零售營收不可混用：

- 批貨金額是加盟叫貨 / 進貨成本概念。
- 零售營收是攤上售出後的應有營收概念。
- 消耗品可有批貨款，但不應被當成攤上銷售品項計入一般販售品 sold。

加盟主自備品：

- 可影響應付貨款。
- 不得破壞盤點銷售數。

計算金額時要注意：

- 使用凍結單價避免歷史資料因 catalog 價格變更而漂移。
- 小數數量必須用 `roundProcurementQty` 規則。
- 金額用穩定 rounding，不得累積浮點誤差。

## 批貨週參考契約

批貨頁參考售出量用於輔助下單，不得影響真實訂單或盤點資料。

參考模式：

- 上週同星期
- 最高
- 平均
- 最低

規則：

- 只計入目前店別 / scope 可見資料。
- 同日多單不應重複累加造成膨脹。
- 優先使用已盤點的銷售紀錄或 frozen snapshot。
- 最高 / 最低依單日營業額或既定參考規則選擇，不得混入其他加盟店。

相關核心函式：

- `computeProcurementWeekdaySoldReference`
- `computeProcurementLastWeekSameDaySold`
- `ordersForProcurementSoldReference`
- `pickReferenceYmdByDayRevenue`

## 按鈕行為保護清單

以下按鈕行為不得在未明確要求下變更。

### 批貨與下單

- 「以目前購物車扣除盤點剩餘」：以目前購物車為基準，扣所選已盤點訂單剩餘。
- 「清空」：只清目前購物車或目前選取，不得刪除歷史資料。
- 「送出訂單」：建立訂單、寫入正確 store、保留 scope、必要時扣基準單剩餘。
- 常用訂單帶入：套用常用數量；若選擇扣餘，必須套用同一套扣餘邏輯。

### 訂單管理

- 「出貨 / 完成」：更新訂單狀態，並讓攤上盤點可選到該訂單。
- 「取消」：狀態改已取消，不可再當成扣餘基準。
- 「調整貨量」：進入編輯狀態。
- 「儲存貨量」：保存成功後回到非編輯狀態，並同步重算關聯盤點帶出。
- 「刪除」：寫 tombstone，防止同步復活。

### 攤上盤點

- 「植入訂單」：帶入實際帶出量，不是單純叫貨量。
- 「售完」：remain 設為 0。
- 「儲存」：保存當日盤點工作資料。
- 「完成盤點」：同時保存 sales record、stall inventory、order snapshot。

### 銷售紀錄

- 修改銷售 / 剩餘時，必須保持訂單管理中的已盤點數字可正確顯示。
- 不得因同步或 catalog merge 把已填剩餘清 0。

### 權限與資料管理

- 管理員帳號操作不得把加盟 scope 改成總部 scope。
- 加盟主只能看到自己的訂單、盤點、銷售與叫貨資料。
- 員工依所屬範圍操作。
- DataHub / 匯入匯出不可破壞 tombstone、scope、updatedAt。

## 變更這些規則前的必要流程

若需求明確要改底層規則，必須：

1. 先指出要改哪一條契約。
2. 說明改動會影響哪些畫面和資料流。
3. 補或更新測試。
4. 跑 `npm run lint`、`npm test`、`npm run build`。
5. 若正式站相關，確認 buildId。

若需求只是 UI、排版、文案、顏色、效能、小功能，預設不得改動本 README 的底層契約。

## 核心測試參考

與 S0 功能相關的測試包括：

- `src/lib/procurementAllItemsDeduction.test.ts`
- `src/lib/procurementBasisSync.test.ts`
- `src/lib/procurementBasisVisibility.test.ts`
- `src/lib/procurementOrderManagement.test.ts`
- `src/lib/procurementWeekdayReference.test.ts`
- `src/lib/stallBringOutBehavior.test.ts`
- `src/lib/stallQtySync.test.ts`
- `src/lib/stallScopeIsolation.test.ts`
- `src/lib/orderStallSnapshot.test.ts`
- `src/lib/orderLinePatchEitherStore.test.ts`
- `src/lib/orderEitherStore.test.ts`
- `src/lib/orderDelete.test.ts`
- `src/lib/orderDeleteStallCleanup.test.ts`
- `src/lib/orderFranchiseeVisibility.test.ts`
- `src/lib/multiDeviceSync.test.ts`
- `src/services/remoteSyncHub.test.ts`
- `src/lib/appDataBundleMerge.test.ts`
- `src/lib/crossModuleDataIntegrity.test.ts`
- `src/lib/financeConsumable.test.ts`

新增核心功能時，應優先補在這些測試附近，或新增同層級測試檔。

## 給後續開發者與 AI 助手

這個系統的價值在於現場工作可信。叫貨、改單、出貨、盤點、銷售、剩餘與金額，只要其中一段數字不穩，使用者就會失去信任。

因此請記住：

- 不要為了讓畫面看起來快，犧牲資料正確。
- 不要為了簡化程式，刪掉舊資料 alias 相容。
- 不要為了修單一帳號，破壞其他 scope。
- 不要直接清正式資料。
- 不要讓同步覆蓋最新操作。
- 不要讓已盤點歷史訂單的金額與剩餘漂移。

除非使用者明確要求修改，本文列出的底層運算架構就是系統的保護邊界。
