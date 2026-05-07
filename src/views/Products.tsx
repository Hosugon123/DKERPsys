import { Download } from 'lucide-react';
import CostStructureTable from '../components/CostStructureTable';
import { dataBundle } from '../services/apiService';

function todayFilenameStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

async function downloadCostBackup() {
  const blob = new Blob([await dataBundle.serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dongshan-cost-${todayFilenameStamp()}.json`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Products() {
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">產品與成本庫存</h2>
          <p className="text-zinc-500 mt-1">
            自訂欄位與品項紀錄成本；僅在「漲縮率」欄有填寫的品項可展開補充「未滷／成品成本」。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void downloadCostBackup()}
            className="px-4 py-2 border border-zinc-700 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors font-medium flex items-center gap-2 text-sm"
            title="下載完整 JSON 備份（含成本結構表）"
          >
            <Download size={18} /> 匯出 JSON 備份
          </button>
        </div>
      </div>

      <CostStructureTable />
    </div>
  );
}
