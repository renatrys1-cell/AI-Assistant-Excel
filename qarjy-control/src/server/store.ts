/**
 * DEMO persistence: бүкіл база браузердің localStorage-ында сақталады.
 * Бұл production қауіпсіздігі емес — шифрлау, бэкап және серверлік оқшаулау жоқ.
 */
import type { Db } from '../domain/types';
import { buildSeed, DB_VERSION } from '../domain/seed';

const KEY = 'qarjy-control:db';
const SESSION_KEY = 'qarjy-control:session';

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const k = '__qc_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export function loadDb(): Db {
  const s = storage();
  if (s) {
    try {
      const raw = s.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw) as Db;
        if (db.version === DB_VERSION) return db;
      }
    } catch {
      /* бүлінген дерек — қайта жасаймыз */
    }
  }
  const db = buildSeed();
  saveDb(db);
  return db;
}

export function saveDb(db: Db): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

export function resetDb(): Db {
  const db = buildSeed();
  saveDb(db);
  return db;
}

export interface Session {
  userId: string | null;
  tenantId: string | null;
  branchId: string | null;
  periodKey: string;
  lang: 'kk' | 'ru';
  density: 'comfortable' | 'compact';
}

export function loadSession(): Session {
  const def: Session = { userId: null, tenantId: null, branchId: null, periodKey: 'month:2026-09', lang: 'kk', density: 'comfortable' };
  const s = storage();
  if (!s) return def;
  try {
    return { ...def, ...(JSON.parse(s.getItem(SESSION_KEY) ?? '{}') as Partial<Session>) };
  } catch {
    return def;
  }
}

export function saveSession(sess: Session) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SESSION_KEY, JSON.stringify(sess));
  } catch {
    /* ignore */
  }
}

export function isPersistent(): boolean {
  return storage() !== null;
}
