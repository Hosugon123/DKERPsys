import { beforeEach, describe, expect, it } from 'vitest';
import { allocateOrderSerialId } from './orderSerialId';

describe('allocateOrderSerialId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds a random suffix so separate offline devices do not create the same order id', () => {
    const at = new Date('2026-06-13T10:00:00.000+08:00');
    const deviceA = allocateOrderSerialId([], at, '001');

    localStorage.clear();
    const deviceB = allocateOrderSerialId([], at, '001');

    expect(deviceA).toMatch(/^001202606131-[a-z0-9]{8}$/i);
    expect(deviceB).toMatch(/^001202606131-[a-z0-9]{8}$/i);
    expect(deviceA).not.toBe(deviceB);
  });

  it('continues the numeric sequence from existing suffixed order ids', () => {
    const at = new Date('2026-06-13T10:00:00.000+08:00');
    const id = allocateOrderSerialId(
      ['001202606131-deadbeef', '001202606132-cafebabe'],
      at,
      '001',
    );

    expect(id).toMatch(/^001202606133-[a-z0-9]{8}$/i);
  });
});
