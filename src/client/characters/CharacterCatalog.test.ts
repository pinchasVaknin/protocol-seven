import { describe, expect, it } from 'vitest';
import {
  BOT_CHARACTER_IDS,
  CHARACTER_DEFINITIONS,
  DEFAULT_CHARACTER_ID,
  characterDefinition,
  type CharacterAnimationId,
  type CharacterDefinition,
} from './CharacterCatalog';

/**
 * The character table, pinned before unit C5's refactor.
 *
 * This file is the unit's one real evaluation-order risk. Its constants are built by calling
 * functions declared below them — `MIXAMO_V1_RIG` calls `shoulderPads`, `ECHO_RIG` calls
 * `withShoulderPads` *and reads* `MIXAMO_V1_RIG`, `MIXAMO_ANIMATIONS` calls `slot`, and
 * `CHARACTER_DEFINITIONS` calls `character`, which reads both the rigs and the animation table.
 * The skeleton moves every one of those functions to the bottom of the file, which is safe only
 * because they are hoisted `function` declarations.
 *
 * So the first test here is the one that matters: **the module builds at all**, with every
 * definition fully populated. A broken load order gives an `undefined` rig or a thrown
 * initialiser, and either one fails before any assertion about a URL ever runs.
 */

const ALL: CharacterDefinition[] = BOT_CHARACTER_IDS.map(characterDefinition);

describe('CharacterCatalog: the module loads in the right order', () => {
  it('builds every definition completely', () => {
    expect(BOT_CHARACTER_IDS.length).toBe(7);
    for (const definition of ALL) {
      expect(definition, definition?.id).toBeDefined();
      expect(typeof definition.id, definition.id).toBe('string');
      expect(typeof definition.name, definition.id).toBe('string');
      expect(typeof definition.skinUrl, definition.id).toBe('string');
      expect(typeof definition.thumbUrl, definition.id).toBe('string');
      expect(definition.rig, definition.id).toBeDefined();
      expect(definition.animations, definition.id).toBeDefined();
    }
  });

  it('builds every rig completely, including the two that are derived from another', () => {
    // ECHO_RIG and RHINO_RIG are `withShoulderPads(MIXAMO_V1_RIG, ...)`: if MIXAMO_V1_RIG were
    // read before it was initialised, these two would be the ones to break.
    for (const definition of ALL) {
      const rig = definition.rig;
      expect(typeof rig.id, definition.id).toBe('string');
      expect(rig.requiredBones.length, definition.id).toBeGreaterThan(0);
      expect(typeof rig.motionBone, definition.id).toBe('string');
      expect(rig.supportHand.palmOffset.length, definition.id).toBe(3);
      expect(rig.indicators.leftShoulder.offset.length, definition.id).toBe(3);
      expect(rig.indicators.rightShoulder.offset.length, definition.id).toBe(3);
      expect(typeof rig.indicators.headBone, definition.id).toBe('string');
    }
  });

  it('gives Echo and Rhino their own shoulder-pad rigs off the shared one', () => {
    const shared = characterDefinition('hazard').rig;
    const echo = characterDefinition('echo').rig;
    const rhino = characterDefinition('rhino').rig;
    expect(echo.id).not.toBe(shared.id);
    expect(rhino.id).not.toBe(shared.id);
    expect(echo.id).not.toBe(rhino.id);
    // Everything except the pads is the shared rig's.
    expect(echo.motionBone).toBe(shared.motionBone);
    expect(echo.requiredBones).toEqual(shared.requiredBones);
    expect(echo.indicators.leftShoulder.offset).not.toEqual(shared.indicators.leftShoulder.offset);
  });

  it('gives Apex its own rig, because its skeleton is a different scale', () => {
    const apex = characterDefinition('apex').rig;
    const shared = characterDefinition('hazard').rig;
    expect(apex.id).not.toBe(shared.id);
    expect(apex.animationTranslationScale).toBeDefined();
  });
});

