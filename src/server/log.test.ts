import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../shared/core/Log';
import { installServerLogging, metric } from './log';

/**
 * The only visibility this process has (B8).
 *
 * The brief's reasoning is the design constraint: *"the server has no debug overlay; logs are
 * the only visibility you will have into it for the rest of the project. Build them properly
 * now."* Everything downstream — netcode, lag compensation, a twelve-hour soak — gets diagnosed
 * from these lines and nothing else, so the shapes are a contract rather than a convenience:
 *
 *  - **field order** in the JSON shapes, because a soak run is read with `grep | jq` and a field
 *    that moves position breaks that;
 *  - **which stream** each level goes to, because `npm run server > run.log` has to keep the run
 *    and still show the failures, and a CI job that captures only stderr has to capture the
 *    thing that went wrong.
 *
 * Both writes are intercepted rather than mocked away, so what is asserted is the text that
 * would have reached the terminal.
 */

const out: string[] = [];
const err: string[] = [];

const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  out.length = 0;
  err.length = 0;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
});

describe('installServerLogging', () => {
  describe('text, for a human watching a terminal', () => {
    it('writes level, elapsed seconds, tag and message in aligned columns', () => {
      installServerLogging('text', 'debug');
      logger('server').info('listening on 0.0.0.0:8080');

      expect(out).toHaveLength(1);
      const line = out[0] ?? '';
      expect(line).toMatch(/^INF\s+\d+\.\d{3}s server\s+listening on 0\.0\.0\.0:8080\n$/);
    });

    it('pads the tag so a scan down the left edge lines up', () => {
      installServerLogging('text', 'debug');
      logger('a').info('x');
      logger('instance').info('y');

      const columnOf = (line: string): number => line.indexOf('x') + line.indexOf('y') + 1;
      expect(columnOf(out[0] ?? '')).toBe(columnOf(out[1] ?? ''));
    });

    it('labels every level in three letters', () => {
      installServerLogging('text', 'debug');
      const log = logger('t');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');

      expect((out[0] ?? '').startsWith('DBG ')).toBe(true);
      expect((out[1] ?? '').startsWith('INF ')).toBe(true);
      expect((err[0] ?? '').startsWith('WRN ')).toBe(true);
      expect((err[1] ?? '').startsWith('ERR ')).toBe(true);
    });
  });

  describe('json, for a machine', () => {
    it('writes one object per line with its fields always in the same order', () => {
      // So `sort`, `uniq` and a diff all behave.
      installServerLogging('json', 'debug');
      logger('vote').warn('the ballot closed early');

      expect(err).toHaveLength(1);
      const parsed = JSON.parse(err[0] ?? '{}') as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['t', 'level', 'tag', 'msg']);
      expect(parsed['level']).toBe('warn');
      expect(parsed['tag']).toBe('vote');
      expect(parsed['msg']).toBe('the ballot closed early');
      expect(typeof parsed['t']).toBe('number');
    });
  });

  describe('which stream', () => {
    it('sends warnings and errors to stderr and everything else to stdout', () => {
      installServerLogging('text', 'debug');
      const log = logger('t');
      log.info('kept');
      log.error('shown');

      expect(out.join('')).toContain('kept');
      expect(out.join('')).not.toContain('shown');
      expect(err.join('')).toContain('shown');
    });
  });

  describe('the level', () => {
    it('drops anything below the installed level', () => {
      installServerLogging('text', 'warn');
      const log = logger('t');
      log.debug('no');
      log.info('no');
      log.warn('yes');

      expect(out).toHaveLength(0);
      expect(err.join('')).toContain('yes');
    });
  });
});

describe('metric', () => {
  it('writes one flat object with t, tag and event first', () => {
    // S7 wants frame time, tick jitter, AI cost and heap logged as JSON at every match
    // boundary. A soak run is read with `grep event=... | jq`, and a field that moves position
    // breaks that.
    installServerLogging('text', 'debug');
    metric('allocator', 'allocated', { matchId: 3, mapId: 'mp_dunes', ms: 1.25 });

    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['t', 'tag', 'event', 'matchId', 'mapId', 'ms']);
    expect(parsed['tag']).toBe('allocator');
    expect(parsed['event']).toBe('allocated');
    expect(parsed['matchId']).toBe(3);
  });

  it('goes to stdout whatever the sink is, because it is not prose', () => {
    installServerLogging('json', 'error');
    metric('server', 'boot', { pid: 1 });

    // The level gate is for sentences; a metric bypasses the message formatting entirely.
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(0);
  });

  it('always carries a monotonic elapsed stamp', () => {
    installServerLogging('json', 'debug');
    metric('t', 'one', {});
    metric('t', 'two', {});

    const first = JSON.parse(out[0] ?? '{}') as { t: number };
    const second = JSON.parse(out[1] ?? '{}') as { t: number };
    expect(second.t).toBeGreaterThanOrEqual(first.t);
  });
});
