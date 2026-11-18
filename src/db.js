// DB 연결: DATABASE_URL이 있으면 Supabase(Postgres), 없으면 개발·테스트용 메모리 DB(pg-mem).
// 배포(NODE_ENV=production)에서 DATABASE_URL이 없으면 기록이 사라지므로 아예 시작하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');

export async function createMemoryPool() {
  const { newDb, DataType } = await import('pg-mem');
  const mem = newDb();
  mem.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (s) => [...s].length });
  mem.public.none(SCHEMA.replace(/create index[^;]*;/gi, ''));
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

export async function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL이 없습니다. 배포 환경변수에 Supabase 연결 주소를 넣어 주세요.');
    return { pool: await createMemoryPool(), mode: 'memory' };
  }
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5 });
  await pool.query(SCHEMA);
  return { pool, mode: 'postgres' };
}
