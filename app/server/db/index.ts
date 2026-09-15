import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, '../..');
export const DATA_DIR = process.env.FROSTLINE_DATA_DIR ?? path.join(APP_ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

type DB = Database.Database;
let instance: DB | null = null;

export function openDb(file = process.env.FROSTLINE_DB ?? path.join(DATA_DIR, 'frostline.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function db(): DB {
  if (!instance) instance = openDb();
  return instance;
}

/** Replace the shared connection (used by tests and the seeder). */
export function setDb(next: DB) {
  instance = next;
}

// SQL rows are loosely typed; services shape them for the API.
export type Row = any;

export const q = {
  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return db().prepare(sql).all(...params) as T[];
  },
  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return db().prepare(sql).get(...params) as T | undefined;
  },
  run(sql: string, ...params: unknown[]) {
    return db().prepare(sql).run(...params);
  },
  tx<T>(fn: () => T): T {
    return db().transaction(fn)();
  },
};

/** Insert a row from an object, returning the new id. Undefined values are skipped. */
export function insert(table: string, data: Row): number {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(db().prepare(sql).run(...keys.map((k) => norm(data[k]))).lastInsertRowid);
}

/** Update columns on a row by id. Undefined values are skipped. */
export function update(table: string, id: number, data: Row) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db().prepare(sql).run(...keys.map((k) => norm(data[k])), id);
}

function norm(v: unknown) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function nextNumber(name: string, prefix: string, pad = 5): string {
  return q.tx(() => {
    const row = q.get<{ value: number }>('SELECT value FROM sequences WHERE name = ?', name);
    const value = (row?.value ?? 0) + 1;
    q.run('INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, value);
    return `${prefix}${String(value).padStart(pad, '0')}`;
  });
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = q.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
