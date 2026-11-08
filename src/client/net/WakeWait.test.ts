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

/** The rest of the ring, pinned before C13 moved a line. */
describe('WakeWait: the rest of it', () => {
  it('starts empty and clears to empty', () => {
    const wait = new WakeWait(4);
    expect(wait.size).toBe(0);
    wait.add(1, 0);
    wait.add(2, 0);
    expect(wait.size).toBe(2);
    wait.clear();
    expect(wait.size).toBe(0);
    let asked = 0;
    wait.poll(0, () => {
      asked++;
      return true;
    });
    expect(asked).toBe(0);
  });

  it('keeps a question alive at exactly its deadline, and drops it one ms later', () => {
    const wait = new WakeWait(4);
    wait.add(7, 100);
    wait.poll(100 + WAKE_WAIT_MS, () => false);
    expect(wait.size).toBe(1);
    wait.poll(100 + WAKE_WAIT_MS + 1, () => false);
    expect(wait.size).toBe(0);
  });

  it('answers a question on the frame it expires, rather than dropping it unasked', () => {
    const wait = new WakeWait(4);
    wait.add(7, 0);
    const asked: number[] = [];
    wait.poll(WAKE_WAIT_MS + 1000, (id) => {
      asked.push(id);
      return true;
    });
    // The answer is tried first; the deadline only decides what happens when it says no.
    expect(asked).toEqual([7]);
    expect(wait.size).toBe(0);
  });

  it('drops the oldest for the newest once it is full, keeping the rest', () => {
    const wait = new WakeWait(3);
    wait.add(1, 0);
    wait.add(2, 0);
    wait.add(3, 0);
    wait.add(4, 0);
    expect(wait.size).toBe(3);
    const asked: number[] = [];
    wait.poll(1, (id) => {
      asked.push(id);
      return false;
    });
    expect(asked.sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('removes only the questions that were answered, in one pass', () => {
    const wait = new WakeWait(8);
    for (const id of [1, 2, 3, 4]) wait.add(id, 0);
    const asked: number[] = [];
    wait.poll(1, (id) => {
      asked.push(id);
      return id % 2 === 0;
    });
    expect(asked.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(wait.size).toBe(2);

    const left: number[] = [];
    wait.poll(2, (id) => {
      left.push(id);
      return false;
    });
    expect(left.sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('extends an existing question rather than queueing it twice', () => {
    const wait = new WakeWait(4);
    wait.add(7, 0);
    wait.add(7, 1000);
    expect(wait.size).toBe(1);
    wait.poll(1000 + WAKE_WAIT_MS, () => false);
    expect(wait.size).toBe(1);
    wait.poll(1000 + WAKE_WAIT_MS + 1, () => false);
    expect(wait.size).toBe(0);
  });
});
