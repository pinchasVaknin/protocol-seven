import { beforeEach, describe, expect, it } from 'vitest';
import { SaveStore } from './SaveStore';

/**
 * A map standing in for `localStorage`, which is the whole of this file's environment. The
 * interesting behaviour is what it does with what it finds there: junk, an older version, a
 * version from the future, and nothing at all.
 */

interface Shape {
  version: number;
  a: number;
  b: string;
}

const KEY = 'savestore-test';
const VERSION = 3;

let backing: Map<string, string>;
let failWrites = false;

function installStorage(): void {
  backing = new Map();
  const storage = {
    getItem: (key: string): string | null => backing.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      if (failWrites) throw new Error('quota');
      backing.set(key, value);
    },
    removeItem: (key: string): void => {
      backing.delete(key);
    },
    clear: (): void => backing.clear(),
    key: (index: number): string | null => [...backing.keys()][index] ?? null,
    get length(): number {
      return backing.size;
    },
  };
  // `probeStorage` reads `window.localStorage` and `scheduleFlush` uses `window.setTimeout`,
  // so the stub has to be a window rather than a bare global.
  (globalThis as Record<string, unknown>)['window'] = {
    localStorage: storage,
    setTimeout: (fn: () => void): number => {
      scheduled.push(fn);
      return scheduled.length;
    },
    clearTimeout: (): undefined => undefined,
  };
  (globalThis as Record<string, unknown>)['localStorage'] = storage;
}

/** Flushes the store deferred with `window.setTimeout`, so a test can run them on purpose. */
const scheduled: Array<() => void> = [];

const migrations: Array<{ raw: unknown; from: number }> = [];

function store(): SaveStore<Shape> {
  return new SaveStore<Shape>(KEY, VERSION, { version: VERSION, a: 1, b: 'default' }, (raw, from) => {
    migrations.push({ raw, from });
    const source = raw as Partial<Shape> | null;
    return { version: VERSION, a: (typeof source?.a === 'number' ? source.a : 0) + 100, b: `from-${String(from)}` };
  });
}

beforeEach(() => {
  installStorage();
  failWrites = false;
  migrations.length = 0;
  scheduled.length = 0;
});

describe('a store with nothing behind it', () => {
  it('starts from the defaults', () => {
    expect(store().value).toEqual({ version: VERSION, a: 1, b: 'default' });
  });

  it('runs no migration', () => {
    store();
    expect(migrations).toEqual([]);
  });

  it('writes nothing until it is asked to', () => {
    store();
    expect(backing.has(KEY)).toBe(false);
  });
});

describe('patch and flush', () => {
  it('merges the change into the value', () => {
    const s = store();
    s.patch({ a: 7 });
    expect(s.value).toEqual({ version: VERSION, a: 7, b: 'default' });
  });

  it('puts it in storage once flushed, and reads back the same', () => {
    const s = store();
    s.patch({ a: 7 });
    s.flush();
    expect(JSON.parse(s.readRaw() ?? 'null')).toEqual({ version: VERSION, a: 7, b: 'default' });
    expect(store().value).toEqual({ version: VERSION, a: 7, b: 'default' });
  });

  it('keeps the fields it was not given', () => {
    const s = store();
    s.patch({ a: 2 });
    s.patch({ b: 'changed' });
    expect(s.value).toEqual({ version: VERSION, a: 2, b: 'changed' });
  });
});

describe('replace and reset', () => {
  it('replaces the whole value', () => {
    const s = store();
    s.replace({ version: VERSION, a: 42, b: 'replaced' });
    expect(s.value).toEqual({ version: VERSION, a: 42, b: 'replaced' });
  });

  it('resets back to the defaults', () => {
    const s = store();
    s.patch({ a: 9 });
    s.flush();
    s.reset();
    expect(s.value).toEqual({ version: VERSION, a: 1, b: 'default' });
  });
});

