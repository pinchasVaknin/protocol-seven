import { describe, expect, it } from 'vitest';
import { PODIUM_SIZE, podiumOf, podiumSlots, type LineupRow } from './Lineup';

function row(entityId: number, team: 'A' | 'B', score: number, kills = 0): LineupRow {
  return { entityId, displayName: `P${entityId}`, team, isLocal: entityId === 1, score, kills, deaths: 0 };
}

const board: LineupRow[] = [
  row(1, 'A', 900, 9),
  row(2, 'A', 1500, 12),
  row(3, 'A', 300, 3),
  row(4, 'A', 1200, 10),
  row(5, 'A', 700, 7),
  row(6, 'A', 100, 1),
  row(7, 'B', 2000, 20),
  row(8, 'B', 50, 0),
];

describe('podiumOf', () => {
  it('takes the three best of the whole match in ladder order, whichever side won', () => {
    // A won; the ladder's best is on B, and stands on the podium regardless (M18, Q1).
    const podium = podiumOf({ winner: 'A' }, board);
    expect(podium.map((r) => r.entityId)).toEqual([7, 2, 4]);
    expect(podium).toHaveLength(PODIUM_SIZE);
  });

  it('pins the crowned winner to first where the mode crowned one', () => {
    // The mode decided on kills: entity 4 with fewer points than 7 and 2 is still the winner.
    expect(podiumOf({ winner: 'A', winnerEntityId: 4 }, board).map((r) => r.entityId)).toEqual([4, 7, 2]);
  });

  it('gives a draw the same three', () => {
    expect(podiumOf({ winner: 'DRAW' }, board).map((r) => r.entityId)).toEqual([7, 2, 4]);
  });

  it('stands fewer when the board has fewer, and nobody for an empty board', () => {
    expect(podiumOf({ winner: 'B' }, board.slice(6)).map((r) => r.entityId)).toEqual([7, 8]);
    expect(podiumOf({ winner: 'A' }, [])).toEqual([]);
  });
});

describe('podiumSlots', () => {
  it('puts gold on the centre block, silver on the viewer’s left and bronze on the right', () => {
    const slots = podiumSlots(3);
    expect(slots[0]?.x).toBeCloseTo(0);
    expect(slots[1]!.x).toBeLessThan(0);
    expect(slots[2]!.x).toBeGreaterThan(0);
    expect(slots[2]!.x).toBeCloseTo(-slots[1]!.x);
  });

  it('stands each on a block of its own height, gold the tallest', () => {
    const slots = podiumSlots(3);
    expect(slots[0]!.y).toBeGreaterThan(slots[1]!.y);
    expect(slots[1]!.y).toBeGreaterThan(slots[2]!.y);
    expect(slots[2]!.y).toBeGreaterThan(0);
  });

  it('turns the flanks toward the centre', () => {
    const slots = podiumSlots(3);
    // Yaw π + δ faces +X, so a body on −X turns toward +X with a yaw above π, and vice versa.
    expect(slots[1]!.yaw).toBeGreaterThan(Math.PI);
    expect(slots[2]!.yaw).toBeLessThan(Math.PI);
    expect(slots[0]!.yaw).toBeCloseTo(Math.PI);
  });

  it('never exceeds the podium', () => {
    expect(podiumSlots(9)).toHaveLength(PODIUM_SIZE);
    expect(podiumSlots(0)).toEqual([]);
  });
});
