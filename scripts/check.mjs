import { readFile } from 'node:fs/promises';

for (const file of ['index.html', 'app.js', 'styles.css']) {
  await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

console.log('Static Vercel build check passed.');
