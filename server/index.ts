import { ADDON, ingressUser } from './addon.ts'; // pierwszy: ustawia zmienne środowiskowe dla trybu dodatku
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { applyBatch, getDoc, importDocs, listCollection, RuleError, splitPath } from './store.ts';
import type { WriteOp } from './store.ts';
import { authConfigured, authorizeUrl, consumeState, devMode, dropSession, loginWithCode, newSession, sessionUser } from './auth.ts';
import type { SessionUser } from './auth.ts';
import { haRouter } from './ha.ts';
import { startTripTracker, tripsRouter } from './trips.ts';

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

function appUrl(req: express.Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// --- Zmiany w kolekcjach (long-poll dla „na żywo”) -------------------------------------------------
let seq = 0;
const changes: { seq: number; uid: string; col: string }[] = [];
const waiters: { uid: string; since: number; res: express.Response; timer: NodeJS.Timeout }[] = [];

function publish(uid: string, cols: string[]) {
  for (const col of cols) changes.push({ seq: ++seq, uid, col });
  if (changes.length > 2000) changes.splice(0, changes.length - 1000);
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (w.uid !== uid) continue;
    clearTimeout(w.timer);
    waiters.splice(i, 1);
    w.res.json({ seq, cols: [...new Set(changes.filter((c) => c.seq > w.since && c.uid === uid).map((c) => c.col))] });
  }
}

// --- Logowanie -------------------------------------------------------------------------------------------
app.get('/auth/login', (req, res) => {
  if (ADDON) return res.status(404).send('Logowanie odbywa się przez Home Assistant (ingress).');
  if (devMode) {
    const token = newSession({ uid: 'dev-user', name: 'Użytkownik testowy' });
    return res.redirect(`/#session=${token}`);
  }
  if (!authConfigured) return res.status(500).send('Brak konfiguracji HA_URL.');
  res.redirect(authorizeUrl(appUrl(req)));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  if (!code || !state || !consumeState(state)) return res.status(400).send('Nieprawidłowe lub wygasłe żądanie logowania. Wróć i spróbuj ponownie.');
  try {
    const user = await loginWithCode(code, appUrl(req));
    res.redirect(`/#session=${newSession(user)}`);
  } catch (e) {
    res.status(403).send(`Logowanie nie powiodło się: ${(e as Error).message}`);
  }
});

function bearer(req: express.Request): string | undefined {
  const h = req.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

function requireUser(req: express.Request, res: express.Response): SessionUser | null {
  const u = ADDON ? ingressUser(req) : sessionUser(bearer(req));
  if (!u) res.status(401).json({ error: ADDON ? 'Otwórz aplikację z panelu Home Assistanta.' : 'Niezalogowany.' });
  return u;
}

app.get('/api/me', (req, res) => {
  const u = requireUser(req, res);
  if (u) res.json({ ...u, devMode });
});

app.post('/api/logout', (req, res) => {
  const t = bearer(req);
  if (t) dropSession(t);
  res.json({ ok: true });
});

// --- Dokumenty -------------------------------------------------------------------------------------------
function ownPath(u: SessionUser, p: unknown): string | null {
  const s = String(p || '');
  const { parts } = splitPath(s);
  return parts[0] === 'users' && parts[1] === u.uid ? parts.join('/') : null;
}

app.get('/api/doc', (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  const p = ownPath(u, req.query.path);
  if (!p) return res.status(403).json({ error: 'Brak dostępu.' });
  res.json({ data: getDoc(p) });
});

app.get('/api/col', (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  const p = ownPath(u, req.query.path);
  if (!p) return res.status(403).json({ error: 'Brak dostępu.' });
  res.json({ docs: listCollection(p), seq });
});

app.post('/api/batch', (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  const ops = (req.body?.ops || []) as WriteOp[];
  try {
    for (const op of ops) if (!ownPath(u, op.path)) throw new RuleError('Brak uprawnień do tej ścieżki.');
    const cols = applyBatch(u.uid, ops);
    publish(u.uid, cols);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/import', (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  try {
    const docs = (req.body?.docs || []) as { path: string; data: unknown }[];
    const r = importDocs(u.uid, docs as { path: string; data: any }[]);
    publish(u.uid, r.cols);
    res.json({ ok: true, written: r.written });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/poll', (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  const since = Number(req.query.since || 0);
  const pending = changes.filter((c) => c.seq > since && c.uid === u.uid);
  if (pending.length || since > seq) return res.json({ seq, cols: [...new Set(pending.map((c) => c.col))] });
  const w = {
    uid: u.uid,
    since,
    res,
    timer: setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      res.json({ seq, cols: [] });
    }, 25_000),
  };
  waiters.push(w);
  req.on('close', () => {
    clearTimeout(w.timer);
    const i = waiters.indexOf(w);
    if (i >= 0) waiters.splice(i, 1);
  });
});

app.use('/api/ha', haRouter(requireUser));
app.use('/api/trips', tripsRouter(requireUser));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Nie znaleziono.' }));

// --- Frontend --------------------------------------------------------------------------------------------
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

startTripTracker();
app.listen(PORT, '0.0.0.0', () => console.log(`Flota JDG nasłuchuje na :${PORT} (auth: ${ADDON ? 'ingress Home Assistanta' : devMode ? 'DEV' : authConfigured ? 'Home Assistant' : 'brak konfiguracji'})`));
