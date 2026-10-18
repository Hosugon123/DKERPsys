import React from 'react';
import { createRoot } from 'react-dom/client';
import Orders from '../../src/views/Orders';
import '../../src/index.css';

// Isolated, local-only browser fixture. Never imports a production data bundle.
const params = new URLSearchParams(location.search);
const role = (params.get('role') ?? 'admin') as 'admin' | 'employee' | 'franchisee';
const count = Number(params.get('count') ?? 600);
const scopeId = role === 'franchisee' ? 'scope:franchisee:perf-user' : 'scope:hq';
localStorage.clear();
localStorage.setItem('dongshan_session_v1', JSON.stringify({ userId: 'perf-user', loginId: 'perf', role }));
localStorage.setItem('dongshan_system_users_v1', JSON.stringify({ version: 1, users: [{
  id: 'perf-user', loginId: 'perf', role, status: 'active', name: 'Perf', employeeOrgType: 'hq',
  email: 'perf@example.test', phone: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}] }));
const date = new Date();
const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const lines = Array.from({ length: 40 }, (_, i) => ({ productId: `s${String(i + 1).padStart(2, '0')}`, name: `Item ${i}`, qty: 10, unitPrice: 4, unit: '份' }));
const rows = Array.from({ length: count }, (_, i) => ({
  id: `perf-${i}`, createdAt: `${ymd}T08:00:00.000Z`, updatedAt: `${ymd}T08:00:00.000Z`,
  orderDateYmd: ymd, scopeId, actorRole: role, actorUserId: 'perf-user', source: 'procurement',
  status: i < 2 ? '待出貨' : '已完成', totalAmount: 1600, payableAmount: 1600, itemCount: 400,
  storeLabel: role === 'franchisee' ? 'Perf Store' : '直營店', lines,
  ...(i >= 2 ? { stallCountBasisYmd: ymd, stallCountCompletedAt: `${ymd}T09:00:00.000Z`,
    stallCountSnapshot: { lines: Object.fromEntries(lines.map(l => [l.productId, { out: '10', remain: '0' }])) } } :
    { procurementDeductionBasisOrderId: `perf-${count - 1}` }),
}));
localStorage.setItem('dongshan_order_history_v1', JSON.stringify(rows));
localStorage.setItem('dongshan_franchise_mgmt_orders_v1', '[]');
createRoot(document.getElementById('root')!).render(<Orders userRole={role} />);
