import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groupNodes, WeaponAssetService } from './WeaponAssetService';
import { WEAPON_SOCKET_NODES } from './WeaponAssetCatalog';

/**
 * The application-lifetime owner of the parsed weapon files, driven by a loader under test
 * control.
 *
 * Nothing in this class draws: it fetches, holds a file to a contract, reads a handful of
 * positions off it and remembers the answer. All of that is reachable from node — the one thing
 * that is not is the fetch itself, so the real `GLTFLoader` is replaced on the instance and the
 * files are built here out of `THREE.Object3D`s with the names the contract asks for.
 *
 * What the tests are mostly about is *timing*, because that is what the class exists for: one
 * request per file however many callers ask, a synchronous read for the callers that cannot
 * await, a failure evicted so a retry can try again, and a half-arrived state — the rifle
 * without the suppressor that might go on it — that `template` refuses to show anybody.
 */

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

function node(name: string, x = 0, y = 0, z = 0): THREE.Object3D {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(x, y, z);
  return object;
}

/** A node that owns GPU resources, so disposal has something to release. */
function meshNode(name: string): THREE.Mesh {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  return mesh;
}

/** A gltf scene: a container with the build's root under it. */
function file(root: THREE.Object3D): { scene: THREE.Object3D } {
  const scene = new THREE.Object3D();
  scene.name = 'Scene';
  scene.add(root);
  return { scene };
}

interface WeaponFileOptions {
  readonly rootName?: string;
  readonly withoutGroup?: string;
  readonly withoutSocket?: string;
}

function weaponFile(weaponId: string, options: WeaponFileOptions = {}): { scene: THREE.Object3D } {
  const root = node(options.rootName ?? weaponId);
  for (const group of ['body', 'magazine', 'charge']) {
    if (group !== options.withoutGroup) root.add(meshNode(group));
  }
  let step = 1;
  for (const socket of WEAPON_SOCKET_NODES) {
    if (socket === options.withoutSocket) continue;
    root.add(node(socket, step * 0.01, step * 0.02, step * -0.03));
    step++;
  }
  return file(root);
}

function lodFile(weaponId: string, options: { readonly rootName?: string; readonly withoutSocket?: string } = {}): {
  scene: THREE.Object3D;
} {
  const root = node(options.rootName ?? weaponId);
  root.add(meshNode('body'));
  if (options.withoutSocket !== 'socket_grip') root.add(node('socket_grip', 0.1, -0.2, 0.3));
  if (options.withoutSocket !== 'socket_support') root.add(node('socket_support', -0.4, 0.5, -0.6));
  return file(root);
}

function partFile(partId: string, sockets: readonly string[], options: { readonly rootName?: string; readonly noPart?: boolean } = {}): {
  scene: THREE.Object3D;
} {
  const root = node(options.rootName ?? partId);
  if (options.noPart !== true) root.add(meshNode('part'));
  let step = 1;
  for (const socket of sockets) {
    root.add(node(socket, step * 0.11, step * 0.22, step * 0.33));
    step++;
  }
  return file(root);
}

const HANDS_BONES = ['upperarm_R', 'lowerarm_R', 'hand_R', 'upperarm_L', 'lowerarm_L', 'hand_L'];

function handsFile(options: { readonly without?: readonly string[] } = {}): { scene: THREE.Object3D } {
  const root = node('hands');
  for (const bone of HANDS_BONES) {
    if (options.without?.includes(bone) !== true) root.add(node(bone));
  }
  return file(root);
}

function bodyFile(name: string, extra: readonly string[] = [], options: { readonly noBody?: boolean } = {}): {
  scene: THREE.Object3D;
} {
  const root = node(name);
  if (options.noBody !== true) root.add(meshNode('body'));
  let step = 1;
  for (const socket of extra) {
    root.add(node(socket, step * 0.5, step * 0.25, step * 0.125));
    step++;
  }
  return file(root);
}

