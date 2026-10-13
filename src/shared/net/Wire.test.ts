import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter } from './Wire';

/**
 * Characterisation of the byte codec: every primitive round-trips through a writer and a
 * reader, the signed writers clamp rather than wrap, and neither side throws past the end —
 * the writer overflows silently and the reader overruns to zero, which is S4.16's promise.
 */

function readerOver(write: (w: ByteWriter) => void, capacity?: number): ByteReader {
  const w = new ByteWriter(capacity);
  write(w);
  expect(w.overflowed).toBe(false);
  return new ByteReader(w.bytes());
}

describe('ByteWriter -> ByteReader', () => {
  it('round-trips every primitive in order', () => {
    const r = readerOver((w) => {
      w.u8v(200);
      w.i8(-100);
      w.u16(60_000);
      w.i16(-30_000);
      w.u32(0xdeadbeef);
      w.i32(-123_456_789);
      w.f32(1.5);
      w.f64(Math.PI);
      w.str('Operator');
      w.raw(new Uint8Array([1, 2, 3]));
    });
    expect(r.u8v()).toBe(200);
    expect(r.i8()).toBe(-100);
    expect(r.u16()).toBe(60_000);
    expect(r.i16()).toBe(-30_000);
    expect(r.u32()).toBe(0xdeadbeef);
    expect(r.i32()).toBe(-123_456_789);
    expect(r.f32()).toBe(1.5);
    expect(r.f64()).toBe(Math.PI);
    expect(r.str()).toBe('Operator');
    expect(Array.from(r.raw(3))).toEqual([1, 2, 3]);
    expect(r.remaining).toBe(0);
    expect(r.overran).toBe(false);
  });

  it('writes little-endian', () => {
    const w = new ByteWriter();
    w.u16(0x1234);
    w.u32(0x11223344);
    expect(Array.from(w.bytes())).toEqual([0x34, 0x12, 0x44, 0x33, 0x22, 0x11]);
  });

  it('the signed writers clamp instead of wrapping, and treat NaN as zero', () => {
    const r = readerOver((w) => {
      w.i8(1000);
      w.i8(-1000);
      w.i16(100_000);
      w.i16(-100_000);
      w.i8(NaN);
      w.i8(2.5);
    });
    expect(r.i8()).toBe(127);
    expect(r.i8()).toBe(-128);
    expect(r.i16()).toBe(32767);
    expect(r.i16()).toBe(-32768);
    expect(r.i8()).toBe(0);
    expect(r.i8()).toBe(3);
  });

  it('the unsigned writers mask to their width', () => {
    const r = readerOver((w) => {
      w.u8v(0x1ff);
      w.u16(0x1ffff);
      w.u32(-1);
    });
    expect(r.u8v()).toBe(0xff);
    expect(r.u16()).toBe(0xffff);
    expect(r.u32()).toBe(0xffffffff);
  });

  it('round-trips a name outside ASCII, including an astral character', () => {
    const name = 'Zoë — 名前 🎯';
    const r = readerOver((w) => w.str(name));
    expect(r.str()).toBe(name);
  });

  it('truncates a string to 255 bytes and still frames it', () => {
    const long = 'x'.repeat(300);
    const r = readerOver((w) => {
      w.str(long);
      w.u8v(7);
    });
    expect(r.str()).toBe('x'.repeat(255));
    expect(r.u8v()).toBe(7);
  });

  it('reset() reuses the buffer from the start', () => {
    const w = new ByteWriter();
    w.u32(1);
    w.reset();
    w.u8v(9);
    expect(w.length).toBe(1);
    expect(Array.from(w.bytes())).toEqual([9]);
  });
});

describe('ByteWriter overflow', () => {
  it('sets overflowed and drops the write rather than throwing', () => {
    const w = new ByteWriter(4);
    w.u32(1);
    expect(w.overflowed).toBe(false);
    w.u8v(2);
    expect(w.overflowed).toBe(true);
    expect(w.length).toBe(4);
  });
});

