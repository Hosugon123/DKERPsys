import { useCallback, useEffect, useState } from 'react';
import { ledger } from '../services/apiService';
import {
  ACCOUNTING_LEDGER_UPDATED_EVENT,
  type AccountingLedgerEntry,
  type AccountingLedgerUpdate,
  type NewAccountingLedgerInput,
} from '../lib/accountingLedgerStorage';

/** 流水帳：經 apiService 非同步讀寫，並訂閱 ACCOUNTING_LEDGER_UPDATED_EVENT 同步畫面 */
export function useAccountingLedger() {
  const [entries, setEntries] = useState<AccountingLedgerEntry[]>([]);

  const reload = useCallback(async () => {
    setEntries(await ledger.listEntries());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await ledger.listEntries();
      if (!cancelled) setEntries(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      void reload();
    };
    window.addEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, sync);
    return () => window.removeEventListener(ACCOUNTING_LEDGER_UPDATED_EVENT, sync);
  }, [reload]);

  const add = useCallback(async (input: NewAccountingLedgerInput) => {
    await ledger.append(input);
  }, []);

  const update = useCallback(async (id: string, patch: AccountingLedgerUpdate) => {
    await ledger.update(id, patch);
  }, []);

  const remove = useCallback(async (id: string) => {
    await ledger.remove(id);
  }, []);

  return { entries, add, update, remove };
}
