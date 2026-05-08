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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">產品與成本庫存</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void downloadCostBackup()}
            className="min-h-10 px-4 py-2 border border-zinc-700 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700 transition-colors font-medium flex items-center gap-2 text-sm whitespace-nowrap"
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
