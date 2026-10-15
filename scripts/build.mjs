import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'src', 'config.json', '.nojekyll']) {
  await cp(file, `dist/${file}`, { recursive: true });
}
console.log('Static site built in dist/ (server code and private files excluded).');
