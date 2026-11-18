// 디어밸리 터치앤고 서버: 정적 화면 + 착륙 기록 API + 실시간 날씨 + 멀티 WebSocket
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPool } from './src/db.js';
import { landingRoutes, InputError } from './src/landings.js';
import { WeatherService } from './src/weather.js';
import { attachMultiplayer } from './src/multiplayer.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// .env 파일이 있으면 읽는다 (값은 화면에 출력하지 않음)
function loadEnv() {
  const f = path.join(here, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function createApp({ pool, mode, weather, rateMs }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '120kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, db: mode }));
  app.get('/api/weather', async (_req, res) => res.json(await weather.get()));
  app.use('/api', landingRoutes(pool, { rateMs }));
  app.use('/api', (_req, res) => res.status(404).json({ error: '없는 주소입니다.' }));
  app.use(express.static(path.join(here, 'public'), { extensions: ['html'], maxAge: 0 }));
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '보낸 내용이 너무 큽니다.' });
    console.error(err);
    res.status(500).json({ error: '서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' });
  });
  return app;
}

export async function start(port = Number(process.env.PORT) || 3000) {
  const { pool, mode } = await createPool();
  const weather = new WeatherService();
  const app = createApp({ pool, mode, weather });
  const server = http.createServer(app);
  attachMultiplayer(server);
  await new Promise((r) => server.listen(port, r));
  console.log(`디어밸리 터치앤고: http://localhost:${port} (DB: ${mode === 'postgres' ? 'Supabase' : '메모리(개발용)'})`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  start().catch((e) => {
    console.error('서버를 시작하지 못했습니다:', e.message);
    process.exit(1);
  });
}
