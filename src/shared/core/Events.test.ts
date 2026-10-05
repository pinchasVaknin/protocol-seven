import { describe, expect, it } from 'vitest';
import { createGameBus, EV } from './Events';

/**
 * The event vocabulary, pinned string by string.
 *
 * These are not internal names. The headless harnesses subscribe by them, the killfeed and the
 * announcer are driven by them, and `EV` is how every call site spells one — so a renamed value
 * silently stops a subscriber from ever being called, with nothing to fail. Pinning the whole
 * map here means a rename has to be deliberate.
 *
 * The map is also asserted to be injective: two keys mapping to one string would make two
 * different events dispatch to each other's listeners.
 */

const EXPECTED: Readonly<Record<string, string>> = {
  PlayerSpawned: 'player.spawned',
  PlayerStanceChanged: 'player.stanceChanged',
  PlayerJumped: 'player.jumped',
  PlayerLanded: 'player.landed',
  PlayerFootstep: 'player.footstep',
  PlayerSlideStarted: 'player.slideStarted',
  PlayerSlideEnded: 'player.slideEnded',
  PlayerMantleStarted: 'player.mantleStarted',
  PlayerMantleEnded: 'player.mantleEnded',
  PlayerHealthChanged: 'player.healthChanged',
  WeaponFired: 'weapon.fired',
  WeaponDryFired: 'weapon.dryFired',
  WeaponReloadStarted: 'weapon.reloadStarted',
  WeaponReloadStep: 'weapon.reloadStep',
  WeaponReloadFinished: 'weapon.reloadFinished',
  WeaponAdsChanged: 'weapon.adsChanged',
  WeaponAmmoChanged: 'weapon.ammoChanged',
  WeaponSwapped: 'weapon.swapped',
  MeleeSwing: 'weapon.meleeSwing',
  EquipmentThrown: 'equipment.thrown',
  EquipmentBounced: 'equipment.bounced',
  EquipmentArmed: 'equipment.armed',
  EquipmentExploded: 'equipment.exploded',
  EquipmentFlashed: 'equipment.flashed',
  SmokeSpawned: 'equipment.smokeSpawned',
  BulletImpact: 'bullet.impact',
  DamageDealt: 'damage.dealt',
  EntityKilled: 'entity.killed',
  BotSpawned: 'bot.spawned',
  BotStateChanged: 'bot.stateChanged',
  MatchStarted: 'match.started',
  MatchEnded: 'match.ended',
  RoundStarted: 'round.started',
  RoundEnded: 'round.ended',
  SidesSwapped: 'match.sidesSwapped',
  ScoreChanged: 'score.changed',
  KillfeedEntry: 'killfeed.entry',
  AnnouncerCue: 'announcer.cue',
  MetaXpAwarded: 'meta.xpAwarded',
  MetaLevelUp: 'meta.levelUp',
  MetaChallengeCompleted: 'meta.challengeCompleted',
  MetaCamoUnlocked: 'meta.camoUnlocked',
  MetaLoadoutChanged: 'meta.loadoutChanged',
  PerkScavenged: 'perk.scavenged',
  FieldUpgradeReady: 'fieldUpgrade.ready',
  FieldUpgradeUsed: 'fieldUpgrade.used',
  ObjectiveCaptured: 'objective.captured',
  ObjectiveProgress: 'objective.progress',
  ObjectiveNeutralised: 'objective.neutralised',
  BombPlanted: 'objective.bombPlanted',
  BombDefused: 'objective.bombDefused',
  BombExploded: 'objective.bombExploded',
  TagDropped: 'objective.tagDropped',
  TagCollected: 'objective.tagCollected',
  StreakProgress: 'streak.progress',
  StreakEarned: 'streak.earned',
  StreakActivated: 'streak.activated',
  StreakExpired: 'streak.expired',
  StreakDestroyed: 'streak.destroyed',
  CarePackageDropped: 'streak.carePackageDropped',
  CarePackageClaimed: 'streak.carePackageClaimed',
  GameStateChanged: 'game.stateChanged',
  SettingsChanged: 'settings.changed',
};

describe('EV', () => {
  it('maps every name to the exact string the harnesses subscribe by', () => {
    expect(EV).toEqual(EXPECTED);
  });

  it('declares sixty-three events and no more', () => {
    expect(Object.keys(EV)).toHaveLength(63);
  });

  it('is injective: no two events share a string', () => {
    const values = Object.values(EV);

    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps the insertion order, which is the order the milestones added them', () => {
    expect(Object.keys(EV)).toEqual(Object.keys(EXPECTED));
  });
});

describe('createGameBus', () => {
  it('returns a bus that dispatches a typed payload to its subscriber', () => {
    const bus = createGameBus();
    const seen: Array<{ from: string; to: string }> = [];

    bus.on(EV.GameStateChanged, (p) => seen.push({ from: p.from, to: p.to }));
    bus.emit(EV.GameStateChanged, { from: 'MENU', to: 'MATCH' });

    expect(seen).toEqual([{ from: 'MENU', to: 'MATCH' }]);
  });

  it('returns a fresh bus each time, with no shared subscriptions', () => {
    const a = createGameBus();
    const b = createGameBus();

    a.on(EV.SettingsChanged, () => undefined);

    expect(a.subscriptionCount).toBe(1);
    expect(b.subscriptionCount).toBe(0);
  });

  it('hands back an unsubscriber that empties the bus again', () => {
    const bus = createGameBus();

    const off = bus.on(EV.AnnouncerCue, () => undefined);
    expect(bus.subscriptionCount).toBe(1);

    off();
    expect(bus.subscriptionCount).toBe(0);
  });
});
