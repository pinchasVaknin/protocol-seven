import { defineConfig } from 'vitest/config';

/**
 * The unit-test runner (M14, Phase A).
 *
 * Its own file rather than a `test` block in `vite.config.ts`, and it does not import that
 * config either: the client config carries `define.__SERVER_URL__`, an `optimizeDeps` list for
 * three and a dev `server` block, none of which a test wants, and importing it would make every
 * test run depend on an environment variable it never reads.
 *
 * Tests are co-located (`X.test.ts` beside `X.ts`) and compiled by the partition they sit in,
 * so a `shared/` test typechecks with no DOM lib and imports `describe/it/expect` explicitly —
 * there are no globals here, by design, because a global `expect` would be a name the boundary
 * check cannot see the origin of. The environment is `node` for the same reason: S2 admits
 * vitest and nothing else, so there is no jsdom, and a client test covers pure functions only.
 *
 * Vitest tests pure functions; the headless harnesses (`npm run harness`, `skirmish`, `leak`,
 * `content`, ...) stay the integration instruments. A test that goes red against the tree as
 * it is reports a finding — it does not get "fixed" in the audit or the harness.
 */
export default defineConfig({
  // The same option the two Vite builds carry (Phase B): oxc lowers legacy decorators only.
  // Standard (TC39) decorators do not run on this toolchain — the `@` line ships verbatim —
  // so the whole tree, tests included, is on `experimentalDecorators`. Harmless before any
  // decorator exists; wrong to leave out once one does, because vitest uses Vite's transform.
  oxc: { decorator: { legacy: true } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    /**
     * Thirty seconds, against Vitest's own default of five (BACKLOG #68, 2026-11-07).
     *
     * A per-test timeout is a **hang detector**, not a performance budget — nothing here
     * asserts on how long a test took. At five seconds it had stopped being the first and
     * become the second, and it was failing tests that were working correctly.
     *
     * The numbers it was recalibrated from. The suite runs one worker per file — the runner
     * reports *"251 workers spawned · ~906 ms startup each"* — so every test's wall clock is
     * mostly contention, and contention is whatever else the machine is doing:
     *
     *   the slowest test in the suite, run alone                            2,253 ms
     *   the same test, whole suite, machine otherwise idle                  ~2,900 ms
     *   the same test, whole suite, a browser and a game client also open   6,819 ms
     *
     * The second-slowest four land between 2.4 s and 3.7 s under that load and the rest of
     * the 4,990 are under 1.3 s, so the suite is four tests with no headroom and a very long
     * tail with plenty. On 2026-11-07 that cost four false failures on an untouched tree —
     * every one a timeout, not one a failed assertion — which is the worst way for a suite to
     * fail, because the fix is to run it again and the lesson is to stop believing it.
     *
     * Thirty is about eight times the slowest honest test at its worst measured contention. A
     * real hang still stops in thirty seconds, which is plain against a suite that finishes in
     * twenty to sixty.
     *
     * **Not `fsModuleCache: true`**, which the runner advertises on every single run —
     * *"transforming modules took 244.10s · 41% of tracked time, re-done on every run"*. It was
     * measured on 2026-11-22, three cold gate runs each way: without it 143 s, 114 s, 172 s of
     * wall clock; with it 152 s, 121 s, 164 s. The advisory line goes away and the wall clock
     * does not move, because the transforms already overlap test execution across workers — the
     * 244 s is spread over 317 of them, not spent before the first one starts. It also did not
     * prevent the one timeout this suite produces: BACKLOG #77's failure reproduced *with* the
     * cache on. So the option buys a quieter report and nothing else here, and a persisted
     * transform cache is a staleness class this project has no need to take on. Left off, with
     * the numbers, because the runner will keep suggesting it.
     *
     * **Not `isolate: false`**, which the runner itself advertises underneath that line as
     * *"at least ~19.77 s faster"*. It reuses a worker's module registry across files, and a
     * dozen test files here install a global `document` or an `installClock` that would then
     * outlive the file that set it. Trading four honest timeouts for a class of
     * order-dependent failures across 256 files is the wrong trade; the speed is real and the
     * risk is why it stays off.
     */
    testTimeout: 30_000,
    // The same argument: a `beforeAll` that bakes a map is as exposed to contention as the
    // test it prepares, and Vitest's 10 s default is the same cliff one step earlier.
    hookTimeout: 30_000,
  },
});
