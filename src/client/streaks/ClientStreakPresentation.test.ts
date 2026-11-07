import { beforeEach, describe, expect, it } from 'vitest';
import type { CameraRig } from '../engine/CameraRig';
import type { Fx } from '../engine/Fx';
import type { StreakAudio } from './StreakAudio';
import { ClientStreakPresentation } from './ClientStreakPresentation';

/**
 * Every method here is one line, and the whole value of the class is *which* line. So the test
 * is a routing table: each call must land on exactly one collaborator, with its arguments
 * passed straight through.
 */

let routed: string[];

function presentation(): ClientStreakPresentation {
  routed = [];
  const audio = new Proxy(
    {},
    {
      get: (_target, key) => (...args: unknown[]): undefined => {
        routed.push(`audio.${String(key)}(${args.join(',')})`);
        return undefined;
      },
    },
  ) as unknown as StreakAudio;
  const fx = {
    spawnTracer: (...args: unknown[]): undefined => {
      routed.push(`fx.spawnTracer(${args.join(',')})`);
      return undefined;
    },
  } as unknown as Fx;
  const rig = {
    shake: {
      add: (amount: number): undefined => {
        routed.push(`rig.shake.add(${String(amount)})`);
        return undefined;
      },
    },
  } as unknown as CameraRig;
  const blastFn = (...args: unknown[]): undefined => {
    routed.push(`blast(${args.join(',')})`);
    return undefined;
  };
  return new ClientStreakPresentation(audio, fx, rig, blastFn);
}

let port: ClientStreakPresentation;

beforeEach(() => {
  port = presentation();
});

describe('the cues that are only a sound', () => {
  const positional: Array<[keyof ClientStreakPresentation, string]> = [
    ['sentryDeploy', 'audio.sentryDeploy(1,2,3)'],
    ['sentryShot', 'audio.sentryShot(1,2,3)'],
    ['sentryDestroyed', 'audio.sentryDestroyed(1,2,3)'],
    ['packageDrop', 'audio.packageDrop(1,2,3)'],
    ['packageLand', 'audio.packageLand(1,2,3)'],
    ['packageClaimed', 'audio.packageClaimed(1,2,3)'],
    ['mortarInbound', 'audio.mortarInbound(1,2,3)'],
    ['mortarImpact', 'audio.mortarImpact(1,2,3)'],
  ];

  for (const [method, expected] of positional) {
    it(`routes ${String(method)} to the audio, with its position`, () => {
      (port[method] as (x: number, y: number, z: number) => void)(1, 2, 3);
      expect(routed).toEqual([expected]);
    });
  }

  it('routes the chopper and UAV cues with their one argument', () => {
    port.chopperSpin(0.5);
    port.uavSweep(1.5);
    expect(routed).toEqual(['audio.chopperSpin(0.5)', 'audio.uavSweep(1.5)']);
  });

  it('routes the cues that carry nothing', () => {
    port.chopperShot();
    port.counterUav();
    expect(routed).toEqual(['audio.chopperShot()', 'audio.counterUav()']);
  });
});

describe('the cues that are not a sound', () => {
  it('sends a tracer to the effects layer, not the audio', () => {
    port.tracer(0, 1, 2, 3, 4, 5);
    expect(routed).toEqual(['fx.spawnTracer(0,1,2,3,4,5)']);
  });

  it('sends a blast to the supplied function, because the pool is the equipment’s', () => {
    port.blast(1, 2, 3, 4, true);
    expect(routed).toEqual(['blast(1,2,3,4,true)']);
  });

  it('adds shake to the camera rig', () => {
    port.shake(0.3);
    expect(routed).toEqual(['rig.shake.add(0.3)']);
  });
});

describe('the port as a whole', () => {
  it('routes every cue exactly once, and never to two places', () => {
    port.sentryDeploy(1, 2, 3);
    port.sentryShot(1, 2, 3);
    port.sentryDestroyed(1, 2, 3);
    port.packageDrop(1, 2, 3);
    port.packageLand(1, 2, 3);
    port.packageClaimed(1, 2, 3);
    port.chopperSpin(0.5);
    port.chopperShot();
    port.uavSweep(1);
    port.counterUav();
    port.mortarInbound(1, 2, 3);
    port.mortarImpact(1, 2, 3);
    port.tracer(0, 0, 0, 1, 1, 1);
    port.blast(0, 0, 0, 1, false);
    port.shake(0.1);
    expect(routed).toHaveLength(15);
    expect(routed.filter((r) => r.startsWith('audio.'))).toHaveLength(12);
    expect(routed.filter((r) => r.startsWith('fx.'))).toHaveLength(1);
    expect(routed.filter((r) => r.startsWith('blast('))).toHaveLength(1);
    expect(routed.filter((r) => r.startsWith('rig.'))).toHaveLength(1);
  });
});
