import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
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
  it('carries the security headers, exactly — the document, a script, a miss and the health check', async () => {
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
