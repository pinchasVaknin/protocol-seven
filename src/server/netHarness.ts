import { BOT_ID_BASE } from '../shared/ai/BotDirector';
import { installClock } from '../shared/core/Clock';
import { logger } from '../shared/core/Log';
import { NO_SKIN_INDEX, SKIN_IDS } from '../shared/meta/Skins';
import { describeConditions, NET_PERFECT, parseConditions, type NetConditions } from '../shared/net/NetSim';
import { HeadlessClient, type ClientBehaviour } from './debug/HeadlessClient';
import { installServerLogging, metric } from './log';
import { nodeClock } from './NodeClock';
import { probeHardening } from './debug/Hardening';
import { runHitTest } from './debug/HitTest';

/**
 * Headless clients against a running server (M10, S7 and S8).
 *
 * S7's last instrumentation bullet: *"Extend the M9 headless harness to run headless clients
 * against the deployed server, so a networked match can be left running unattended."*
 *
 * ```bash
 *   npm run netharness -- --url ws://127.0.0.1:8080 --clients 2 --seconds 60 --net 100
 * ```
 *
 * Every number S8 asks a client for comes out of this: misprediction count and distance,
 * bandwidth up and down, snapshot size, hit rate, replay depth. Because the clients run the
 * real `NetClient`, those numbers describe the code a browser runs.
 *
 * HARD RULE 9 is why `--net` exists and why it is reported with every result: *"Every network
 * claim is made under the simulated conditions in S7, or against the deployed server, or it is
 * not made."* The condition string is echoed into every record so no number is ever printed
 * without the conditions it was taken under.
 */

interface Args {
  url: string;
  clients: number;
  seconds: number;
  conditions: NetConditions;
  conditionSpec: string;
  map: string;
  behaviour: ClientBehaviour;
  seed: number;
  /** Run the S8.12 hardening probes instead of a match. */
  harden: boolean;
  /** Run the S8.6 controlled hit-registration experiment instead of a match. */
  hittest: boolean;
  /** The experiment's target holds crouch (M13 C2). */
  crouch: boolean;
  /** Disconnect test: 'clean', 'hard' or 'none' (S8.11). */
  disconnect: 'clean' | 'hard' | 'none';
  /**
   * The body on the wire (M16, B6): every client declares a different skin at its `Hello`, and
   * at the end every client's snapshots are read back — the body each one is told about for
   * every other must be the one that client declared, and every bot must be "declared none".
   * The run exits non-zero if any pair disagrees, which makes it the milestone's gate rather
   * than its report.
   */
  skins: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    url: 'ws://127.0.0.1:8080',
    clients: 2,
    seconds: 30,
    conditions: NET_PERFECT,
    conditionSpec: 'none',
    map: 'mp_foundry',
    behaviour: 'shooter',
    seed: 1,
    harden: false,
    hittest: false,
    crouch: false,
    disconnect: 'none',
    skins: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--url':
        if (value !== undefined) args.url = value;
        i++;
        break;
      case '--clients':
        if (value !== undefined) args.clients = clampInt(Number(value), 1, 10);
        i++;
        break;
      case '--seconds':
        if (value !== undefined) args.seconds = clampInt(Number(value), 1, 86_400);
        i++;
        break;
      case '--net': {
        if (value !== undefined) {
          const parsed = parseConditions(value);
          if (parsed === null) {
            process.stderr.write(`unrecognised --net '${value}'\n`);
            process.exit(2);
          }
          args.conditions = parsed;
          args.conditionSpec = value;
        }
        i++;
        break;
      }
      case '--map':
        if (value !== undefined) args.map = value;
        i++;
        break;
      case '--behaviour':
        if (value === 'strafe' || value === 'idle' || value === 'runner' || value === 'shooter') {
          args.behaviour = value;
        }
        i++;
        break;
      case '--seed':
        if (value !== undefined) args.seed = clampInt(Number(value), 0, 0x7fff_ffff);
        i++;
        break;
      case '--harden':
        args.harden = true;
        break;
      case '--hittest':
        args.hittest = true;
        break;
      case '--crouch':
        args.crouch = true;
        break;
      case '--skins':
        args.skins = true;
        break;
      case '--disconnect':
        if (value === 'clean' || value === 'hard') args.disconnect = value;
        i++;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  installClock(nodeClock);
  installServerLogging(process.stdout.isTTY === true ? 'text' : 'json', 'info');
  const log = logger('netharness');

