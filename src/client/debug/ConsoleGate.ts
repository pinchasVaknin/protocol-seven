/**
 * Whether this page gets `window.__p7` (security audit 2026-10-04, S5).
 *
 * Every build used to install it, so on the deployed game one line in the console handed anybody
 * the whole `Game` — every remote actor's position, the camera, the input sampler — which is the
 * first thing an aimbot or a wallhack script reaches for. It changes nothing the server decides,
 * and the bar it sets is low: a determined cheater finds the same objects with a breakpoint. It is
 * still the difference between pasting a script and writing one.
 *
 * Installed:
 *
 * - **under `npm run dev`** (`import.meta.env.DEV`), which is where DEBUG.md's measurements and
 *   the browser-pane checks run, so nothing about development changes;
 * - **with `?debug=1`**, for reading a deployed build — a playtest report, a production-only bug;
 * - **with `?harness`**, because the in-browser bot harness reports through `__p7.harnessReport()`.
 *
 * The `DEBUG666` overlay is a separate thing and stays on every build: it draws what the client
 * already knows and hands nothing to a script.
 */
export function consoleApiWanted(search: string, dev: boolean): boolean {
  if (dev) return true;
  const params = new URLSearchParams(search);
  return params.get('debug') === '1' || params.get('harness') !== null;
}
