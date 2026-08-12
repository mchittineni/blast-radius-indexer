import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/source';

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const results = await mapWithConcurrency([30, 10, 20, 0], 2, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    expect(results).toEqual([30, 10, 20, 0]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return null;
      },
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 'x')).toEqual([]);
  });

  it('clamps a nonsensical limit to at least one worker', async () => {
    expect(await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6]);
  });

  it('propagates a worker rejection', async () => {
    await expect(
      mapWithConcurrency([1], 1, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