/** The four parts of the pack, as the build writes them. */
function packResponses(): Record<string, () => { scene: THREE.Object3D }> {
  return {
    att_optic: () => partFile('att_optic', ['socket_sight']),
    att_suppressor: () => partFile('att_suppressor', ['socket_muzzle']),
    att_grip: () => partFile('att_grip', []),
    att_laser: () => partFile('att_laser', []),
  };
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

interface Deferred {
  readonly promise: Promise<{ scene: THREE.Object3D }>;
  readonly resolve: (value: { scene: THREE.Object3D }) => void;
  readonly reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: (value: { scene: THREE.Object3D }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ scene: THREE.Object3D }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Stands in for `GLTFLoader`, keyed by the asset id the url carries. */
class FakeLoader {
  readonly requests: string[] = [];
  readonly responses = new Map<string, () => { scene: THREE.Object3D }>();
  readonly failures = new Map<string, Error>();
  readonly held = new Map<string, Deferred>();

  loadAsync(url: string): Promise<{ scene: THREE.Object3D }> {
    const id = /\/models\/weapons\/([a-z0-9_]+)(\.lod1)?\.glb/.exec(url)?.[1] ?? url;
    this.requests.push(id);
    const hold = this.held.get(id);
    if (hold !== undefined) return hold.promise;
    const failure = this.failures.get(id);
    if (failure !== undefined) return Promise.reject(failure);
    const response = this.responses.get(id);
    if (response === undefined) return Promise.reject(new Error(`no fake response for "${id}"`));
    return Promise.resolve(response());
  }

  hold(id: string): Deferred {
    const d = deferred();
    this.held.set(id, d);
    return d;
  }

  release(id: string): void {
    this.held.delete(id);
  }

  countOf(id: string): number {
    return this.requests.filter((r) => r === id).length;
  }
}

function serviceWith(responses: Record<string, () => { scene: THREE.Object3D }> = {}): {
  service: WeaponAssetService;
  loader: FakeLoader;
} {
  const service = new WeaponAssetService();
  const loader = new FakeLoader();
  for (const [id, make] of Object.entries({ ...packResponses(), ...responses })) loader.responses.set(id, make);
  (service as unknown as { loader: FakeLoader }).loader = loader;
  return { service, loader };
}

/** What a rejected promise says, or '' when it resolved. */
async function refusal(task: Promise<unknown>): Promise<string> {
  try {
    await task;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const DISPOSED = 'Weapon asset service has been disposed.';

// ---------------------------------------------------------------------------

describe('a weapon template', () => {
  it('is null before anything is asked for, and the caller builds the primitives', () => {
    const { service } = serviceWith();
    expect(service.template('ar_carbine')).toBeNull();
    expect(service.statusFor('ar_carbine')).toBe('idle');
  });

  it('carries the eight sockets, read off the file as positions of their own', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    const template = service.template('ar_carbine');
    expect(template).not.toBeNull();
    expect(template?.weaponId).toBe('ar_carbine');
    expect(template?.scene.name).toBe('ar_carbine');
    expect(Object.keys(template?.sockets ?? {}).sort()).toEqual([...WEAPON_SOCKET_NODES].sort());
    expect(template?.sockets.socket_muzzle.toArray()).toEqual([0.01, 0.02, -0.03]);
    expect(template?.sockets.socket_mag_grip.toArray()).toEqual([0.08, 0.16, -0.24]);
  });

  it('copies the socket positions, so posing the clone cannot move the template', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    const template = service.template('ar_carbine');
    const muzzle = template?.scene.getObjectByName('socket_muzzle');
    expect(muzzle).toBeDefined();
    muzzle?.position.set(9, 9, 9);
    expect(template?.sockets.socket_muzzle.toArray()).toEqual([0.01, 0.02, -0.03]);
  });

  it('is the template itself, shared by every instance built from it', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    expect(service.template('ar_carbine')).toBe(service.template('ar_carbine'));
  });

  it('is null for a weapon that was never asked for, and for one with no file', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    expect(service.template('ar_vulcan')).toBeNull();
    expect(service.template('nothing_like_it')).toBeNull();
  });
});

