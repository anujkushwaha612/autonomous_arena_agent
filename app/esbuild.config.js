// esbuild.config.js — bundles the client into app/public/bundle.js
// Single binary, no config sprawl. Watch mode via --watch flag.
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production' || !isWatch;

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(__dirname, 'src/client/main.ts')],
  outfile: path.join(__dirname, 'public/bundle.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  sourcemap: true,
  minify: isProd,
  logLevel: 'info',
};

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] build complete');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
