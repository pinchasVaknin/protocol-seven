import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraRig } from '../engine/CameraRig';
import type { ProceduralAudio } from '../engine/ProceduralAudio';
import type { Combatant } from '../../shared/ai/Combatant';
import type { ScoreSystem, ScoreTeam } from '../../shared/combat/ScoreSystem';
import { EV, createGameBus, type GameBus, type GameEvents } from '../../shared/core/Events';
import type { ColumnDef } from '../../shared/modes/GameMode';
import type { MatchFlow } from '../../shared/modes/MatchFlow';
import type { MapDef } from '../../shared/world/maps/types';
import { MatchHud } from './MatchHud';
import { viewport } from './Viewport';

/**
 * Characterization tests for the presentation composition root (refactor unit C15, written
 * before the refactor).
 *
 * `MatchHud` computes nothing about the match — its whole job is subscription and assembly —
 * so what is pinned here is the assembly: which surface gets which fact, and on which event.
 * Everything it composes is real: a real `Hud` with a real `Minimap` and `KillfeedView`, a real
 * `Scoreboard`, a real `HudStreaks`, a real `EventBus` and a real `THREE.PerspectiveCamera`.
 * Only the document, the audio and the score system are stand-ins, and the score system only
 * because the board reads one member off it.
 */

// ---------------------------------------------------------------------------- the DOM double