describe('the pack riding with the first weapon', () => {
  it('is fetched once, with the first weapon, and shared by the rest', async () => {
    const { service, loader } = serviceWith({
      ar_carbine: () => weaponFile('ar_carbine'),
      ar_vulcan: () => weaponFile('ar_vulcan'),
    });
    await service.preload('ar_carbine');
    await service.preload('ar_vulcan');
    expect(loader.countOf('att_optic')).toBe(1);
    expect(loader.countOf('att_suppressor')).toBe(1);
    expect(service.part('att_optic')).not.toBeNull();
    expect(service.part('att_laser')).not.toBeNull();
  });

  it('holds the template back until it is there, so no model is built half-mounted', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    const optic = loader.hold('att_optic');
    const task = service.preload('ar_carbine');
    await Promise.resolve();
    await Promise.resolve();
    // The weapon's own file has arrived; the pack has not.
    expect(service.template('ar_carbine')).toBeNull();
    expect(service.part('att_optic')).toBeNull();

    loader.release('att_optic');
    optic.resolve(partFile('att_optic', ['socket_sight']));
    await task;
    expect(service.template('ar_carbine')).not.toBeNull();
  });

  it('reads the parts own sockets, and leaves the two that have none empty', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    expect(service.part('att_optic')?.sockets.socket_sight?.toArray()).toEqual([0.11, 0.22, 0.33]);
    expect(service.part('att_suppressor')?.sockets.socket_muzzle?.toArray()).toEqual([0.11, 0.22, 0.33]);
    expect(service.part('att_grip')?.sockets).toEqual({});
    expect(service.part('att_laser')?.sockets).toEqual({});
  });

  it('is retried with the next preload after it fails', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    loader.failures.set('att_grip', new Error('network'));
    expect(await refusal(service.preload('ar_carbine'))).toBe('network');
    expect(service.template('ar_carbine')).toBeNull();

    loader.failures.delete('att_grip');
    await service.preload('ar_carbine');
    expect(service.template('ar_carbine')).not.toBeNull();
    // The weapon's own file is not fetched twice; only the missing parts are.
    expect(loader.countOf('ar_carbine')).toBe(1);
  });
});

describe('what the loader refuses, and what it says', () => {
  it('names the root it could not find', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine', { rootName: 'rifle' }) });
    expect(await refusal(service.preload('ar_carbine'))).toBe('Weapon file "ar_carbine" has no root node named "ar_carbine".');
  });

  it('names the group it could not find', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine', { withoutGroup: 'magazine' }) });
    expect(await refusal(service.preload('ar_carbine'))).toBe('Weapon file "ar_carbine" has no "magazine" group.');
  });

  it('names the socket it could not find', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine', { withoutSocket: 'socket_sight' }) });
    expect(await refusal(service.preload('ar_carbine'))).toBe('Weapon file "ar_carbine" has no "socket_sight" socket.');
  });

  it('names an attachment part that is missing its root, its group or its socket', async () => {
    const noRoot = serviceWith({ ar_carbine: () => weaponFile('ar_carbine'), att_grip: () => partFile('att_grip', [], { rootName: 'g' }) });
    expect(await refusal(noRoot.service.preload('ar_carbine'))).toBe('Attachment file "att_grip" has no root node named "att_grip".');

    const noPart = serviceWith({ ar_carbine: () => weaponFile('ar_carbine'), att_laser: () => partFile('att_laser', [], { noPart: true }) });
    expect(await refusal(noPart.service.preload('ar_carbine'))).toBe('Attachment file "att_laser" has no "part" group.');

    const noSocket = serviceWith({ ar_carbine: () => weaponFile('ar_carbine'), att_optic: () => partFile('att_optic', []) });
    expect(await refusal(noSocket.service.preload('ar_carbine'))).toBe('Attachment file "att_optic" has no "socket_sight" socket.');
  });

  it('leaves no template behind after a refusal, and lets the next call try again', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine', { withoutGroup: 'charge' }) });
    await refusal(service.preload('ar_carbine'));
    expect(service.template('ar_carbine')).toBeNull();
    expect(service.statusFor('ar_carbine')).toBe('error');

    loader.responses.set('ar_carbine', () => weaponFile('ar_carbine'));
    await service.preload('ar_carbine');
    expect(service.template('ar_carbine')).not.toBeNull();
    expect(service.statusFor('ar_carbine')).toBe('ready');
    expect(loader.countOf('ar_carbine')).toBe(2);
  });
});