describe('CharacterCatalog: the table', () => {
  it('has a definition for every eligible skin and nothing else', () => {
    expect([...BOT_CHARACTER_IDS].sort()).toEqual(Object.keys(CHARACTER_DEFINITIONS).sort());
  });

  it('answers for its default', () => {
    expect(BOT_CHARACTER_IDS).toContain(DEFAULT_CHARACTER_ID);
    expect(characterDefinition(DEFAULT_CHARACTER_ID).id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('returns the same object the table holds', () => {
    for (const id of BOT_CHARACTER_IDS) {
      expect(characterDefinition(id)).toBe(CHARACTER_DEFINITIONS[id]);
      expect(characterDefinition(id).id).toBe(id);
    }
  });

  it('names each skin after its file, in capitals', () => {
    expect(characterDefinition('echo').name).toBe('ECHO');
    expect(characterDefinition('apex').name).toBe('APEX');
  });

  it('carries the catalog version in every URL, so a re-encode is not served from cache', () => {
    const version = ALL[0]?.version as string;
    expect(version.length).toBeGreaterThan(0);
    for (const definition of ALL) {
      expect(definition.version, definition.id).toBe(version);
      expect(definition.skinUrl, definition.id).toContain(version);
      expect(definition.thumbUrl, definition.id).toContain(version);
      for (const clip of Object.values(definition.animations).flat()) {
        expect(clip.url, `${definition.id}/${clip.id}`).toContain(version);
      }
    }
  });

  it('points every skin at its own glb and its own thumbnail', () => {
    for (const definition of ALL) {
      expect(definition.skinUrl, definition.id).toMatch(/\/models\/bots\/skins\/.+\.glb/);
      expect(definition.thumbUrl, definition.id).toMatch(/\/models\/bots\/skins\/thumbs\/.+\.png/);
    }
    expect(new Set(ALL.map((d) => d.skinUrl)).size).toBe(ALL.length);
  });
});

describe('CharacterCatalog: the animation slots', () => {
  const animations = CHARACTER_DEFINITIONS.echo.animations;
  const slots = Object.keys(animations) as CharacterAnimationId[];

  it('shares one animation set across every skin', () => {
    // The repository caches animation files per URL for exactly this reason: keying them on the
    // skin would fetch and parse the same files seven times.
    for (const definition of ALL) expect(definition.animations, definition.id).toBe(animations);
  });

  it('has 28 slots behind 33 clips', () => {
    expect(slots.length).toBe(28);
    expect(Object.values(animations).flat().length).toBe(33);
  });

  it('never leaves a slot empty, which is what lets the selector’s answer be used directly', () => {
    for (const slot of slots) expect(animations[slot].length, slot).toBeGreaterThan(0);
  });

  it('names every clip after its own file, which is the export contract', () => {
    for (const clip of Object.values(animations).flat()) {
      expect(clip.url, clip.id).toContain(clip.clipName);
      expect(clip.url, clip.id).toMatch(/\.glb/);
    }
  });

  it('gives every variant of a slot the same loop and weapon-ready flags', () => {
    for (const slot of slots) {
      const variants = animations[slot];
      for (const variant of variants) {
        expect(variant.id, slot).toBe(slot);
        expect(variant.loop, `${slot} loop`).toBe(variants[0].loop);
        expect(variant.weaponReady, `${slot} weaponReady`).toBe(variants[0].weaponReady);
      }
    }
  });

  it('loops the locomotion and plays the rest once', () => {
    expect(animations.idleRelaxed[0].loop).toBe(true);
    expect(animations.walkRelaxed[0].loop).toBe(true);
    expect(animations.runRelaxed[0].loop).toBe(true);
    expect(animations.jumpLaunch[0].loop).toBe(false);
    expect(animations.jumpLand[0].loop).toBe(false);
    expect(animations.deathStand[0].loop).toBe(false);
    expect(animations.standToCrouch[0].loop).toBe(false);
    expect(animations.slide[0].loop).toBe(false);
  });

  it('marks as weapon-ready only the clips that hold a firearm in both hands', () => {
    // The support-hand constraint reads this; forcing a second hand onto a rifle in a relaxed
    // loop, a reload or a death bends the arm into a pose the source never authored.
    expect(animations.idleWeaponReady[0].weaponReady).toBe(true);
    expect(animations.walkWeaponReady[0].weaponReady).toBe(true);
    expect(animations.idleRelaxed[0].weaponReady).toBe(false);
    expect(animations.reloadStand[0].weaponReady).toBe(false);
    expect(animations.deathStand[0].weaponReady).toBe(false);
    expect(animations.standToCrouch[0].weaponReady).toBe(false);
  });

  it('spreads the five extra clips over four slots, each variant its own file', () => {
    const multi = slots.filter((slot) => animations[slot].length > 1);
    expect(multi.length).toBe(4);
    // Four slots carrying five extra clips means one of them has three variants.
    const extra = multi.reduce((sum, slot) => sum + animations[slot].length - 1, 0);
    expect(extra).toBe(33 - 28);
    for (const slot of multi) {
      const urls = animations[slot].map((v) => v.url);
      expect(new Set(urls).size, slot).toBe(urls.length);
    }
  });
});