class RecordingContext {
  readonly calls: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  globalAlpha = 1;
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  rect(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  drawImage(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
}

class FakeElement {
  readonly tokens = new Set<string>();
  readonly style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  readonly properties = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  textContent = '';
  hidden = false;
  width = 0;
  height = 0;
  parent: FakeElement | null = null;
  ctx: RecordingContext | null = null;

  constructor(readonly tag: string) {
    this.style = {
      opacity: '',
      transform: '',
      visibility: '',
      gridTemplateColumns: '',
      setProperty: (k: string, v: string) => void this.properties.set(k, v),
    } as unknown as Record<string, string> & { setProperty: (k: string, v: string) => void };
  }

  get className(): string {
    return [...this.tokens].join(' ');
  }

  set className(value: string) {
    this.tokens.clear();
    for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
  }

  readonly classList = {
    toggle: (token: string, on?: boolean): void => {
      const want = on ?? !this.tokens.has(token);
      if (want) this.tokens.add(token);
      else this.tokens.delete(token);
    },
    remove: (token: string): void => void this.tokens.delete(token),
    contains: (token: string): boolean => this.tokens.has(token),
  };

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  cloneNode(): FakeElement {
    const copy = new FakeElement(this.tag);
    for (const [k, v] of this.attributes) copy.setAttribute(k, v);
    return copy;
  }

  getContext(kind: string): RecordingContext | null {
    if (kind !== '2d') return null;
    this.ctx ??= new RecordingContext();
    return this.ctx;
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
  viewport.set(1920, 1080);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

const MAP = {
  objectives: [],
  navBounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 4, z: 10 } },
  brushes: [],
  props: [],
} as unknown as MapDef;

const COLUMNS: ColumnDef[] = [
  { key: 'kills', label: 'K', width: 4, align: 'right', value: (r) => String(r.kills) },
];

function combatant(over: Partial<Combatant> & { entityId: number }): Combatant {
  return {
    team: 'A',
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
    health: { alive: true },
    ...over,
  } as unknown as Combatant;
}

function flow(over: Partial<MatchFlow> = {}): MatchFlow {
  return {
    secondsRemaining: 600,
    round: 1,
    phaseSecondsRemaining: 0,
    currentPhase: 'LIVE',
    ...over,
  } as unknown as MatchFlow;
}

function fired(over: Partial<GameEvents['weapon.fired']> = {}): GameEvents['weapon.fired'] {
  return {
    weaponId: 'mk18',
    sourceId: 1,
    x: 3,
    y: 1,
    z: 4,
    dx: 0,
    dy: 0,
    dz: -1,
    endX: 3,
    endY: 1,
    endZ: -6,
    distance: 10,
    shotIndex: 0,
    spreadDeg: 1,
    tracer: false,
    hitTarget: false,
    ammoInMag: 29,
    pellets: 1,
    pelletsHit: 0,
    minimapPing: true,
    ...over,
  };
}

interface Rig {
  readonly hud: MatchHud;
  readonly bus: GameBus;
  readonly host: FakeElement;
  readonly roster: Combatant[];
  readonly announced: string[];
}

function rig(
  over: { localTeam?: ScoreTeam; freeForAll?: boolean; warmupArena?: boolean; ballotOpen?: boolean; roster?: Combatant[] } = {},
): Rig {
  const bus = createGameBus();
  const host = new FakeElement('div');
  const announced: string[] = [];
  const roster = over.roster ?? [];
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.6, 0);
  const hud = new MatchHud({
    bus,
    uiHost: host as unknown as HTMLElement,
    mapDef: MAP,
    mapName: 'FOUNDRY',
    modeName: 'TEAM DEATHMATCH',
    columns: COLUMNS,
    score: { rows: [] } as unknown as ScoreSystem,
    audio: { playAnnouncer: (cue: string) => void announced.push(cue) } as unknown as ProceduralAudio,
    localTeam: over.localTeam ?? 'A',
    roster,
    teamSize: 3,
    freeForAll: over.freeForAll ?? false,
    warmupArena: over.warmupArena ?? false,
    ballotOpen: () => over.ballotOpen ?? false,
    cameraRig: { camera } as unknown as CameraRig,
    modeBrief: 'ELIMINATE THE ENEMY TEAM',
  });
  return { hud, bus, host, roster, announced };
}

// ---------------------------------------------------------------------------- assembly

describe('construction', () => {
  it('mounts the HUD, the streak strip and the board on the one host', () => {
    const r = rig();
    const classes = r.host.children.map((c) => c.className);
    expect(classes).toContain('hud');
    expect(classes).toContain('hud-streaks');
    expect(classes).toContain('sb');
  });

  it('gives the minimap room for the whole side, the player included', () => {
    const r = rig();
    expect(r.hud.hud.minimap.friendlies).toHaveLength(4);
  });

  it('hands one viewer to all three surfaces that paint a team', () => {
    const r = rig({ localTeam: 'B' });
    const board = r.host.children.find((c) => c.tokens.has('sb'));
    const grid = board?.children[1];
    // The viewer own side is the left block, which from seat B is team B's.
    expect(grid?.children[0]?.className).toBe('sb__team sb__team--friendly');
    expect(grid?.children[0]?.children[0]?.children[0]?.textContent).toBe('ALLIES');
  });

  it('binds the mode columns and the title', () => {
    const r = rig();
    const board = r.host.children.find((c) => c.tokens.has('sb'));
    expect(board?.children[0]?.textContent).toBe('TEAM DEATHMATCH · FOUNDRY');
  });

  it('passes the HUD measurements straight through', () => {
    const r = rig();
    expect(r.hud.lastUpdateMs).toBe(r.hud.hud.lastUpdateMs);
    expect(r.hud.lowHealthIntensity).toBe(0);
  });
});

// ---------------------------------------------------------------------------- subscriptions

describe('the bus subscriptions', () => {
  it('puts a killfeed entry into the feed', () => {
    const r = rig();
    r.bus.emit(EV.KillfeedEntry, {
      killerName: 'VULTURE',
      victimName: 'MAGPIE',
      killerTeam: 'A',
      victimTeam: 'B',
      weaponId: 'mk18',
      headshot: false,
      suicide: false,
      involvesLocal: false,
    });
    const feed = r.hud.hud.feed.element as unknown as FakeElement;
    expect(feed.children[0]?.children[0]?.textContent).toBe('VULTURE');
  });

  it('puts the score on the banner state', () => {
    const r = rig();
    r.bus.emit(EV.ScoreChanged, { teamA: 7, teamB: 3, limit: 75 });
    expect(r.hud.state.banner.scoreA).toBe(7);
    expect(r.hud.state.banner.scoreB).toBe(3);
    expect(r.hud.state.banner.limit).toBe(75);
  });

  it('takes the round count off the match start', () => {
    const r = rig();
    expect(r.hud.state.banner.roundsToWin).toBe(1);
    r.bus.emit(EV.MatchStarted, {
      modeId: 'SND',
      modeName: 'SEARCH AND DESTROY',
      mapId: 'mp_foundry',
      mapName: 'FOUNDRY',
      roundsToWin: 4,
    });
    expect(r.hud.state.banner.roundsToWin).toBe(4);
  });

  it('plays the announcer cue', () => {
    const r = rig();
    r.bus.emit(EV.AnnouncerCue, { cue: 'matchWon' as GameEvents['announcer.cue']['cue'] });
    expect(r.announced).toEqual(['matchWon']);
  });

  it('releases every subscription on dispose', () => {
    const r = rig();
    r.hud.dispose();
    r.bus.emit(EV.ScoreChanged, { teamA: 9, teamB: 9, limit: 75 });
    expect(r.hud.state.banner.scoreA).toBe(0);
  });
});

// ---------------------------------------------------------------------------- the ping filter

describe('enemy gunfire pings the minimap', () => {
  function pings(r: Rig): number {
    // A ping is only visible through the draw, so count the ring arcs the frame makes.
    const calls: string[] = [];
    const canvas = (r.hud.hud.minimap.element as unknown as FakeElement).children[0];
    const ctx = canvas?.ctx;
    if (ctx != null) {
      const arc = ctx.arc.bind(ctx);
      ctx.arc = ((...a: number[]) => {
        calls.push(`arc(${a.join(',')})`);
        arc();
      }) as unknown as () => void;
    }
    r.hud.hud.minimap.update(0, 0, 0, 0);
    return calls.filter((c) => c.startsWith('arc(3,4')).length;
  }

  it('pings a shot from the other side', () => {
    const r = rig({ roster: [combatant({ entityId: 1, team: 'B' })] });
    r.bus.emit(EV.WeaponFired, fired({ sourceId: 1 }));
    expect(pings(r)).toBe(1);
  });

  it('does not ping your own side, because a team-mate is already a chevron', () => {
    const r = rig({ roster: [combatant({ entityId: 1, team: 'A' })] });
    r.bus.emit(EV.WeaponFired, fired({ sourceId: 1 }));
    expect(pings(r)).toBe(0);
  });

  it('does not ping a suppressed shot — that is what the can buys', () => {
    const r = rig({ roster: [combatant({ entityId: 1, team: 'B' })] });
    r.bus.emit(EV.WeaponFired, fired({ sourceId: 1, minimapPing: false }));
    expect(pings(r)).toBe(0);
  });

  it('ignores a shooter who is not on the roster', () => {
    const r = rig({ roster: [combatant({ entityId: 1, team: 'B' })] });
    r.bus.emit(EV.WeaponFired, fired({ sourceId: 99 }));
    expect(pings(r)).toBe(0);
  });

  it('pings everybody but you in Free-for-All, team notwithstanding', () => {
    const mine = rig({ freeForAll: true, roster: [combatant({ entityId: 0, team: 'A' })] });
    mine.bus.emit(EV.WeaponFired, fired({ sourceId: 0 }));
    expect(pings(mine)).toBe(0);

    const theirs = rig({ freeForAll: true, roster: [combatant({ entityId: 4, team: 'A' })] });
    theirs.bus.emit(EV.WeaponFired, fired({ sourceId: 4 }));
    expect(pings(theirs)).toBe(1);
  });
});

// ---------------------------------------------------------------------------- the frame

describe('update', () => {
  it('writes the player pose and the clock into the state', () => {
    const r = rig();
    r.hud.update(flow({ secondsRemaining: 125, round: 2 }), 3, -4, 1.25, 0.016);
    expect(r.hud.state.playerX).toBe(3);
    expect(r.hud.state.playerZ).toBe(-4);
    expect(r.hud.state.playerYaw).toBe(1.25);
    expect(r.hud.state.banner.secondsRemaining).toBe(125);
    expect(r.hud.state.banner.round).toBe(2);
  });

  it('is the one writer of the caption and its countdown', () => {
    const r = rig();
    r.hud.update(flow({ currentPhase: 'WARMUP', phaseSecondsRemaining: 9 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseLabel).toBe('GET READY');
    expect(r.hud.state.banner.phaseSeconds).toBe(9);

    r.hud.update(flow({ currentPhase: 'ROUND_END', phaseSecondsRemaining: 4 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseLabel).toBe('ROUND OVER');
  });

  it('drops the countdown in the arena, where it would count toward nothing', () => {
    const r = rig({ warmupArena: true });
    r.hud.update(flow({ currentPhase: 'LIVE', phaseSecondsRemaining: 5 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseLabel).toBe('WAITING');
    expect(r.hud.state.banner.phaseSeconds).toBe(0);
  });

  it('gives way to the ballot', () => {
    const r = rig({ warmupArena: true, ballotOpen: true });
    r.hud.update(flow({ currentPhase: 'LIVE' }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseLabel).toBe('');
  });

  it('shows the mode brief before the first round and not after', () => {
    const r = rig();
    r.hud.update(flow({ currentPhase: 'WARMUP', round: 1 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseBrief).toBe('ELIMINATE THE ENEMY TEAM');
    r.hud.update(flow({ currentPhase: 'LIVE', round: 2 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseBrief).toBe('');
  });

  it('never shows the brief in the arena', () => {
    const r = rig({ warmupArena: true });
    r.hud.update(flow({ currentPhase: 'WARMUP', round: 1 }), 0, 0, 0, 0);
    expect(r.hud.state.banner.phaseBrief).toBe('');
  });

  it('folds the pushed flash and threat into the one tactical record', () => {
    const r = rig();
    r.hud.hud.setFlash(0.7);
    r.hud.hud.setThreat(true, 1, 2, 3);
    r.hud.hud.setObjectiveBearing(true, 4, 5);
    r.hud.update(flow(), 0, 0, 0, 0);
    const tac = r.hud.state.tactical;
    expect(tac.flash).toBe(0.7);
    expect(tac.threatActive).toBe(true);
    expect(tac.threatX).toBe(1);
    expect(tac.threatY).toBe(2);
    expect(tac.threatZ).toBe(3);
    expect(tac.objectiveActive).toBe(true);
    expect(tac.objectiveX).toBe(4);
    expect(tac.objectiveZ).toBe(5);
  });

  it('projects a bearing for a live threat and leaves a dead one alone', () => {
    const r = rig();
    r.hud.hud.setThreat(true, 0, 1.6, -10);
    r.hud.update(flow(), 0, 0, 0, 0);
    // Straight ahead of a camera looking down -Z.
    expect(r.hud.state.tactical.threatBearingRad).toBeCloseTo(0, 6);

    r.hud.hud.setThreat(false, 0, 0, 0);
    r.hud.state.tactical.threatBearingRad = 99;
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.state.tactical.threatBearingRad).toBe(99);
  });

  it('puts a threat to the right at a positive bearing', () => {
    const r = rig();
    r.hud.hud.setThreat(true, 10, 1.6, -10);
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.state.tactical.threatBearingRad).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------- the minimap

describe('the friendly markers', () => {
  it('fills one marker per living team-mate, skipping the local player', () => {
    const r = rig({
      roster: [
        combatant({ entityId: 0, team: 'A', px: 9, pz: 9 }),
        combatant({ entityId: 1, team: 'A', px: 1, pz: 2, yaw: 0.5 }),
        combatant({ entityId: 2, team: 'B', px: 3, pz: 4 }),
      ],
    });
    r.hud.update(flow(), 0, 0, 0, 0);
    const markers = r.hud.hud.minimap.friendlies;
    expect(markers[0]).toMatchObject({ x: 1, z: 2, yaw: 0.5, active: true });
    expect(markers.slice(1).every((m) => !m.active)).toBe(true);
  });

  it('deactivates a marker for a team-mate who is down', () => {
    const r = rig({
      roster: [combatant({ entityId: 1, team: 'A', participating: false })],
    });
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.hud.minimap.friendlies[0]?.active).toBe(false);
  });

  it('draws no allies at all in Free-for-All', () => {
    const r = rig({
      freeForAll: true,
      roster: [combatant({ entityId: 1, team: 'A', px: 1, pz: 2 })],
    });
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.hud.minimap.friendlies.every((m) => !m.active)).toBe(true);
  });

  it('clears a marker left over from a roster that shrank', () => {
    const roster = [combatant({ entityId: 1, team: 'A' }), combatant({ entityId: 2, team: 'A' })];
    const r = rig({ roster });
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.hud.minimap.friendlies[1]?.active).toBe(true);
    roster.length = 1;
    r.hud.update(flow(), 0, 0, 0, 0);
    expect(r.hud.hud.minimap.friendlies[1]?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------- the surfaces

describe('the result surfaces and the board', () => {
  it('hides the banner and the streak strip together, through the hidden attribute', () => {
    const r = rig();
    const banner = r.hud.hud.banner.element as unknown as FakeElement;
    const streaks = r.hud.streaks.element as unknown as FakeElement;
    r.hud.setResultSurfacesVisible(false);
    expect(banner.hidden).toBe(true);
    expect(streaks.hidden).toBe(true);
    r.hud.setResultSurfacesVisible(true);
    expect(banner.hidden).toBe(false);
    expect(streaks.hidden).toBe(false);
  });

  it('leaves the caption alone — it is the one surface the arena adds', () => {
    const r = rig();
    const phase = r.hud.hud.banner.phaseElement as unknown as FakeElement;
    r.hud.setResultSurfacesVisible(false);
    expect(phase.hidden).toBe(false);
  });

  it('is guarded, so a frame that changes nothing writes nothing', () => {
    const r = rig();
    const banner = r.hud.hud.banner.element as unknown as FakeElement;
    r.hud.setResultSurfacesVisible(false);
    banner.hidden = false;
    r.hud.setResultSurfacesVisible(false);
    expect(banner.hidden).toBe(false);
  });

  it('opens and closes the board', () => {
    const r = rig();
    r.hud.setScoreboardOpen(true);
    expect(r.hud.scoreboard.isOpen).toBe(true);
    r.hud.setScoreboardOpen(false);
    expect(r.hud.scoreboard.isOpen).toBe(false);
  });

  it('closes the board when the HUD goes away', () => {
    const r = rig();
    r.hud.setScoreboardOpen(true);
    r.hud.setVisible(false);
    expect(r.hud.scoreboard.isOpen).toBe(false);
  });

  it('does not open the board merely by becoming visible', () => {
    const r = rig();
    r.hud.setVisible(true);
    expect(r.hud.scoreboard.isOpen).toBe(false);
  });

  it('wipes the HUD and shuts the board between matches', () => {
    const r = rig();
    r.hud.setScoreboardOpen(true);
    r.hud.hud.setFlash(0.9);
    r.hud.resetForMatch();
    expect(r.hud.scoreboard.isOpen).toBe(false);
    expect(r.hud.hud.pendingFlash).toBe(0);
  });

  it('takes every surface off the host on dispose', () => {
    const r = rig();
    expect(r.host.children.length).toBeGreaterThan(2);
    r.hud.dispose();
    expect(r.host.children.map((c) => c.className)).toEqual([]);
  });
});
