import { describe, expect, it } from 'vitest';
import { loadConfig, productionHazards } from './Config';

/**
 * The settings a production server says out loud at boot (security audit 2026-10-04, S13).
 */
describe('productionHazards', () => {
  it('is empty for the shipped defaults and for the Render blueprint', () => {
    expect(productionHazards(loadConfig({}), {})).toEqual([]);
    const render = { RENDER: 'true', CLIENT_IP_HEADER: 'cf-connecting-ip', VITE_SERVER_URL: '1', WARMUP_BOTS: '3' };
    expect(productionHazards(loadConfig(render), render)).toEqual([]);
  });

  it('names every diagnostic left on, one sentence each', () => {
    const env = {
      CHEATS_ENABLED: '1',
      FAULT_INJECTION: '1',
      REWIND_DISABLED: '1',
      NET_SIM: 'bad',
      IDLE_KICK_SECONDS: '0',
    };
    const hazards = productionHazards(loadConfig(env), env);
    expect(hazards).toHaveLength(5);
    for (const name of ['CHEATS_ENABLED', 'FAULT_INJECTION', 'REWIND_DISABLED', 'NET_SIM', 'IDLE_KICK_SECONDS']) {
      expect(hazards.some((h) => h.startsWith(name))).toBe(true);
    }
  });

  it('catches a Render service made by hand, which never read render.yaml\'s CLIENT_IP_HEADER', () => {
    const env = { RENDER: 'true' };
    const hazards = productionHazards(loadConfig(env), env);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toContain('CLIENT_IP_HEADER=cf-connecting-ip');
  });

  it('does not ask for the header off Render, where the peer may be the player', () => {
    expect(productionHazards(loadConfig({}), { RENDER: '' })).toEqual([]);
  });
});
