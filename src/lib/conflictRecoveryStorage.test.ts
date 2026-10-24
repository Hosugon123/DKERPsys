import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyConflictRecoveryAfterRemoteImport,
  hasConflictRecoveryBundle,
  stashLocalBundleForConflictRecovery,
  clearConflictRecoveryBundle,
} from './conflictRecoveryStorage';

describe('conflict recovery storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the recovery bundle after sessionStorage is cleared', () => {
    localStorage.setItem('dongshan_store_code_v1', JSON.stringify('009'));
    stashLocalBundleForConflictRecovery();

    localStorage.setItem('dongshan_store_code_v1', JSON.stringify('001'));
    sessionStorage.clear();

    expect(hasConflictRecoveryBundle()).toBe(true);
    expect(applyConflictRecoveryAfterRemoteImport()).toBe(true);
    expect(localStorage.getItem('dongshan_store_code_v1')).toBe('"001"');
    expect(hasConflictRecoveryBundle()).toBe(true);
    clearConflictRecoveryBundle();
    expect(hasConflictRecoveryBundle()).toBe(false);
  });
});
