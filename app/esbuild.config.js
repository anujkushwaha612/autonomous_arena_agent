import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  outfile: 'public/bundle.js',
  format: 'esm',
  platform: 'browser',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info'
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('Watching client files');
} else {
  await esbuild.build(options);
}
