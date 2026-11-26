/**
 * Magazyn dokumentów (SQLite) o strukturze zgodnej z dawnym Firestore:
 *   users/{uid}/vehicles/{vid}/entries/{id} itd.
 * Reguły bezpieczeństwa z firestore.rules (blokada zamkniętych miesięcy) są odtworzone w `checkRules`.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

type Json = any;

export type WriteOp =
  | { type: 'set'; path: string; data: Json; merge?: boolean; mergeFields?: string[] }
  | { type: 'update'; path: string; data: Json }
  | { type: 'delete'; path: string };

export class RuleError extends Error {
  status = 403;
}

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'flota.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const stmtGet = db.prepare('SELECT data FROM docs WHERE path = ?');
const stmtList = db.prepare('SELECT id, data FROM docs WHERE parent = ?');
const stmtPut = db.prepare(
  'INSERT INTO docs(path, parent, id, data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data = excluded.data'
);
const stmtDel = db.prepare('DELETE FROM docs WHERE path = ?');

export function splitPath(p: string) {
  const parts = p.split('/').filter(Boolean);
  return { parts, id: parts[parts.length - 1], parent: parts.slice(0, -1).join('/') };
}

export function getDoc(p: string): Json | null {
  const row = stmtGet.get(p) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function listCollection(p: string): { id: string; data: Json }[] {
  return (stmtList.all(p) as { id: string; data: string }[]).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
}

// --- Sentinele z klienta: arrayUnion / increment / deleteField --------------------------------
const isObj = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
const eq = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

function resolveValue(prev: Json, v: Json): Json {
  if (isObj(v) && typeof v.__op === 'string') {
    if (v.__op === 'arrayUnion') {
      const base: Json[] = Array.isArray(prev) ? [...prev] : [];
      for (const item of v.values as Json[]) if (!base.some((x) => eq(x, item))) base.push(item);
      return base;
    }
    if (v.__op === 'increment') return (typeof prev === 'number' ? prev : 0) + Number(v.n);
    if (v.__op === 'delete') return undefined;
  }
  return v;
}

function applyFields(base: Record<string, Json>, data: Record<string, Json>, deep: boolean): Record<string, Json> {
  const out = { ...base };
  for (const [k, v] of Object.entries(data)) {
    const r = resolveValue(out[k], v);
    if (r === undefined) delete out[k];
    else if (deep && isObj(r) && isObj(out[k]) && !(typeof (v as Json).__op === 'string')) out[k] = applyFields(out[k], r, true);
    else out[k] = stripOps(r);
  }
  return out;
}

function stripOps(v: Json): Json {
  if (Array.isArray(v)) return v.map(stripOps);
  if (isObj(v)) {
    const o: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = stripOps(resolveValue(undefined, x));
    return o;
  }
  return v;
}

// --- Reguły (odpowiednik firestore.rules) --------------------------------------------------------
const DATE_RE = /^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$/;
const MONTH_RE = /^[0-9]{4}-[0-9]{2}$/;

function validEntry(d: Json): boolean {
  return (
    typeof d.date === 'string' && DATE_RE.test(d.date) &&
    typeof d.monthKey === 'string' && MONTH_RE.test(d.monthKey) &&
    typeof d.odometerEnd === 'number' && d.odometerEnd >= 0 &&
    (d.odometerStartOverride == null || (typeof d.odometerStartOverride === 'number' && d.odometerStartOverride >= 0)) &&
    typeof d.routeDescription === 'string' && d.routeDescription.length <= 500 &&
    typeof d.purposeDescription === 'string' && d.purposeDescription.length <= 500
  );
}

function affectedKeys(a: Json, b: Json): string[] {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => !eq(a?.[k], b?.[k]));
}

/** Miesiąc jest otwarty, jeśli nie ma dokumentu zamknięcia albo isClosed != true (stan sprzed partii) */
function monthOpen(vehiclePath: string, monthKey: string): boolean {
  const m = getDoc(`${vehiclePath}/months/${monthKey}`);
  return !m || m.isClosed !== true;
}

