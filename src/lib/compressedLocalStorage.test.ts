import { describe, expect, it } from 'vitest';
import {
  decodeLocalStorageValue,
  encodeLocalStorageValue,
  installCompressedLocalStorage,
} from './compressedLocalStorage';

describe('compressed localStorage', () => {
  it('大型核心資料底層壓縮，但讀回仍是原始 JSON', () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({
      id: `order-${index}`,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      lines: Array.from({ length: 30 }, (__, lineIndex) => ({
        productId: `p${lineIndex}`,
        name: `品項${lineIndex}`,
        unitPrice: 12.5,
        qty: 100,
        unit: '份',
      })),
    }));
    const raw = JSON.stringify(rows);
    const encoded = encodeLocalStorageValue('dongshan_franchise_mgmt_orders_v1', raw);

    expect(encoded.length).toBeLessThan(raw.length * 0.5);
    expect(decodeLocalStorageValue(encoded)).toBe(raw);
  });

  it('安裝後透明攔截 setItem/getItem，既有程式不用改讀寫方式', () => {
    installCompressedLocalStorage();
    const raw = JSON.stringify(Array.from({ length: 200 }, (_, index) => ({
      id: `order-${index}`,
      storeLabel: '直營店',
      note: 'repeat-repeat-repeat-repeat-repeat',
    })));

    localStorage.setItem('dongshan_franchise_mgmt_orders_v1', raw);

    expect(localStorage.getItem('dongshan_franchise_mgmt_orders_v1')).toBe(raw);
  });
});
