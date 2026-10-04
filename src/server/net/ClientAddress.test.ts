import { describe, expect, it } from 'vitest';
import { addressKey, isInternalAddress, normaliseIp, originAllowed, resolveClientIp } from './ClientAddress';

/**
 * Who a connection is, and whether its page may open one (security audit 2026-10-04, S2/S7).
 *
 * The Render case is the request as Render delivers it: the peer is Render's proxy in the
 * container, `X-Forwarded-For` is `visitor, cloudflare-edge, render-hop`, and the visitor is in
 * `CF-Connecting-IP`.
 */

const RENDER_HEADERS = {
  'x-forwarded-for': '81.97.145.24, 172.71.195.123, 10.226.90.65',
  'cf-connecting-ip': '81.97.145.24',
};

describe('resolveClientIp', () => {
  it('counts the visitor, not the proxy, on Render', () => {
    expect(resolveClientIp('127.0.0.1', RENDER_HEADERS, 'cf-connecting-ip')).toBe('81.97.145.24');
    expect(resolveClientIp('::ffff:10.226.90.65', RENDER_HEADERS, 'cf-connecting-ip')).toBe('81.97.145.24');
  });

  it('counts the peer when no header is configured — which on Render is the proxy, the bug', () => {
    expect(resolveClientIp('::ffff:10.226.90.65', RENDER_HEADERS, '')).toBe('10.226.90.65');
  });

  it('never believes the header from a peer on the internet', () => {
    // A process exposed directly, with the variable set by mistake: the header is the client's.
    expect(resolveClientIp('198.51.100.4', { 'cf-connecting-ip': '1.2.3.4' }, 'cf-connecting-ip')).toBe('198.51.100.4');
  });

  it('falls back to the peer when the header is missing, a list, or not an address', () => {
    expect(resolveClientIp('127.0.0.1', {}, 'x-real-ip')).toBe('127.0.0.1');
    expect(resolveClientIp('127.0.0.1', { 'x-real-ip': '1.2.3.4, 5.6.7.8' }, 'x-real-ip')).toBe('127.0.0.1');
    expect(resolveClientIp('127.0.0.1', { 'x-real-ip': 'not-an-ip' }, 'x-real-ip')).toBe('127.0.0.1');
    expect(resolveClientIp('127.0.0.1', { 'x-real-ip': ['9.9.9.9', '8.8.8.8'] }, 'x-real-ip')).toBe('9.9.9.9');
  });

  it('reads the header name case-insensitively and accepts an IPv6 visitor', () => {
    expect(resolveClientIp('10.0.0.5', { 'cf-connecting-ip': '2001:DB8::1' }, 'CF-Connecting-IP')).toBe('2001:db8::1');
  });
});

describe('addressKey', () => {
  it('is the address itself for IPv4', () => {
    expect(addressKey('81.97.145.24')).toBe('81.97.145.24');
  });

  it('is the /64 for IPv6, so one household cannot rotate through its own block', () => {
    const a = addressKey('2001:db8:85a3:12::1');
    expect(a).toBe('2001:db8:85a3:12::/64');
    expect(addressKey('2001:0db8:85a3:0012:ffff:ffff:ffff:ffff')).toBe(a);
    expect(addressKey('2001:db8:85a3:13::1')).not.toBe(a);
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
  });
});

describe('the address helpers', () => {
  it('collapses an IPv4-mapped address and drops a zone', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('knows a private or loopback peer from a public one', () => {
    for (const ip of ['127.0.0.1', '10.226.90.65', '172.16.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1']) {
      expect(isInternalAddress(ip)).toBe(true);
    }
    for (const ip of ['81.97.145.24', '172.71.195.123', '2001:db8::1', 'nonsense']) {
      expect(isInternalAddress(ip)).toBe(false);
    }
  });
});

describe('originAllowed', () => {
  const HOST = 'protocol-seven.onrender.com';

  it('lets in the page this server served, and a tool that sends no Origin', () => {
    expect(originAllowed('https://protocol-seven.onrender.com', HOST, [])).toBe(true);
    expect(originAllowed(undefined, HOST, [])).toBe(true);
  });

  it('lets in a page on the player\'s own machine — the Vite dev server on 5173', () => {
    expect(originAllowed('http://127.0.0.1:5173', '127.0.0.1:8080', [])).toBe(true);
    expect(originAllowed('http://localhost:5173', HOST, [])).toBe(true);
    expect(originAllowed('http://[::1]:5173', HOST, [])).toBe(true);
  });

  it('refuses another site, a lookalike, and the opaque null origin', () => {
    expect(originAllowed('https://evil.example', HOST, [])).toBe(false);
    expect(originAllowed('https://protocol-seven.onrender.com.evil.example', HOST, [])).toBe(false);
    expect(originAllowed('null', HOST, [])).toBe(false);
    expect(originAllowed('file:///C:/game/index.html', HOST, [])).toBe(false);
  });

  it('lets in an origin the operator listed, exactly', () => {
    const allowed = ['https://play.example.com'];
    expect(originAllowed('https://play.example.com', HOST, allowed)).toBe(true);
    expect(originAllowed('http://play.example.com', HOST, allowed)).toBe(false);
  });
});