describe('one request however many callers', () => {
  it('hands both callers in one frame the same task', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    const hold = loader.hold('ar_carbine');
    const first = service.preload('ar_carbine');
    const second = service.preload('ar_carbine');
    expect(second).toBe(first);
    expect(loader.countOf('ar_carbine')).toBe(1);

    loader.release('ar_carbine');
    hold.resolve(weaponFile('ar_carbine'));
    await first;
    expect(service.template('ar_carbine')).not.toBeNull();
  });

  it('resolves at once once the file and the pack are both in hand', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    const before = loader.requests.length;
    await service.preload('ar_carbine');
    expect(loader.requests.length).toBe(before);
  });

  it('resolves and fetches nothing for a weapon with no file', async () => {
    const { service, loader } = serviceWith();
    await service.preload('nothing_like_it');
    expect(loader.requests).toEqual([]);
    expect(service.statusFor('nothing_like_it')).toBe('none');
  });

  it('resolves and fetches nothing for the shield, which is not a firearm', async () => {
    const { service, loader } = serviceWith();
    await service.preload('streak_shield');
    expect(loader.requests).toEqual([]);
    expect(service.template('streak_shield')).toBeNull();
  });
});

describe('the status a shop screen waits on', () => {
  it('runs idle, loading, ready', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    const hold = loader.hold('ar_carbine');
    expect(service.statusFor('ar_carbine')).toBe('idle');
    const task = service.preload('ar_carbine');
    expect(service.statusFor('ar_carbine')).toBe('loading');

    loader.release('ar_carbine');
    hold.resolve(weaponFile('ar_carbine'));
    await task;
    expect(service.statusFor('ar_carbine')).toBe('ready');
  });

  it('says none for a weapon the catalogue does not list, before anything is asked', () => {
    const { service } = serviceWith();
    expect(service.statusFor('knife')).toBe('none');
    expect(service.statusFor('nothing_like_it')).toBe('none');
    // The shield is listed, so it is idle rather than none, even though it has no template.
    expect(service.statusFor('streak_shield')).toBe('idle');
  });

  it('says error after a refusal, which is what puts the primitives back', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    loader.failures.set('ar_carbine', new Error('404'));
    await refusal(service.preload('ar_carbine'));
    expect(service.statusFor('ar_carbine')).toBe('error');
  });
});

describe('the bodies lod', () => {
  it('reads the two hand anchors and nothing else', async () => {
    const { service } = serviceWith({ ar_carbine: () => lodFile('ar_carbine') });
    await service.preloadLod('ar_carbine');
    const lod = service.lod('ar_carbine');
    expect(lod?.weaponId).toBe('ar_carbine');
    expect(lod?.scene.name).toBe('ar_carbine');
    expect(lod?.gripAnchor.toArray()).toEqual([0.1, -0.2, 0.3]);
    expect(lod?.supportAnchor.toArray()).toEqual([-0.4, 0.5, -0.6]);
  });

  it('is asked for once however many bodies carry the weapon', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => lodFile('ar_carbine') });
    const hold = loader.hold('ar_carbine');
    const tasks = [service.preloadLod('ar_carbine'), service.preloadLod('ar_carbine'), service.preloadLod('ar_carbine')];
    expect(tasks[1]).toBe(tasks[0]);
    loader.release('ar_carbine');
    hold.resolve(lodFile('ar_carbine'));
    await Promise.all(tasks);
    expect(loader.countOf('ar_carbine')).toBe(1);
    await service.preloadLod('ar_carbine');
    expect(loader.countOf('ar_carbine')).toBe(1);
  });

  it('resolves at once for a weapon with no file, and the bodies keep the primitives', async () => {
    const { service, loader } = serviceWith();
    await service.preloadLod('nothing_like_it');
    expect(loader.requests).toEqual([]);
    expect(service.lod('nothing_like_it')).toBeNull();
  });

  it('refuses a file without a root carrying both hand sockets', async () => {
    const noRoot = serviceWith({ ar_carbine: () => lodFile('ar_carbine', { rootName: 'other' }) });
    expect(await refusal(noRoot.service.preloadLod('ar_carbine'))).toBe('LOD file "ar_carbine" has no root with socket_grip and socket_support.');

    const noSupport = serviceWith({ ar_carbine: () => lodFile('ar_carbine', { withoutSocket: 'socket_support' }) });
    expect(await refusal(noSupport.service.preloadLod('ar_carbine'))).toBe('LOD file "ar_carbine" has no root with socket_grip and socket_support.');
    expect(noSupport.service.lod('ar_carbine')).toBeNull();
  });

  it('is loaded for the shield too, which has a LOD even though it has no template', async () => {
    const { service } = serviceWith({ streak_shield: () => lodFile('streak_shield') });
    await service.preloadLod('streak_shield');
    expect(service.lod('streak_shield')).not.toBeNull();
    expect(service.template('streak_shield')).toBeNull();
  });
});

