// @vitest-environment node
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import { compareAndSetBundle } from '../../server/redisBundleStore.js';

// Protocol fixture exercises the actual Redis SDK, not a mock of its transaction methods.
function parseCommand(buffer: Buffer): { args: string[]; bytes: number } | null {
  const end = buffer.indexOf('\r\n');
  if (end < 0) return null;
  const count = Number(buffer.subarray(1, end).toString());
  let pos = end + 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    const header = buffer.indexOf('\r\n', pos);
    if (header < 0) return null;
    const length = Number(buffer.subarray(pos + 1, header).toString());
    const start = header + 2;
    if (buffer.length < start + length + 2) return null;
    args.push(buffer.subarray(start, start + length).toString());
    pos = start + length + 2;
  }
  return { args, bytes: pos };
}

async function fixture(initial: string | null) {
  let value = initial;
  let revision = 0;
  let connectionId = 0;
  const sockets = new Set<Socket>();
  const commands: Array<{ id: number; command: string }> = [];
  const server = createServer((socket) => {
    const id = connectionId++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let watched: number | undefined;
    let queued: string | undefined;
    let multi = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let parsed: ReturnType<typeof parseCommand>;
      while ((parsed = parseCommand(buffer))) {
        buffer = buffer.subarray(parsed.bytes);
        const [raw, ...args] = parsed.args;
        const command = raw.toUpperCase();
        commands.push({ id, command });
        if (command === 'CLIENT') socket.write('+OK\r\n');
        else if (command === 'GET') socket.write(value == null ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`);
        else if (command === 'WATCH') { watched = revision; socket.write('+OK\r\n'); }
        else if (command === 'MULTI') { multi = true; socket.write('+OK\r\n'); }
        else if (command === 'SET' && multi) { queued = args[1]; socket.write('+QUEUED\r\n'); }
        else if (command === 'EXEC') {
          multi = false;
          if (watched !== revision) socket.write('*-1\r\n');
          else { value = queued!; revision++; socket.write('*1\r\n+OK\r\n'); }
          watched = undefined;
        } else socket.write('-ERR keys and arguments would exceed Lua memory limit\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redis = createClient({ url: `redis://127.0.0.1:${(server.address() as AddressInfo).port}`, socket: { reconnectStrategy: false } });
  redis.on('error', () => {});
  await redis.connect();
  return {
    redis, commands, getValue: () => value,
    close: async () => {
      if (redis.isOpen) redis.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('Redis SDK atomic bundle writes without Lua', () => {
  it('writes large Unicode values while the server rejects all Lua commands', async () => {
    const old = '舊'.repeat(500000);
    const next = '新'.repeat(500000);
    const f = await fixture(old);
    try {
      expect(await compareAndSetBundle(f.redis, 'bundle', old, next)).toBe(true);
      expect(f.getValue()).toBe(next);
      expect(f.commands.map((c) => c.command)).toEqual(expect.arrayContaining(['WATCH', 'MULTI', 'SET', 'EXEC']));
      expect(f.commands.some((c) => c.command === 'EVAL')).toBe(false);
    } finally { await f.close(); }
  }, 15000);

  it('uses isolated connections and only one concurrent writer wins', async () => {
    const f = await fixture('old');
    try {
      const results = await Promise.all([
        compareAndSetBundle(f.redis, 'bundle', 'old', 'new-a'),
        compareAndSetBundle(f.redis, 'bundle', 'old', 'new-b'),
      ]);
      expect(results.sort()).toEqual([false, true]);
      expect(['new-a', 'new-b']).toContain(f.getValue());
      expect(new Set(f.commands.filter((c) => c.command === 'WATCH').map((c) => c.id)).size).toBe(2);
    } finally { await f.close(); }
  });

  it('never overwrites a value that changed before the watched read', async () => {
    const f = await fixture('current');
    try {
      expect(await compareAndSetBundle(f.redis, 'bundle', 'stale', 'incorrect')).toBe(false);
      expect(f.getValue()).toBe('current');
      expect(f.commands.some((c) => c.command === 'SET')).toBe(false);
    } finally { await f.close(); }
  });
});
