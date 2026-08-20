import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageQuotaError,
  isQuotaExceededError,
  setLocalStorageItemWithQuotaRecovery,
} from './localStorageGuard';

function quotaError(): Error & { code: number } {
  const error = new Error('quota exceeded') as Error & { code: number };
  error.name = 'QuotaExceededError';
  error.code = 22;
  return error;
}

describe('localStorage quota guard', () => {
  const originalSetItem = Storage.prototype.setItem;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('辨識瀏覽器儲存空間額滿錯誤', () => {
    expect(isQuotaExceededError(quotaError())).toBe(true);
    expect(isQuotaExceededError(new Error('other'))).toBe(false);
  });

  it('寫入額滿時清除可重建暫存並重試，不刪核心營運資料', () => {
    localStorage.setItem('dongshan_conflict_recovery_bundle_v1', 'temporary-conflict-backup');
    localStorage.setItem('dongshan_pwa_icon_v1', 'temporary-icon');
    localStorage.setItem('dongshan_order_history_v1', '[{"id":"keep"}]');

    let targetWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key: string, value: string) {
      if (key === 'dongshan_order_history_v1') {
        targetWrites += 1;
        if (targetWrites === 1) throw quotaError();
      }
      return originalSetItem.call(this, key, value);
    });

    const removed = setLocalStorageItemWithQuotaRecovery('dongshan_order_history_v1', '[{"id":"new"}]');

    expect(removed).toEqual(['dongshan_conflict_recovery_bundle_v1', 'dongshan_pwa_icon_v1']);
    expect(localStorage.getItem('dongshan_order_history_v1')).toBe('[{"id":"new"}]');
    expect(localStorage.getItem('dongshan_conflict_recovery_bundle_v1')).toBeNull();
    expect(localStorage.getItem('dongshan_pwa_icon_v1')).toBeNull();
  });

  it('清除暫存後仍額滿時丟出中文可讀錯誤', () => {
    localStorage.setItem('dongshan_performance_debug_v1', '1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key: string, value: string) {
      if (key === 'dongshan_order_history_v1') throw quotaError();
      return originalSetItem.call(this, key, value);
    });

    expect(() => setLocalStorageItemWithQuotaRecovery('dongshan_order_history_v1', '[]')).toThrow(
      LocalStorageQuotaError,
    );
    expect(() => setLocalStorageItemWithQuotaRecovery('dongshan_order_history_v1', '[]')).toThrow(
      '瀏覽器儲存空間已滿',
    );
  });
});
