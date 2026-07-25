import * as esbuild from 'esbuild';
export default {
  bundle: true,
  entryPoints: ['src/client/main.ts'],
  outfile: 'public/bundle.js',
  sourcemap: true,
  minify: false,
  format: 'esm'
};