describe('the knife, the hands and the shield, each with a loader of its own', () => {
  it('takes a knife with a root and a body, and refuses one without', async () => {
    const { service } = serviceWith({ knife: () => bodyFile('knife') });
    await service.preloadKnife();
    expect(service.knife()?.name).toBe('knife');

    const broken = serviceWith({ knife: () => bodyFile('knife', [], { noBody: true }) });
    expect(await refusal(broken.service.preloadKnife())).toBe('Knife file has no root named "knife" with a "body" group.');
    expect(broken.service.knife()).toBeNull();
  });

  it('takes a hands rig only with all six bones, and names the ones it could not find', async () => {
    const { service } = serviceWith({ hands: () => handsFile() });
    await service.preloadHands();
    expect(service.hands()?.name).toBe('hands');

    const short = serviceWith({ hands: () => handsFile({ without: ['hand_L', 'lowerarm_L'] }) });
    expect(await refusal(short.service.preloadHands())).toBe('Hands file has no root named "hands" with the bones lowerarm_L, hand_L.');
    expect(short.service.hands()).toBeNull();
  });

  it('takes a shield with a root and a body, and reads the two hand points if they are there', async () => {
    const { service } = serviceWith({ streak_shield: () => bodyFile('streak_shield', ['socket_grip', 'socket_support']) });
    await service.preloadShield();
    const shield = service.shield();
    expect(shield?.scene.name).toBe('streak_shield');
    expect(shield?.sockets.socket_grip?.toArray()).toEqual([0.5, 0.25, 0.125]);
    expect(shield?.sockets.socket_support?.toArray()).toEqual([1, 0.5, 0.25]);
  });

  it('takes a shield that carries only one hand point, because a missing one is not a crash', async () => {
    const { service } = serviceWith({ streak_shield: () => bodyFile('streak_shield', ['socket_support']) });
    await service.preloadShield();
    expect(service.shield()?.sockets.socket_support).toBeDefined();
    expect(service.shield()?.sockets.socket_grip).toBeUndefined();
  });

  it('refuses a shield with no body, and says so with the file in the message', async () => {
    const { service } = serviceWith({ streak_shield: () => bodyFile('streak_shield', [], { noBody: true }) });
    expect(await refusal(service.preloadShield())).toBe('Shield file has no root named "streak_shield" with a "body" group.');
  });

  it('asks for each of the three once, and resolves at once afterwards', async () => {
    const { service, loader } = serviceWith({ knife: () => bodyFile('knife'), hands: () => handsFile() });
    await Promise.all([service.preloadKnife(), service.preloadKnife(), service.preloadHands()]);
    await service.preloadKnife();
    await service.preloadHands();
    expect(loader.countOf('knife')).toBe(1);
    expect(loader.countOf('hands')).toBe(1);
  });

  it('tries again after a failure, because the slot is cleared either way', async () => {
    const { service, loader } = serviceWith({ knife: () => bodyFile('knife') });
    loader.failures.set('knife', new Error('offline'));
    expect(await refusal(service.preloadKnife())).toBe('offline');
    loader.failures.delete('knife');
    await service.preloadKnife();
    expect(service.knife()).not.toBeNull();
    expect(loader.countOf('knife')).toBe(2);
  });
});

