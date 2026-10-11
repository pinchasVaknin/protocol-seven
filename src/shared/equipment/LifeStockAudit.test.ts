import { describe, expect, it } from 'vitest';
import { LifeStockAudit } from './LifeStockAudit';

/**
 * What every life started holding, pinned.
 *
 * The probe exists because a count of throws and a count of refills both measure the thing that
 * was *called* rather than the thing the player woke up with. So the two properties worth
 * holding still are the denominator — `lifeStarts`, without which zero partial stocks is what a
 * probe that never fired looks like — and that one short life counts once however many slots
 * were short.
 */

describe('an audit nothing has been noted into', () => {
  it('reports zeroes, which is what a probe that never fired looks like', () => {
    expect(new LifeStockAudit().report()).toEqual({
      lifeStarts: 0,
      humanLifeStarts: 0,
      botLifeStarts: 0,
      partialStock: 0,
      partialLethal: 0,
      partialTactical: 0,
      emptyStock: 0,
      observedStock: 0,
      expectedStock: 0,
    });
  });

  it('hands out a copy, so a reader cannot write the totals back', () => {
    const audit = new LifeStockAudit();
    const first = audit.report();
    first.lifeStarts = 99;
    expect(audit.report().lifeStarts).toBe(0);
  });
});

describe('a life that began with a full stock', () => {
  it('counts toward the denominator and nothing else', () => {
    const audit = new LifeStockAudit();
    audit.note('human', 1, 1, 1, 1);
    audit.note('bot', 2, 2, 1, 1);
    expect(audit.report()).toEqual({
      lifeStarts: 2,
      humanLifeStarts: 1,
      botLifeStarts: 1,
      partialStock: 0,
      partialLethal: 0,
      partialTactical: 0,
      emptyStock: 0,
      observedStock: 5,
      expectedStock: 5,
    });
  });

  it('is not partial when it began with more than a full slot', () => {
    const audit = new LifeStockAudit();
    audit.note('human', 3, 1, 3, 1);
    const r = audit.report();
    expect(r.partialStock).toBe(0);
    expect(r.observedStock).toBe(6);
    expect(r.expectedStock).toBe(2);
  });
});

describe('a life that began short', () => {
  it('is counted once however many slots were short', () => {
    const audit = new LifeStockAudit();
    audit.note('human', 0, 1, 0, 1);
    const r = audit.report();
    expect(r.partialStock).toBe(1);
    expect(r.partialLethal).toBe(1);
    expect(r.partialTactical).toBe(1);
    expect(r.emptyStock).toBe(1);
  });

  it('says which half was short', () => {
    const audit = new LifeStockAudit();
    audit.note('bot', 0, 1, 1, 1);
    audit.note('bot', 1, 1, 0, 1);
    const r = audit.report();
    expect(r.partialStock).toBe(2);
    expect(r.partialLethal).toBe(1);
    expect(r.partialTactical).toBe(1);
    // Neither life was empty: each still held the other slot.
    expect(r.emptyStock).toBe(0);
  });

  it('is empty only when both slots were, which is a subset of partial', () => {
    const audit = new LifeStockAudit();
    audit.note('human', 0, 2, 0, 2);
    const r = audit.report();
    expect(r.emptyStock).toBe(1);
    expect(r.partialStock).toBe(1);
    expect(r.observedStock).toBe(0);
    expect(r.expectedStock).toBe(4);
  });

  it('counts a life that holds nothing and is owed nothing as whole', () => {
    // A loadout with no equipment at all: 0 of 0 is not a let-down.
    const audit = new LifeStockAudit();
    audit.note('bot', 0, 0, 0, 0);
    const r = audit.report();
    expect(r.partialStock).toBe(0);
    expect(r.emptyStock).toBe(1);
  });
});
