import crypto from 'node:crypto';
import { q, insert, type Row } from '../db/index.ts';
import type { Actor, Role } from '../lib/context.ts';

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const SESSION_DAYS = 14;

export function login(email: string, password: string) {
  const user = q.get<Row>('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1', email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  insert('sessions', { token, user_id: user.id, expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() });
  return { token, user: publicUser(user) };
}

export function logout(token: string) {
  q.run('DELETE FROM sessions WHERE token = ?', token);
}

export function actorFromToken(token: string | undefined): Actor | null {
  if (!token) return null;
  const row = q.get<Row>(
    `SELECT u.*, e.id AS engineer_id FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN engineers e ON e.user_id = u.id WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token,
    new Date().toISOString(),
  );
  if (!row) return null;
  return { userId: row.id, name: row.name, role: row.role as Role, engineerId: row.engineer_id ?? null };
}

export function publicUser(u: Row) {
  const eng = q.get<Row>('SELECT id FROM engineers WHERE user_id = ?', u.id);
  return { id: u.id, name: u.name, email: u.email, role: u.role, job_title: u.job_title, engineer_id: eng?.id ?? null };
}

export function demoUsers() {
  return q.all<Row>('SELECT id, name, email, role, job_title FROM users WHERE active = 1 ORDER BY CASE role WHEN \'coordinator\' THEN 0 WHEN \'manager\' THEN 1 WHEN \'engineer\' THEN 2 WHEN \'sales\' THEN 3 ELSE 4 END, name');
}