describe('equipment, one id at a time', () => {
  it('reads the palm and the ring off a thrown one', async () => {
    const { service } = serviceWith({ eq_frag: () => bodyFile('eq_frag', ['socket_grip', 'socket_pin']) });
    await service.preloadEquipment('frag');
    const frag = service.equipment('frag');
    expect(frag?.equipmentId).toBe('frag');
    expect(frag?.scene.name).toBe('eq_frag');
    expect(frag?.sockets.socket_grip?.toArray()).toEqual([0.5, 0.25, 0.125]);
    expect(frag?.sockets.socket_pin?.toArray()).toEqual([1, 0.5, 0.25]);
  });

  it('takes one that has only a palm, which is what a claymore is', async () => {
    const { service } = serviceWith({ eq_claymore: () => bodyFile('eq_claymore', ['socket_grip']) });
    await service.preloadEquipment('claymore');
    expect(service.equipment('claymore')?.sockets.socket_pin).toBeUndefined();
    expect(service.equipment('claymore')?.sockets.socket_grip).toBeDefined();
  });

  it('resolves and fetches nothing for a piece of equipment with no file', async () => {
    const { service, loader } = serviceWith();
    await service.preloadEquipment('nothing_like_it');
    expect(loader.requests).toEqual([]);
    expect(service.equipment('nothing_like_it')).toBeNull();
  });

  it('keeps a task per id, so two in one frame are two requests and each is shared', async () => {
    const { service, loader } = serviceWith({
      eq_frag: () => bodyFile('eq_frag', ['socket_grip']),
      eq_smoke: () => bodyFile('eq_smoke', ['socket_grip']),
    });
    const frag = service.preloadEquipment('frag');
    expect(service.preloadEquipment('frag')).toBe(frag);
    await Promise.all([frag, service.preloadEquipment('smoke')]);
    expect(loader.countOf('eq_frag')).toBe(1);
    expect(loader.countOf('eq_smoke')).toBe(1);
    await service.preloadEquipment('frag');
    expect(loader.countOf('eq_frag')).toBe(1);
  });

  it('names the file in the message when the contract is not met', async () => {
    const { service } = serviceWith({ eq_smoke: () => bodyFile('eq_smoke', [], { noBody: true }) });
    expect(await refusal(service.preloadEquipment('smoke'))).toBe('Equipment file "eq_smoke" has no root named "eq_smoke" with a "body" group.');
    expect(service.equipment('smoke')).toBeNull();
  });
});

