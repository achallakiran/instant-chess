import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/ui/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  logLevel: 'error',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/ui/template.html', 'utf8').replace('/*BUNDLE*/', () => js);

writeFileSync('index.html', html);
console.log(`index.html  ${(html.length / 1024).toFixed(0)} KB`);