  if (args.harden) {
    const result = await probeHardening(args.url);
    metric('netharness', 'hardening', { url: args.url, ...result });
    // The server surviving every probe is the pass condition (S8.12).
    return result.serverAlive ? 0 : 1;
  }

  if (args.hittest) {
    const result = await runHitTest(args.url, args.conditions, args.seconds, args.seed, args.crouch);
    metric('netharness', 'hittest', { url: args.url, ...result });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return 0;
  }

  log.info(
    `${args.clients} headless client(s) -> ${args.url}, ${args.seconds}s, ` +
      `conditions: ${describeConditions(args.conditions)}.`,
  );

  const clients: HeadlessClient[] = [];
  for (let i = 0; i < args.clients; i++) {
    const client = new HeadlessClient({
      url: args.url,
      name: `HEADLESS${i + 1}`,
      mapId: args.map,
      conditions: args.conditions,
      // The first client shoots and the rest strafe, so there is always something worth
      // rewinding to. A room full of shooters all aiming at each other measures the aim
      // script more than it measures the netcode.
      behaviour: i === 0 ? args.behaviour : 'strafe',
      seed: args.seed + i * 7919,
      // Distinct for up to seven clients; the eighth wears the first's, which the check knows.
      skinIndex: args.skins ? i % SKIN_IDS.length : undefined,
    });
    try {
      await client.connect();
    } catch (err) {
      log.error(`client ${i + 1} could not connect: ${errText(err)}`);
      return 1;
    }
    clients.push(client);
  }

  /**
   * Drive the clients faster than the tick rate.
   *
   * Deliberately ~250 Hz rather than 60. A client only produces a command when the synced
   * clock says a new tick is due, so polling faster does not produce more commands — it
   * removes the *scheduler* from the measurement.
   *
   * This was measured, not assumed. Driving at 60 Hz on a 16 ms `setInterval`, Windows timer
   * granularity made some wake-ups 10 ms late, the client sampled two ticks' worth in one
   * update and none in the next, and its commands arrived at the server in bursts that
   * outran the jitter buffer. The server filled the gaps by repeating the previous command
   * (S6.2), which is exactly right and is also a genuine divergence from what the client
   * predicted — so it reported mispredictions that were an artifact of the harness's own
   * timer rather than of the netcode. A browser on `requestAnimationFrame` does not have
   * this problem; a Node test harness on a coarse timer does.
   */
  const endAt = Date.now() + args.seconds * 1000;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      for (const c of clients) c.update();
      if (Date.now() >= endAt) {
        clearInterval(timer);
        resolve();
      }
    }, 4);
  });

  // S8.11: both disconnect kinds, and the server must survive either.
  if (args.disconnect !== 'none') {
    const victim = clients[0];
    if (victim !== undefined) {
      log.info(`disconnecting ${victim.report().name} (${args.disconnect}).`);
      victim.disconnect(args.disconnect === 'clean');
      // Let the remaining clients run on, so a ghost entity or a stalled tick would show up
      // in their snapshots rather than being missed by stopping immediately.
      const settleUntil = Date.now() + 12_000;
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          for (const c of clients) if (c !== victim) c.update();
          if (Date.now() >= settleUntil) {
            clearInterval(timer);
            resolve();
          }
        }, 4);
      });
    }
  }

  let worstMisprediction = 0;
  let totalMispredictions = 0;

  for (const c of clients) {
    const r = c.report();
    totalMispredictions += r.mispredictions;
    worstMisprediction = Math.max(worstMisprediction, r.mispredictionP99);
    metric('netharness', 'client', {
      conditions: describeConditions(args.conditions),
      name: r.name,
      entity: r.entityId,
      state: r.state,
      closeReason: r.closeReason,
      ticks: r.ticksSimulated,
      rttMs: round(r.stats.rttMs),
      jitterMs: round(r.stats.jitterMs),
      clockOffsetMs: round(r.stats.clockOffsetMs),
      leadTicks: r.stats.leadTicks,
      marginMs: round(r.stats.marginMs),
      adaptiveMs: round(r.stats.adaptiveMs),
      mispredictions: r.mispredictions,
      comparisons: r.comparisons,
      mispredictionP50: r.mispredictionP50,
      mispredictionP99: r.mispredictionP99,
      maxReplayDepth: r.maxReplayDepth,
      snapshots: r.stats.snapshotsReceived,
      snapshotsPerSec: round(r.stats.snapshotsPerSecond),
      snapshotBytesMean: round(r.stats.meanSnapshotBytes),
      snapshotsLost: r.stats.snapshotsLost,
      bytesInPerSec: round(r.stats.bytesInPerSecond),
      bytesOutPerSec: round(r.stats.bytesOutPerSecond),
      shotsFired: r.shotsFired,
      shotsHit: r.shotsHit,
      hitsDealt: r.hitsDealt,
      // Rays over rays (round 5, B5). This was `hitsDealt / shotsFired`, which is damage
      // events over trigger pulls and has no ceiling.
      hitRate: r.shotsFired === 0 ? 0 : round(r.shotsHit / r.shotsFired),
      killsDealt: r.killsDealt,
      deaths: r.deaths,
      deathCycles: r.deathCycles,
      metresSinceRespawn: r.metresSinceRespawn,
      remotes: r.remotes,
    });
  }

  const skinFailures = args.skins ? checkBodies(clients, log) : 0;

  for (const c of clients) c.disconnect(true);

  metric('netharness', 'run.end', {
    url: args.url,
    clients: args.clients,
    seconds: args.seconds,
    conditions: describeConditions(args.conditions),
    conditionSpec: args.conditionSpec,
    totalMispredictions,
    worstMispredictionP99: round(worstMisprediction),
    ...(args.skins ? { skinFailures } : {}),
  });

  // Let the close frames actually leave before the process does.
  await new Promise((resolve) => setTimeout(resolve, 250));
  return skinFailures === 0 ? 0 : 1;
}

