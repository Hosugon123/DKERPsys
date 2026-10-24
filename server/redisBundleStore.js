import { WatchError } from 'redis';

/** Each WATCH transaction needs its own connection, never the shared GET client. */
export async function compareAndSetBundle(redis, key, expectedRaw, nextRaw) {
  const transaction = redis.duplicate({
    disableOfflineQueue: true,
    socket: { connectTimeout: 8000, reconnectStrategy: false },
  });
  transaction.on('error', () => {});
  try {
    await transaction.connect();
    await transaction.watch(key);
    if (await transaction.get(key) !== expectedRaw) return false;
    const result = await transaction.multi().set(key, nextRaw).exec();
    return result?.[0] === 'OK';
  } catch (error) {
    if (error instanceof WatchError) return false;
    throw error;
  } finally {
    if (transaction.isOpen) transaction.destroy();
  }
}