function checkRules(uid: string, op: WriteOp, before: Json | null, after: Json | null) {
  const { parts } = splitPath(op.path);
  if (parts[0] !== 'users' || parts[1] !== uid) throw new RuleError('Brak uprawnień do tej ścieżki.');
  // users/{uid}/vehicles/{vid}/entries/{id}
  if (parts.length === 6 && parts[2] === 'vehicles' && parts[4] === 'entries') {
    const vehiclePath = parts.slice(0, 4).join('/');
    const deny = (why: string) => {
      throw new RuleError(`Brak uprawnień: ${why}`);
    };
    if (op.type === 'delete') {
      if (before && !monthOpen(vehiclePath, before.monthKey)) deny('miesiąc jest zamknięty.');
      return;
    }
    if (!after) return;
    if (!before) {
      if (!validEntry(after)) deny('niepoprawny wpis.');
      if (!monthOpen(vehiclePath, after.monthKey)) deny('miesiąc jest zamknięty.');
      return;
    }
    const keys = affectedKeys(before, after);
    const shiftOnly = keys.every((k) => ['odometerEnd', 'updatedAt', 'correction'].includes(k)) && typeof after.odometerEnd === 'number' && after.odometerEnd >= 0;
    const attachOnly = keys.every((k) => ['attachments', 'updatedAt'].includes(k));
    if (shiftOnly || attachOnly) return;
    if (validEntry(after) && monthOpen(vehiclePath, before.monthKey) && monthOpen(vehiclePath, after.monthKey)) return;
    deny('miesiąc jest zamknięty lub wpis jest niepoprawny.');
  }
  // fragmenty plików
  if (parts.length === 8 && parts[4] === 'files' && parts[6] === 'chunks' && op.type !== 'delete') {
    if (!(typeof after?.data === 'string' && after.data.length <= 800000)) throw new RuleError('Fragment pliku za duży.');
  }
}

/** Wykonuje partię operacji atomowo. Zwraca ścieżki kolekcji, które się zmieniły. */
export function applyBatch(uid: string, ops: WriteOp[]): string[] {
  const touched = new Set<string>();
  // Reguły sprawdzamy względem stanu sprzed partii (jak w Firestore) – najpierw wyliczamy wyniki.
  const planned: { op: WriteOp; before: Json | null; after: Json | null }[] = [];
  const shadow = new Map<string, Json | null>();
  const readShadow = (p: string) => (shadow.has(p) ? shadow.get(p)! : getDoc(p));
  for (const op of ops) {
    splitPath(op.path); // walidacja
    const live = readShadow(op.path);
    let after: Json | null;
    if (op.type === 'delete') after = null;
    else if (op.type === 'update') {
      if (!live) throw Object.assign(new Error(`Dokument nie istnieje: ${op.path}`), { status: 404 });
      after = applyFields(live, op.data, false);
    } else if (op.mergeFields?.length) {
      const base = live || {};
      const sub: Record<string, Json> = {};
      for (const f of op.mergeFields) if (f in op.data) sub[f] = op.data[f];
      after = applyFields(base, sub, false);
    } else if (op.merge) after = applyFields(live || {}, op.data, true);
    else after = applyFields({}, op.data, false);
    planned.push({ op, before: getDoc(op.path), after });
    shadow.set(op.path, after);
  }
  for (const p of planned) checkRules(uid, p.op, p.before, p.after);
  db.exec('BEGIN');
  try {
    for (const { op, after } of planned) {
      const { id, parent } = splitPath(op.path);
      if (after === null) stmtDel.run(op.path);
      else stmtPut.run(op.path, parent, id, JSON.stringify(after));
      touched.add(parent);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return [...touched];
}

export function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Import kopii zapasowej (np. eksport z wersji w AI Studio): zapisuje dokumenty bez sprawdzania reguł
 * (kopia zawiera także zamknięte miesiące). Ścieżki users/{staryUid}/… są przepisywane na bieżącego użytkownika.
 */
export function importDocs(uid: string, docs: { path: string; data: Json }[]): { written: number; cols: string[] } {
  const cols = new Set<string>();
  let written = 0;
  inTransaction(() => {
    for (const d of docs) {
      const parts = splitPath(String(d.path));
      if (parts.parts[0] !== 'users' || parts.parts.length < 2 || !isObj(d.data)) continue;
      parts.parts[1] = uid;
      const p = parts.parts.join('/');
      const { id, parent } = splitPath(p);
      stmtPut.run(p, parent, id, JSON.stringify(d.data));
      cols.add(parent);
      written++;
    }
  });
  return { written, cols: [...cols] };
}
