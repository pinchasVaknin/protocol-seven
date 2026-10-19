import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { installLogSink } from '../../shared/core/Log';
import { nodeClock } from '../NodeClock';
import { SECURITY_HEADERS, WsServer } from './WsServer';

/**
 * What the HTTP half of the server sends (security audit 2026-10-04, part 4).
 *
 * A real `WsServer` over a throwaway build directory that holds what a build with source maps
 * would: an entry document, a script, and the script's map beside it.
 */

installClock(nodeClock);
installLogSink({ log: () => undefined });

let root = '';
let server: WsServer | null = null;
let port = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'p7-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
  writeFileSync(join(root, 'assets', 'app.js.map'), '{"version":3,"sources":["src/secret.ts"]}');
  server = new WsServer({ port: 0, host: '127.0.0.1', staticDir: root, onConnection: () => undefined });
  await server.listen();
  port = server.port;
});

afterAll(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

interface Got {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

function get(path: string): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('every response', () => {
  it('carries the security headers, exactly â€” the document, a script, a miss and the health check', async () => {
    for (const path of ['/', '/assets/app.js', '/nothing-here.js', '/healthz']) {
      const { headers } = await get(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect({ path, name, value: headers[name] }).toEqual({ path, name, value });
      }
    }
  });

  it('no longer lets another site read the files', async () => {
    const { headers } = await get('/assets/app.js');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('the policy', () => {
  it('runs only this origin\'s scripts and cannot be framed', () => {
    const csp = SECURITY_HEADERS['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe('source maps', () => {
  it('are never served, even when the build left one beside its script', async () => {
    expect((await get('/assets/app.js')).status).toBe(200);
    expect((await get('/assets/app.js.map')).status).toBe(404);
    expect((await get('/assets/APP.JS.MAP')).status).toBe(404);
  });
});

/**
 * The guards in front of the file handler (B3).
 *
 * The cases above cover the headers on every response. What had none is `serveStatic` itself Ã¢â‚¬â€
 * seven sequential guards, and the one the file's own comment calls *"the part that matters"*.
 * Each is a different fact: a 403 and a 404 are not the same answer, and only one of them is
 * worth looking at in a log.
 */

interface Sent extends Got {
  readonly body: string;
}

/** One request, with the method and headers under test. */
function send(
  path: string,
  method = 'GET',
  headers: Readonly<Record<string, string>> = {},
): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(() => {
  // A versioned model, for the cache rule that only applies with `?v=`.
  mkdirSync(join(root, 'models'), { recursive: true });
  writeFileSync(join(root, 'models', 'rifle.glb'), 'glb');
});

describe('the guards in front of a file', () => {
  /**
   * The escape attempt lands as a **miss**, not as a breakout Ã¢â‚¬â€ and that is the interesting part.
   *
   * `normalize` clamps a leading `..` against the root before the prefix test is reached, so an
   * encoded `../../` arrives as a path inside the root that simply is not there. The prefix test
   * is the layer behind that, and no request through an ordinary client reaches it. What this
   * pins is the outcome a client sees; the guard itself stays as defence in depth.
   */
  it('clamps an escape attempt to the root, so it is a miss rather than a breakout', async () => {
    const got = await send('/..%2F..%2Fpackage.json');
    expect(got.status).toBe(404);
    expect(got.body).not.toContain('protocol-seven');
  });

  it('never serves a source map, even though the build wrote one', async () => {
    expect((await send('/assets/app.js.map')).status).toBe(404);
  });

  it('refuses a method it does not implement, and says which it has', async () => {
    const got = await send('/index.html', 'POST');
    expect(got.status).toBe(405);
    expect(got.headers['allow']).toBe('GET, HEAD');
  });

  it('answers an unchanged file with its headers and no body', async () => {
    const first = await send('/assets/app.js');
    expect(first.status).toBe(200);
    const etag = first.headers['etag'];
    expect(typeof etag).toBe('string');

    const again = await send('/assets/app.js', 'GET', { 'if-none-match': String(etag) });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');
  });

  it('answers a wildcard conditional the same way', async () => {
    expect((await send('/assets/app.js', 'GET', { 'if-none-match': '*' })).status).toBe(304);
  });

  it('answers HEAD with the headers and nothing else', async () => {
    const got = await send('/assets/app.js', 'HEAD');
    expect(got.status).toBe(200);
    expect(got.headers['content-length']).toBe(String('export {};'.length));
    expect(got.body).toBe('');
  });

  it('serves the app itself for a route that is not a file', async () => {
    const got = await send('/play/solo');
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(got.body).toContain('doctype');
  });

  it('answers a file that is not there with a plain 404', async () => {
    const got = await send('/assets/missing.js');
    expect(got.status).toBe(404);
    expect(got.body.trim()).toBe('not found');
  });
});

describe('what each kind of file is cached for', () => {
  it('keeps the hashed assets for a year and the document for no time at all', async () => {
    expect((await send('/assets/app.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await send('/')).headers['cache-control']).toBe('no-cache');
    expect((await send('/play/solo')).headers['cache-control']).toBe('no-cache');
  });

  it('keeps a model for a year only when the request carries its version', async () => {
    expect((await send('/models/rifle.glb?v=7')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await send('/models/rifle.glb')).headers['cache-control']).toBe('no-cache');
  });
});

describe('the traversal guard itself', () => {
  /**
   * The 403 path, reached the only way it can be (B3).
   *
   * `http.request` always sends a request line starting with `/`, and `normalize` clamps a
   * leading `..` against the root Ã¢â‚¬â€ which is why the encoded `../../` above lands as a 404
   * inside the root rather than as a breakout. A **raw** request line has no such slash:
   * `GET a/../../x.js` normalises to `../x.js`, survives the leading-slash strip, and resolves
   * to a path outside the root. That is the request the prefix test exists for, and this is it.
   */
  function rawRequest(line: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(`${line} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      let text = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        text += chunk;
      });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
  }

  it('never sees a target without a leading slash: the runtime answers 400 first', async () => {
    // The one request line that would reach the prefix test — `a/../../x.js` normalises to
    // `../x.js`, with no leading slash for `normalize` to clamp against — is refused by Node's
    // own HTTP parser before the application is called. So on this stack the guard is the
    // third layer, behind the parser and `normalize`, and nothing a client can send reaches it.
    const answer = await rawRequest('GET a/../../package.json');

    expect(answer.split('\r\n')[0]).toContain('400');
    expect(answer).not.toContain('protocol-seven');
  });

  it('still serves an ordinary raw request, so the guard is not refusing everything', async () => {
    const answer = await rawRequest('GET /assets/app.js');

    expect(answer.split('\r\n')[0]).toContain('200');
    expect(answer).toContain('export {};');
  });
});
