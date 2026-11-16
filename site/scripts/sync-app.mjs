// Copies the assistant (../app) into public/app so the landing page can link to it
// and reuse its reactor + skills. The copy is git-ignored; ../app is the source of truth.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../app', import.meta.url));
const to = fileURLToPath(new URL('../public/app', import.meta.url));
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('synced app -> site/public/app');
