const COMPRESSION_THRESHOLD = 128 * 1024;
export const MAX_SYNC_WIRE_BYTES = 4_000_000;
export const SYNC_ENCODING = 'gzip-base64-v1';

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

export async function encodeSyncRequest(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json);
  let wire = json;
  if (bytes.byteLength >= COMPRESSION_THRESHOLD && typeof CompressionStream !== 'undefined') {
    // Native streaming compression avoids a synchronous JS compression loop on phones.
    const input = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    });
    const compressed = new Uint8Array(await new Response(
      input.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer());
    const envelope = JSON.stringify({ encoding: SYNC_ENCODING, data: bytesToBase64(compressed) });
    if (envelope.length < bytes.byteLength) wire = envelope;
  }
  if (new TextEncoder().encode(wire).byteLength > MAX_SYNC_WIRE_BYTES) {
    throw new Error('同步資料超過傳輸上限，請保留此裝置資料並聯絡管理員協助歸檔；請勿重複送單。');
  }
  return wire;
}

export async function decodeSyncResponse(value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('encoding' in value)) return value;
  const envelope = value as { encoding: string; data?: string };
  if (envelope.encoding !== SYNC_ENCODING || typeof envelope.data !== 'string') {
    throw new Error('遠端同步壓縮格式錯誤。');
  }
  const bytes = Uint8Array.from(atob(envelope.data), (ch) => ch.charCodeAt(0));
  const input = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  return JSON.parse(await new Response(
    input.pipeThrough(new DecompressionStream('gzip')),
  ).text());
}
