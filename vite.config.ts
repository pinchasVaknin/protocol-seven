import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The server address, injected at build time (M10, S4.9).
 *
 * S4.9: *"The server address is **configuration**, injected at build or runtime. Never
 * hardcoded."* This is the build-time half; `?server=` on the URL is the runtime half and
 * takes precedence over it. Both are absent by default, and absent means single-player —
 * which is what keeps opening the page behaving exactly as it did before this milestone.
 *
 * ```bash
 *   VITE_SERVER_URL=wss://play.example.com/ws npm run build
 * ```
 */
const serverUrl = process.env['VITE_SERVER_URL'] ?? '';

/**
 * The build's version, for the footer's stamp (M17, C1: `PROTOCOL 7 // <PLACE> // V x.y.z`).
 *
 * Read off `package.json` here rather than written into a source file, so there is one number
 * and it is the one `npm version` moves. `ui/ScreenChrome.ts` reads the define and prints `dev`
 * where it is absent.
 */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: {
    __SERVER_URL__: JSON.stringify(serverUrl),
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    // `three/examples/jsm/*` imports bare `three`, which the dep optimiser is happy to
    // resolve to a second copy — Three then warns about multiple instances at boot and
    // the two copies stop sharing state. One `three`, deduped.
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  /**
   * Lower legacy decorators (M14, Phase B). The standard TC39 form is not an option on this
   * toolchain: oxc ships the `@name` line verbatim whatever `build.target` says, and every
   * browser then throws a SyntaxError at load. `experimentalDecorators` in tsconfig.base.json
   * is the compiler's half of the same choice, and `vitest.config.ts` carries this line too
   * because vitest transforms through Vite. Revisit when oxc's `DecoratorOptions` grows past
   * `legacy` and `emitDecoratorMetadata`.
   */
  oxc: { decorator: { legacy: true } },
  build: {
    target: 'es2022',
    /**
     * No source maps in the build that ships (security audit 2026-10-04, S5).
     *
     * A map is the whole TypeScript source with every comment, served beside the bundle — it is
     * what made the deployed game readable as source in anybody's DevTools. The dev server maps
     * everything regardless, so development loses nothing, and `serve.js` refuses a `.map` even
     * if a build writes one.
     */
    sourcemap: false,
  },
  plugins: [dropDevOnlyPublicFiles()],
});

/**
 * Folders of `public/` that the dev server serves and the build must not ship (S5).
 *
 * `verify/` holds the acceptance scripts DEBUG.md loads with `fetch(...).then(eval)` against the
 * dev server. Vite copies all of `public/` into every build, so they were on the deployed game too,
 * where the Content-Security-Policy refuses the `eval` anyway. Removed from `dist/` once the build
 * has written it; `public/` and the dev server are untouched.
 */
function dropDevOnlyPublicFiles(): Plugin {
  const devOnly = ['verify'];
  let outDir = 'dist';
  return {
    name: 'protocol-seven:drop-dev-only-public-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const dir of devOnly) rmSync(resolve(outDir, dir), { recursive: true, force: true });
    },
  };
}
