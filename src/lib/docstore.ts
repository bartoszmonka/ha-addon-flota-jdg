/**
 * Klient magazynu dokumentów – zastępuje Firestore (te same nazwy funkcji: doc, collection,
 * setDoc, getDocs, onSnapshot, writeBatch…), ale rozmawia z własnym serwerem (/api).
 * Dzięki temu logika aplikacji (FleetContext, załączniki) zostaje bez zmian.
 */

const SESSION_KEY = 'flota_session';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function setSessionToken(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* brak localStorage – sesja tylko do odświeżenia */
    memToken = token;
  }
}
let memToken: string | null = null;

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSessionToken() || memToken;
  // ścieżka względna: pod ingress Home Assistanta aplikacja nie jest w korzeniu domeny
  const res = await fetch(path.replace(/^\//, ''), {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) {
    setSessionToken(null);
    window.dispatchEvent(new Event('flota-unauthorized'));
  }
  if (!res.ok) {
    let msg = `Błąd serwera (${res.status})`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

// --- Referencje ---------------------------------------------------------------------------------------
export const db = { __db: true } as const;
type Base = typeof db | DocumentReference | CollectionReference;
export interface DocumentReference {
  kind: 'doc';
  path: string;
  id: string;
}
export interface CollectionReference {
  kind: 'col';
  path: string;
  id: string;
}

const join = (base: Base, segs: string[]) =>
  [('path' in base ? base.path : ''), ...segs].filter(Boolean).join('/');

export function doc(base: Base | CollectionReference, ...segs: string[]): DocumentReference {
  const path = join(base, segs);
  return { kind: 'doc', path, id: path.split('/').pop()! };
}
export function collection(base: Base, ...segs: string[]): CollectionReference {
  const path = join(base, segs);
  return { kind: 'col', path, id: path.split('/').pop()! };
}

export interface DocumentSnapshot<T = any> {
  id: string;
  ref: DocumentReference;
  exists(): boolean;
  data(): T;
}
export interface QuerySnapshot<T = any> {
  docs: DocumentSnapshot<T>[];
  empty: boolean;
  size: number;
}

const snapOf = (path: string, data: any | null): DocumentSnapshot => ({
  id: path.split('/').pop()!,
  ref: { kind: 'doc', path, id: path.split('/').pop()! },
  exists: () => data !== null && data !== undefined,
  data: () => data,
});

// --- Sentinele ----------------------------------------------------------------------------------------
export const arrayUnion = (...values: any[]) => ({ __op: 'arrayUnion', values });
export const increment = (n: number) => ({ __op: 'increment', n });
export const deleteField = () => ({ __op: 'delete' });

// --- Zapis --------------------------------------------------------------------------------------------
interface SetOptions {
  merge?: boolean;
  mergeFields?: string[];
}
type Op =
  | { type: 'set'; path: string; data: any; merge?: boolean; mergeFields?: string[] }
  | { type: 'update'; path: string; data: any }
  | { type: 'delete'; path: string };

async function commit(ops: Op[]) {
  if (!ops.length) return;
  // JSON.stringify pomija undefined (jak ignoreUndefinedProperties w Firestore)
  await api('/api/batch', { method: 'POST', body: JSON.stringify({ ops }) });
  const cols = new Set(ops.map((o) => o.path.split('/').slice(0, -1).join('/')));
  cols.forEach((c) => notify(c));
}

export const setDoc = (ref: DocumentReference, data: any, options?: SetOptions) =>
  commit([{ type: 'set', path: ref.path, data, merge: options?.merge, mergeFields: options?.mergeFields }]);
export const updateDoc = (ref: DocumentReference, data: any) => commit([{ type: 'update', path: ref.path, data }]);
export const deleteDoc = (ref: DocumentReference) => commit([{ type: 'delete', path: ref.path }]);

export function writeBatch(_db?: unknown) {
  const ops: Op[] = [];
  return {
    set(ref: DocumentReference, data: any, options?: SetOptions) {
      ops.push({ type: 'set', path: ref.path, data, merge: options?.merge, mergeFields: options?.mergeFields });
      return this;
    },
    update(ref: DocumentReference, data: any) {
      ops.push({ type: 'update', path: ref.path, data });
      return this;
    },
    delete(ref: DocumentReference) {
      ops.push({ type: 'delete', path: ref.path });
      return this;
    },
    commit: () => commit(ops),
  };
}

// --- Odczyt -------------------------------------------------------------------------------------------
export async function getDocs(col: CollectionReference): Promise<QuerySnapshot> {
  const { docs } = await api<{ docs: { id: string; data: any }[] }>(`/api/col?path=${encodeURIComponent(col.path)}`);
  const list = docs.map((d) => snapOf(`${col.path}/${d.id}`, d.data));
  return { docs: list, empty: list.length === 0, size: list.length };
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const { data } = await api<{ data: any }>(`/api/doc?path=${encodeURIComponent(ref.path)}`);
  return snapOf(ref.path, data);
}

// --- Nasłuch zmian (long-poll) ----------------------------------------------------------------------
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
let pollSeq = -1;
let pollRunning = false;

function notify(colPath: string) {
  listeners.get(colPath)?.forEach((l) => l());
}

async function pollLoop() {
  if (pollRunning) return;
  pollRunning = true;
  let failures = 0;
  while (listeners.size > 0) {
    try {
      const r = await api<{ seq: number; cols: string[] }>(`/api/poll?since=${pollSeq < 0 ? 1e12 : pollSeq}`);
      if (pollSeq < 0) {
        pollSeq = r.seq;
      } else {
        pollSeq = r.seq;
        r.cols.forEach(notify);
      }
      failures = 0;
    } catch {
      failures++;
      await new Promise((res) => setTimeout(res, Math.min(10_000, 1000 * failures)));
      // po utracie połączenia odświeżamy wszystko
      listeners.forEach((_s, c) => notify(c));
    }
  }
  pollRunning = false;
  pollSeq = -1;
}

export function onSnapshot(ref: CollectionReference, next: (snap: QuerySnapshot) => void, error?: (err: Error) => void): () => void;
export function onSnapshot(ref: DocumentReference, next: (snap: DocumentSnapshot) => void, error?: (err: Error) => void): () => void;
export function onSnapshot(
  ref: DocumentReference | CollectionReference,
  next: (snap: any) => void,
  error?: (err: Error) => void
): () => void {
  const colPath = ref.kind === 'col' ? ref.path : ref.path.split('/').slice(0, -1).join('/');
  let active = true;
  let inflight = false;
  let again = false;
  const run = async () => {
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      const snap = ref.kind === 'col' ? await getDocs(ref) : await getDoc(ref);
      if (active) next(snap);
    } catch (e) {
      if (active) error?.(e as Error);
    } finally {
      inflight = false;
      if (again && active) {
        again = false;
        run();
      }
    }
  };
  const l: Listener = () => run();
  if (!listeners.has(colPath)) listeners.set(colPath, new Set());
  listeners.get(colPath)!.add(l);
  run();
  pollLoop();
  return () => {
    active = false;
    const set = listeners.get(colPath);
    set?.delete(l);
    if (set && set.size === 0) listeners.delete(colPath);
  };
}
