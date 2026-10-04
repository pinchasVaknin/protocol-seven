import { describe, expect, it } from 'vitest';
import { WAKE_WAIT_MS, WakeWait } from './WakeWait';

/** A question about a body that wakes a snapshot after the damage that asked it. */
describe('WakeWait', () => {
  it('answers a question once the body turns up, and only once', () => {
    const wait = new WakeWait(4);
    const awake = new Set<number>();
    const answered: number[] = [];
    const answer = (id: number): boolean => {
      if (!awake.has(id)) return false;
      answered.push(id);
      return true;
    };
    wait.add(7, 0);
    wait.poll(16, answer);
    expect(answered).toEqual([]);
    awake.add(7);
    wait.poll(66, answer);
    wait.poll(82, answer);
    expect(answered).toEqual([7]);
    expect(wait.size).toBe(0);
  });

  it(`drops a question nobody can answer after ${WAKE_WAIT_MS} ms`, () => {
    const wait = new WakeWait(4);
    wait.add(7, 0);
    wait.poll(WAKE_WAIT_MS, () => false);
    expect(wait.size).toBe(1);
    wait.poll(WAKE_WAIT_MS + 1, () => false);
    expect(wait.size).toBe(0);
  });

  it('asks about a body once however often it is added, and drops the oldest when full', () => {
    const wait = new WakeWait(2);
    wait.add(1, 0);
    wait.add(1, 100);
    expect(wait.size).toBe(1);
    // Asking again extends the wait from the later hit.
    wait.poll(WAKE_WAIT_MS + 50, () => false);
    expect(wait.size).toBe(1);
    wait.add(2, 200);
    wait.add(3, 200);
    const asked: number[] = [];
    wait.poll(210, (id) => {
      asked.push(id);
      return false;
    });
    expect(asked.sort()).toEqual([2, 3]);
  });
});
