import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendAccountingLedgerEntry,
  listAccountingLedgerEntries,
  type AccountingLedgerEntry,
} from './accountingLedgerStorage';

const EMP_A = 'emp-a';
const EMP_B = 'emp-b';
const ADMIN_ID = 'admin-1';

vi.mock('./authSession', () => ({
  readSession: () => ({ userId: EMP_A, role: 'employee' }),
}));

vi.mock('./systemUsersStorage', () => ({
  listSystemUsers: () => [
    { id: EMP_A, name: '員工甲', role: 'employee', employeeOrgType: 'hq' },
    { id: EMP_B, name: '員工乙', role: 'employee', employeeOrgType: 'hq' },
    { id: ADMIN_ID, name: '管理員', role: 'admin' },
  ],
}));

vi.mock('./sessionActorDisplayName', () => ({
  resolveUserDisplayNameById: (id: string) =>
    id === EMP_A ? '員工甲' : id === EMP_B ? '員工乙' : '管理員',
}));

function seedStore(rows: AccountingLedgerEntry[]) {
  localStorage.setItem(
    'dongshan_accounting_ledger_v1',
    JSON.stringify({ version: 2, byScope: { 'scope:hq': rows } }),
  );
}

describe('employee ledger visibility', () => {
  beforeEach(() => {
    const now = new Date().toISOString();
    seedStore([
      {
        id: 'e-admin',
        dateYmd: '2026-06-01',
        flowType: 'expense',
        category: '直營店營業支出',
        note: 'admin',
        amount: 100,
        createdAt: now,
        updatedAt: now,
        scopeId: 'scope:hq',
        createdByUserId: ADMIN_ID,
        createdByName: '管理員',
      },
      {
        id: 'e-b',
        dateYmd: '2026-06-02',
        flowType: 'expense',
        category: '直營店營業支出',
        note: 'emp b',
        amount: 200,
        createdAt: now,
        updatedAt: now,
        scopeId: 'scope:hq',
        createdByUserId: EMP_B,
        createdByName: '員工乙',
      },
      {
        id: 'e-payroll',
        dateYmd: '2026-06-03',
        flowType: 'expense',
        category: '直營店薪資',
        note: 'payroll',
        amount: 300,
        createdAt: now,
        updatedAt: now,
        scopeId: 'scope:hq',
        createdByUserId: ADMIN_ID,
      },
    ]);
  });

  it('lists same-store employee entries but hides admin and payroll', () => {
    const visible = listAccountingLedgerEntries();
    expect(visible.map((e) => e.id)).toEqual(['e-b']);
  });

  it('append still attributes to current employee', () => {
    appendAccountingLedgerEntry({
      dateYmd: '2026-06-04',
      flowType: 'expense',
      category: '直營店營業支出',
      note: 'mine',
      amount: 50,
    });
    const visible = listAccountingLedgerEntries();
    expect(visible.some((e) => e.note === 'mine' && e.createdByUserId === EMP_A)).toBe(true);
  });
});