describe('what it does with what it finds', () => {
  it('migrates an older version, and says which one it came from', () => {
    backing.set(KEY, JSON.stringify({ version: 1, a: 5, b: 'old' }));
    const s = store();
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.from).toBe(1);
    expect(s.value).toEqual({ version: VERSION, a: 105, b: 'from-1' });
  });

  it('does not migrate a save already at this version', () => {
    backing.set(KEY, JSON.stringify({ version: VERSION, a: 5, b: 'current' }));
    const s = store();
    expect(migrations).toEqual([]);
    expect(s.value.a).toBe(5);
  });

  it('unions a same-version save with the defaults at the top level', () => {
    backing.set(KEY, JSON.stringify({ version: VERSION, a: 5 }));
    expect(store().value).toEqual({ version: VERSION, a: 5, b: 'default' });
  });

  it('falls back to the defaults for text that is not JSON', () => {
    backing.set(KEY, 'not json at all');
    expect(store().value).toEqual({ version: VERSION, a: 1, b: 'default' });
  });

  it('falls back to the defaults for JSON that parses to null', () => {
    backing.set(KEY, 'null');
    expect(store().value).toEqual({ version: VERSION, a: 1, b: 'default' });
  });

  it('falls back to the defaults for JSON that is not an object', () => {
    for (const scalar of ['42', '"a string"', 'true']) {
      migrations.length = 0;
      backing.set(KEY, scalar);
      expect(store().value).toEqual({ version: VERSION, a: 1, b: 'default' });
      expect(migrations).toEqual([]);
    }
  });

  it('hands an array to the migrator, because an array is an object', () => {
    // Pins the edge: the guard is `typeof parsed !== 'object'`, which an array passes, so it
    // reaches the migrator with a version of 0 rather than falling back.
    backing.set(KEY, '[]');
    const value = store().value;
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.from).toBe(0);
    expect(value).toEqual({ version: VERSION, a: 100, b: 'from-0' });
  });

  it('migrates a version from the future rather than trusting it', () => {
    backing.set(KEY, JSON.stringify({ version: 99, a: 5, b: 'future' }));
    const s = store();
    expect(migrations[0]?.from).toBe(99);
    expect(s.value.version).toBe(VERSION);
  });

  it('falls back to the defaults when the migrator gives up', () => {
    backing.set(KEY, JSON.stringify({ version: 1, a: 5 }));
    const giving = new SaveStore<Shape>(KEY, VERSION, { version: VERSION, a: 1, b: 'default' }, () => null);
    expect(giving.value).toEqual({ version: VERSION, a: 1, b: 'default' });
  });
});

describe('storage that will not take a write', () => {
  it('still reports a value, and says it is not persistent', () => {
    failWrites = true;
    const s = store();
    s.patch({ a: 3 });
    expect(() => s.flush()).not.toThrow();
    expect(s.value.a).toBe(3);
    expect(s.isPersistent).toBe(false);
  });

  it('is persistent when a write goes through', () => {
    const s = store();
    s.patch({ a: 3 });
    s.flush();
    expect(s.isPersistent).toBe(true);
  });
});

describe('readRaw', () => {
  it('is null before anything was written', () => {
    expect(store().readRaw()).toBeNull();
  });

  it('is the exact text in storage', () => {
    backing.set(KEY, '{"version":3,"a":5,"b":"x"}');
    expect(store().readRaw()).toBe('{"version":3,"a":5,"b":"x"}');
  });
});

describe('touch', () => {
  it('marks the store dirty so the next flush writes', () => {
    const s = store();
    s.touch();
    s.flush();
    expect(backing.has(KEY)).toBe(true);
  });

  it('coalesces a burst of touches into one deferred flush', () => {
    const s = store();
    s.touch();
    s.touch();
    s.touch();
    expect(scheduled).toHaveLength(1);
    const before = s.writes;
    scheduled[0]?.();
    expect(s.writes).toBe(before + 1);
  });
});
