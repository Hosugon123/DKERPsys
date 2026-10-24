import { gzipSync, gunzipSync } from 'node:zlib';

export const SYNC_ENCODING = 'gzip-base64-v1';
const MAX_WIRE_BYTES = 4_000_000;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

export function decodeSyncRequest(body) {
  if (!body || typeof body !== 'object' || !('encoding' in body)) return body;
  if (body.encoding !== SYNC_ENCODING || typeof body.data !== 'string' ||
      body.data.length > MAX_WIRE_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) {
    throw new Error('invalid compressed sync payload');
  }
  const text = gunzipSync(Buffer.from(body.data, 'base64'), {
    maxOutputLength: MAX_EXPANDED_BYTES,
  }).toString('utf8');
  return JSON.parse(text);
}

export function encodeSyncResponse(value) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) < 128 * 1024) return value;
  const data = gzipSync(json).toString('base64');
  if (data.length + 100 > MAX_WIRE_BYTES) {
    throw new Error('compressed sync response exceeds limit; archive data before retrying');
  }
  return { encoding: SYNC_ENCODING, data };
}
