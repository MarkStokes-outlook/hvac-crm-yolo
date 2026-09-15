import './lib/time.ts'; // sets UK timezone before anything else
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, q } from './db/index.ts';

// Minimal .env loader (no dependency)
const envFile = path.join(APP_ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createApp } = await import('./app.ts');
const { seed } = await import('./seed/seed.ts');

const users = q.get<{ n: number }>('SELECT COUNT(*) n FROM users');
if (!users?.n) {
  console.log('Empty database — loading demo data…');
  seed();
}

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, () => {
  console.log(`FrostLine Ops API on http://localhost:${port}  (AI: ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'not configured'})`);
});
