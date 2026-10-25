import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID } from '../shared/combat/DamageSystem';
import { DEFAULT_HEALTH_CONFIG } from '../shared/player/Health';
import { Spectator } from './Spectator';

/**
 * The seat where a local player would sit, permanently empty (B8).
 *
 * M9, S4.9: *"It does not render, does not play, and has no local player."* `BotDirector` still
 * wants a `player` in its roster, because perception, spawn scoring and the aim model are
 * written against `Combatant` and have no business knowing which entries are human — so rather
 * than change that seam, this fills it with a combatant that is never `participating`.
 *
 * That one answer is the whole class, and it is what makes the headless harness work unchanged:
 * no bot looks for this entity, no spawn is scored against it, and perception skips it.
 */

describe('Spectator', () => {
  it('never participates, which is the whole class', () => {
    const spectator = new Spectator('A', DEFAULT_HEALTH_CONFIG);
    expect(spectator.participating).toBe(false);
  });

  it('holds the local-player entity id, so nothing else can claim it', () => {
    expect(new Spectator('A', DEFAULT_HEALTH_CONFIG).entityId).toBe(PLAYER_ENTITY_ID);
  });

  it('takes the side it is given, because the roster and the flow both want one', () => {
    // It has no gameplay consequence — the spectator never participates — but `MatchFlow` wants
    // a local team and the roster wants a team.
    expect(new Spectator('A', DEFAULT_HEALTH_CONFIG).team).toBe('A');
    expect(new Spectator('B', DEFAULT_HEALTH_CONFIG).team).toBe('B');
  });

  it('is a complete combatant: a rig, health, and a pose at the origin', () => {
    // The pose is required by the interface and never moves, which is harmless precisely
    // because `participating` is false — nothing ever reads these.
    const spectator = new Spectator('A', DEFAULT_HEALTH_CONFIG);
    expect(spectator.rig).toBeDefined();
    expect(spectator.health.alive).toBe(true);
    expect([spectator.px, spectator.py, spectator.pz]).toEqual([0, 0, 0]);
    expect([spectator.vx, spectator.vz, spectator.yaw]).toEqual([0, 0, 0]);
    expect(spectator.quiet).toBe(true);
    expect(spectator.glinting).toBe(false);
    expect(spectator.displayName).toBe('SPECTATOR');
  });
});
