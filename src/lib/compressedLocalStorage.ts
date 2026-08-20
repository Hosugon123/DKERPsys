import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

const COMPRESSED_PREFIX = '__DKERP_LZ16_V1__';
const MIN_COMPRESS_CHARS = 1024;

const COMPRESSIBLE_KEYS = new Set<string>([
  'dongshan_accounting_ledger_v1',
  'dongshan_order_history_v1',
  'dongshan_franchise_mgmt_orders_v1',
  'dongshan_stall_inventory_v1',
  'dongshan_sales_records_v1',
  'dongshan_franchisee_retail_v1',
  'dongshan_data_archives_v1',
]);

let installed = false;

function shouldCompressKey(key: string): boolean {
  return COMPRESSIBLE_KEYS.has(key);
}

export function encodeLocalStorageValue(key: string, value: string): string {
  if (!shouldCompressKey(key) || value.length < MIN_COMPRESS_CHARS) return value;
  const compressed = compressToUTF16(value);
  if (!compressed) return value;
  const encoded = `${COMPRESSED_PREFIX}${compressed}`;
  return encoded.length < value.length ? encoded : value;
}

export function decodeLocalStorageValue(value: string | null): string | null {
  if (value == null || !value.startsWith(COMPRESSED_PREFIX)) return value;
  const decoded = decompressFromUTF16(value.slice(COMPRESSED_PREFIX.length));
  return decoded ?? value;
}

export function installCompressedLocalStorage(): void {
  if (installed || typeof window === 'undefined' || !window.localStorage) return;
  const proto = Object.getPrototypeOf(window.localStorage) as Storage;
  const originalGetItem = proto.getItem;
  const originalSetItem = proto.setItem;

  Object.defineProperty(proto, 'getItem', {
    configurable: true,
    writable: true,
    value(this: Storage, key: string) {
      const value = originalGetItem.call(this, key);
      return decodeLocalStorageValue(value);
    },
  });

  Object.defineProperty(proto, 'setItem', {
    configurable: true,
    writable: true,
    value(this: Storage, key: string, value: string) {
      return originalSetItem.call(this, key, encodeLocalStorageValue(key, String(value)));
    },
  });

  installed = true;
}
