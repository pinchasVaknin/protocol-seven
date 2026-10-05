import { beforeEach, describe, expect, it } from 'vitest';
import { installLogSink, type LogLevel, type LogSink, logger, setLogLevel } from './Log';

/**
 * Characterization of the log seam (M9, S3 and S6.4): the tag is bound once, the level gate is
 * applied per call, and the sink is replaceable.
 *
 * `sink` and `minLevel` are module state with no uninstall — the two runtimes each install once
 * at boot and never go back — so the order here matters. The default-sink block runs **first**,
 * while `sink` is still `consoleSink` and `minLevel` is still `'debug'`; everything after it
 * installs a capturing sink. Vitest gives this file its own module registry, so it starts from
 * the module's own defaults however the rest of the suite is ordered.
 */

interface ConsoleLike {
  info?: (message: string) => void;
}

const lines: Array<{ level: LogLevel; tag: string; message: string }> = [];

const capturing: LogSink = {
  log: (level, tag, message) => lines.push({ level, tag, message }),
};

describe('the default console sink', () => {
  it('renders the tag in brackets and routes the level to the matching console method', () => {
    const hostConsole = (globalThis as { console?: ConsoleLike }).console;
    if (hostConsole === undefined) return;

    const original = hostConsole.info;
    const captured: string[] = [];
    hostConsole.info = (message: string) => captured.push(message);
    try {
      logger('Save').info('wrote 3 slots');
    } finally {
      hostConsole.info = original;
    }

    expect(captured).toEqual(['[Save] wrote 3 slots']);
  });
});

describe('logger', () => {
  beforeEach(() => {
    lines.length = 0;
    setLogLevel('debug');
    installLogSink(capturing);
  });

  it('binds the tag once and carries it on every level', () => {
    const log = logger('BotDirector');

    log.debug('one');
    log.info('two');
    log.warn('three');
    log.error('four');

    expect(lines).toEqual([
      { level: 'debug', tag: 'BotDirector', message: 'one' },
      { level: 'info', tag: 'BotDirector', message: 'two' },
      { level: 'warn', tag: 'BotDirector', message: 'three' },
      { level: 'error', tag: 'BotDirector', message: 'four' },
    ]);
  });

  it('two loggers keep their own tags', () => {
    logger('Save').info('a');
    logger('Wire').info('b');

    expect(lines.map((l) => l.tag)).toEqual(['Save', 'Wire']);
  });

  it('passes the message through untouched, brackets and all', () => {
    logger('Save').warn('[already bracketed] 50%');

    expect(lines[0]?.message).toBe('[already bracketed] 50%');
  });
});

describe('setLogLevel', () => {
  beforeEach(() => {
    lines.length = 0;
    setLogLevel('debug');
    installLogSink(capturing);
  });

  it('at debug, everything passes', () => {
    const log = logger('Soak');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('at info, debug is dropped', () => {
    setLogLevel('info');
    const log = logger('Soak');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
  });

  it('at warn, a ten-minute soak keeps only warnings and errors', () => {
    setLogLevel('warn');
    const log = logger('Soak');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('at error, only errors survive', () => {
    setLogLevel('error');
    const log = logger('Soak');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines.map((l) => l.level)).toEqual(['error']);
  });

  it('applies to a logger created before the level changed', () => {
    const log = logger('Soak');
    setLogLevel('error');
    log.info('dropped');
    log.error('kept');

    expect(lines.map((l) => l.message)).toEqual(['kept']);
  });
});

describe('installLogSink', () => {
  beforeEach(() => {
    lines.length = 0;
    setLogLevel('debug');
    installLogSink(capturing);
  });

  it('replaces the sink for loggers that already exist', () => {
    const log = logger('Save');
    log.info('to the first sink');

    const second: Array<string> = [];
    installLogSink({ log: (_level, _tag, message) => second.push(message) });
    log.info('to the second sink');

    expect(lines.map((l) => l.message)).toEqual(['to the first sink']);
    expect(second).toEqual(['to the second sink']);
  });
});