describe('ByteReader overrun', () => {
  it('reads zero past the end and sets overran', () => {
    const r = new ByteReader(new Uint8Array([1]));
    expect(r.u8v()).toBe(1);
    expect(r.overran).toBe(false);
    expect(r.u16()).toBe(0);
    expect(r.overran).toBe(true);
    expect(r.f64()).toBe(0);
    expect(r.str()).toBe('');
    expect(r.raw(4).length).toBe(0);
  });

  it('peekU8 does not consume', () => {
    const r = new ByteReader(new Uint8Array([5, 6]));
    expect(r.peekU8()).toBe(5);
    expect(r.offset).toBe(0);
    expect(r.u8v()).toBe(5);
    expect(r.offset).toBe(1);
  });

  it('raw() copies, so a reused reader cannot alias a later frame', () => {
    const first = new Uint8Array([1, 2, 3]);
    const r = new ByteReader(first);
    const out = r.raw(3);
    r.reuse(new Uint8Array([9, 9, 9]));
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(r.offset).toBe(0);
    expect(r.overran).toBe(false);
  });
});

/**
 * The UTF-8 decoder on its own, pinned before A20 split it by sequence length.
 *
 * Every case here is bytes an untrusted client could send in a `Hello`, so the contract is
 * "a mangled name, never a thrown error" — a malformed sequence becomes U+FFFD and decoding
 * carries on with the next byte.
 */
function nameOf(...bytes: number[]): string {
  const frame = new Uint8Array(bytes.length + 1);
  frame[0] = bytes.length;
  frame.set(bytes, 1);
  return new ByteReader(frame).str();
}

describe('decoding a name', () => {
  it('reads one, two, three and four byte sequences', () => {
    expect(nameOf(0x41)).toBe('A');
    expect(nameOf(0xc3, 0xa9)).toBe('é');
    expect(nameOf(0xd7, 0x90)).toBe('א');
    expect(nameOf(0xe2, 0x82, 0xac)).toBe('€');
    expect(nameOf(0xf0, 0x9f, 0x98, 0x80)).toBe('😀');
  });

  it('decodes a mixed run in order', () => {
    expect(nameOf(0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0x42)).toBe('Aé€B');
  });

  it('turns a lead byte that leads nothing into one replacement character', () => {
    expect(nameOf(0x80)).toBe('�');
    expect(nameOf(0xf8)).toBe('�');
    expect(nameOf(0xff, 0x41)).toBe('�A');
  });

  it('treats a truncated sequence as zero continuation bytes rather than overrunning', () => {
    // The missing bytes read as 0, which is what keeps a cut frame from throwing: the
    // sequence decodes to whatever those zeroes make of it and the loop ends.
    expect(nameOf(0xc3)).toBe('À');
    expect(nameOf(0xe2, 0x82)).toBe('₀');
    // A cut astral sequence decodes as if the missing byte were a zero continuation, which is
    // the same code point as the complete 0xf0 0x9f 0x98 0x80.
    expect(nameOf(0xf0, 0x9f, 0x98)).toBe('😀');
  });

  it('replaces a code point above the Unicode range', () => {
    // 0xf7 0xbf 0xbf 0xbf is U+1FFFFF, past U+10FFFF.
    expect(nameOf(0xf7, 0xbf, 0xbf, 0xbf)).toBe('�');
  });

  it('is empty for an empty string field', () => {
    expect(nameOf()).toBe('');
  });

  it('round-trips what the encoder produced, at every sequence length', () => {
    for (const name of ['OPERATOR', 'é', 'א', '€', '😀', 'Aé€😀Z']) {
      const w = new ByteWriter(64);
      w.str(name);
      expect(new ByteReader(w.bytes()).str()).toBe(name);
    }
  });

  it('encodes an unpaired surrogate without consuming the next character', () => {
    const w = new ByteWriter(64);
    w.str('\ud83dZ');
    const out = new ByteReader(w.bytes()).str();
    expect(out.length).toBe(2);
    expect(out[1]).toBe('Z');
  });
});
