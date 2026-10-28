// environment.ts is gitignored (local overrides). A fresh clone still needs the file to compile,
// so seed it from the tracked example. Never overwrites an existing local file.
import { copyFileSync, existsSync } from 'node:fs';

const target = new URL('../src/environments/environment.ts', import.meta.url);
const example = new URL('../src/environments/environment.example.ts', import.meta.url);

if (!existsSync(target)) {
  copyFileSync(example, target);
  console.log('Created src/environments/environment.ts from environment.example.ts');
}