/**
 * The `--skins` assertion (M16, B6): for every ordered pair of clients, the body `viewer` was
 * told `subject` wears is the one `subject` declared — its own included — and every bot in
 * anybody's view is `NO_SKIN_INDEX`. One metric line per client with what it saw; the count
 * of disagreements is the exit code's.
 */
function checkBodies(clients: readonly HeadlessClient[], log: ReturnType<typeof logger>): number {
  let failures = 0;
  const declared = new Map<number, { name: string; skin: number }>();
  for (const c of clients) {
    const r = c.report();
    declared.set(r.entityId, { name: r.name, skin: c.skinIndex ?? NO_SKIN_INDEX });
  }
  for (const viewer of clients) {
    const seen = viewer.bodiesSeen();
    const bodies: Record<string, string> = {};
    let humans = 0;
    let bots = 0;
    for (const [entityId, index] of seen) {
      const who = declared.get(entityId);
      const expected = entityId >= BOT_ID_BASE ? NO_SKIN_INDEX : who?.skin;
      const label = who?.name ?? (entityId >= BOT_ID_BASE ? `bot${entityId}` : `entity${entityId}`);
      bodies[label] = index === NO_SKIN_INDEX ? 'none' : (SKIN_IDS[index] ?? `?${index}`);
      if (entityId >= BOT_ID_BASE) bots++;
      else humans++;
      if (expected === undefined) continue; // a human this run did not field — a disconnected seat's ghost, if any
      if (index !== expected) {
        failures++;
        log.error(
          `${viewer.report().name} sees ${label} as ${bodies[label]}; ${label} declared ` +
            `${expected === NO_SKIN_INDEX ? 'none' : SKIN_IDS[expected]}.`,
        );
      }
    }
    metric('netharness', 'skins', { viewer: viewer.report().name, humans, bots, bodies });
  }
  if (failures === 0) log.info(`skins: every client sees every other as the body it declared (${clients.length} clients).`);
  return failures;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  const i = Math.round(v);
  return i < lo ? lo : i > hi ? hi : i;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`fatal: ${errText(err)}\n`);
    process.exit(1);
  },
);