describe('teardown', () => {
  it('refuses every loader afterwards, with the same message', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    service.dispose();
    expect(await refusal(service.preload('ar_carbine'))).toBe(DISPOSED);
    expect(await refusal(service.preloadLod('ar_carbine'))).toBe(DISPOSED);
    expect(await refusal(service.preloadKnife())).toBe(DISPOSED);
    expect(await refusal(service.preloadHands())).toBe(DISPOSED);
    expect(await refusal(service.preloadShield())).toBe(DISPOSED);
    expect(await refusal(service.preloadEquipment('frag'))).toBe(DISPOSED);
  });

  it('answers null to every read afterwards', async () => {
    const { service } = serviceWith({
      ar_carbine: () => weaponFile('ar_carbine'),
      knife: () => bodyFile('knife'),
      hands: () => handsFile(),
      streak_shield: () => bodyFile('streak_shield', ['socket_grip']),
      eq_frag: () => bodyFile('eq_frag', ['socket_grip']),
    });
    await service.preload('ar_carbine');
    await Promise.all([service.preloadKnife(), service.preloadHands(), service.preloadShield(), service.preloadEquipment('frag')]);
    service.dispose();
    expect(service.template('ar_carbine')).toBeNull();
    expect(service.part('att_optic')).toBeNull();
    expect(service.knife()).toBeNull();
    expect(service.hands()).toBeNull();
    expect(service.shield()).toBeNull();
    expect(service.equipment('frag')).toBeNull();
    expect(service.lod('ar_carbine')).toBeNull();
  });

  it('releases the geometry, the material and the texture every template owns', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    const root = service.template('ar_carbine')?.scene;
    const body = root?.getObjectByName('body') as THREE.Mesh;
    const material = body.material as THREE.MeshStandardMaterial;
    const texture = material.map as THREE.Texture;

    let geometryGone = false;
    let materialGone = false;
    let textureGone = false;
    body.geometry.addEventListener('dispose', () => {
      geometryGone = true;
    });
    material.addEventListener('dispose', () => {
      materialGone = true;
    });
    texture.addEventListener('dispose', () => {
      textureGone = true;
    });

    service.dispose();
    expect([geometryGone, materialGone, textureGone]).toEqual([true, true, true]);
    expect(root?.children).toEqual([]);
  });

  it('releases a file that arrives after the teardown, rather than holding it', async () => {
    const { service, loader } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    const hold = loader.hold('ar_carbine');
    const task = service.preload('ar_carbine');
    service.dispose();

    const late = weaponFile('ar_carbine');
    const body = late.scene.getObjectByName('body') as THREE.Mesh;
    let released = false;
    body.geometry.addEventListener('dispose', () => {
      released = true;
    });
    loader.release('ar_carbine');
    hold.resolve(late);
    expect(await refusal(task)).toBe('Weapon asset service was disposed while a file was loading.');
    expect(released).toBe(true);
  });

  it('says which loader was in flight when the teardown caught it', async () => {
    const cases: ReadonlyArray<readonly [string, (s: WeaponAssetService) => Promise<void>, () => { scene: THREE.Object3D }, string]> = [
      ['ar_carbine', (s) => s.preloadLod('ar_carbine'), () => lodFile('ar_carbine'), 'a LOD'],
      ['hands', (s) => s.preloadHands(), () => handsFile(), 'the hands'],
      ['knife', (s) => s.preloadKnife(), () => bodyFile('knife'), 'the knife'],
      ['streak_shield', (s) => s.preloadShield(), () => bodyFile('streak_shield'), 'the shield'],
      ['eq_frag', (s) => s.preloadEquipment('frag'), () => bodyFile('eq_frag'), 'equipment'],
    ];
    for (const [id, start, make, what] of cases) {
      const { service, loader } = serviceWith();
      const hold = loader.hold(id);
      const task = start(service);
      service.dispose();
      loader.release(id);
      hold.resolve(make());
      const expected = what === 'the hands' ? 'the hands were' : `${what} was`;
      expect(await refusal(task)).toBe(`Weapon asset service was disposed while ${expected} loading.`);
    }
  });

  it('is idempotent', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    service.dispose();
    expect(() => service.dispose()).not.toThrow();
  });
});

describe('reading a clone built from a template', () => {
  it('finds the three groups by the names the contract validated', async () => {
    const { service } = serviceWith({ ar_carbine: () => weaponFile('ar_carbine') });
    await service.preload('ar_carbine');
    const clone = service.template('ar_carbine')?.scene.clone();
    expect(clone).toBeDefined();
    const groups = groupNodes(clone as THREE.Object3D);
    expect(Object.keys(groups).sort()).toEqual(['body', 'charge', 'magazine']);
    expect(groups.body.name).toBe('body');
    expect(groups.magazine.name).toBe('magazine');
  });

  it('says the template was validated with one, when a clone has lost a group', () => {
    const root = node('ar_carbine');
    root.add(meshNode('body'));
    root.add(meshNode('magazine'));
    expect(() => groupNodes(root)).toThrow('Weapon clone has no "charge" group; the template was validated with one.');
  });
});
