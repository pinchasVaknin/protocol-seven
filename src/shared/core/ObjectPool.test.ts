import { beforeEach, describe, expect, it } from 'vitest';
import { installLogSink, type LogLevel } from './Log';
import { ObjectPool } from './ObjectPool';

/**
 * Characterization of the free-list pool, including the part that only shows up under load:
 * the pool grows past its initial size rather than failing, and warns **once** so the size
 * gets tuned instead of the warning being tuned out.
 *
 * The warning is captured through an installed `LogSink` rather than the console, which is
 * both what the server does at boot and the only handle a `shared/` test has on it.
 */

interface Item {
  n: number;
}

const lines: Array<{ level: LogLevel; tag: string; message: string }> = [];

let made = 0;

function newItem(): Item {
  made++;
  return { n: made };
}

function resetItem(item: Item): void {
  item.n = 0;
}

beforeEach(() => {
  lines.length = 0;
  made = 0;
  installLogSink({ log: (level, tag, message) => lines.push({ level, tag, message }) });
});

describe('construction', () => {
  it('pre-creates initialSize items and counts them as the high-water mark', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 4, 'tracers');

    expect(pool.size).toBe(4);
    expect(pool.live).toBe(0);
    expect(pool.peak).toBe(4);
    expect(made).toBe(4);
  });

  it('an empty pool constructs without creating anything', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 0, 'empty');

    expect(pool.size).toBe(0);
    expect(pool.peak).toBe(0);
    expect(made).toBe(0);
  });
});

describe('acquire and release', () => {
  it('hands out a pre-made item without constructing a new one', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 2, 'decals');

    const item = pool.acquire();

    expect(item.n).toBe(2);
    expect(pool.live).toBe(1);
    expect(pool.size).toBe(2);
    expect(made).toBe(2);
  });

  it('release resets the item and puts it back for the next acquire', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 1, 'decals');

    const first = pool.acquire();
    first.n = 99;
    pool.release(first);

    expect(first.n).toBe(0);
    expect(pool.live).toBe(0);

    const second = pool.acquire();
    expect(second).toBe(first);
    expect(pool.size).toBe(1);
  });

  it('live counts what is checked out right now', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 3, 'decals');

    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.live).toBe(2);

    pool.release(a);
    expect(pool.live).toBe(1);

    pool.release(b);
    expect(pool.live).toBe(0);
  });

  it('peak keeps the largest simultaneous checkout, not the latest', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 1, 'decals');

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(pool.peak).toBe(3);

    pool.release(a);
    pool.release(b);
    pool.release(c);
    expect(pool.live).toBe(0);
    expect(pool.peak).toBe(3);
  });
});

describe('exhaustion', () => {
  it('grows rather than failing, and the new item comes from the factory', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 1, 'particles');

    pool.acquire();
    const grown = pool.acquire();

    expect(grown.n).toBe(2);
    expect(pool.size).toBe(2);
    expect(pool.live).toBe(2);
  });

  it('warns exactly once, tagged with the pool label, and names the size to raise', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 2, 'particles');

    pool.acquire();
    pool.acquire();
    expect(lines).toEqual([]);

    pool.acquire();

    expect(lines).toEqual([
      {
        level: 'warn',
        tag: 'ObjectPool:particles',
        message: 'exhausted at 2 items and grew. Raise its initial size to avoid mid-frame allocation.',
      },
    ]);
  });

  it('stays quiet on every later exhaustion', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 1, 'particles');

    pool.acquire();
    pool.acquire();
    pool.acquire();
    pool.acquire();

    expect(lines).toHaveLength(1);
    expect(pool.size).toBe(4);
  });

  it('the label defaults to "pool"', () => {
    const pool = new ObjectPool<Item>(newItem, resetItem, 0);

    pool.acquire();

    expect(lines[0]?.tag).toBe('ObjectPool:pool');
  });
});
