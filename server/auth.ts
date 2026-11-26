/**
 * Logowanie przez Home Assistant (IndieAuth / OAuth z `auth/authorize`).
 * Serwer wymienia kod na token u HA, pyta przez WebSocket „kim jest użytkownik” (auth/current_user),
 * odwołuje token HA (niepotrzebny) i wystawia własną sesję.
 */
import crypto from 'node:crypto';
import { db } from './store.ts';

export interface SessionUser {
  uid: string;
  name: string;
}

const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_PUBLIC_URL = (process.env.HA_PUBLIC_URL || HA_URL).replace(/\/$/, '');
const ALLOWED = (process.env.ALLOWED_HA_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const authConfigured = Boolean(HA_URL);
export const devMode = process.env.AUTH_MODE === 'dev';

const pendingStates = new Map<string, number>();

export function newSession(user: SessionUser): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, uid, name, created_at) VALUES(?,?,?,?)').run(token, user.uid, user.name, new Date().toISOString());
  return token;
}

export function sessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare('SELECT uid, name FROM sessions WHERE token = ?').get(token) as SessionUser | undefined;
  return row || null;
}

export function dropSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

const HA_LAN_URL = (process.env.HA_LAN_URL || HA_URL).replace(/\/$/, '');

/** Adres HA widoczny dla przeglądarki: z sieci domowej → HA_LAN_URL, spoza (np. Tailscale) → HA_PUBLIC_URL. */
export function haPublicFor(appUrl: string): string {
  let host = '';
  try { host = new URL(appUrl).hostname; } catch { /* ignore */ }
  const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(host) || host.endsWith('.local') || host === 'localhost';
  return lan ? HA_LAN_URL : HA_PUBLIC_URL;
}

export function authorizeUrl(appUrl: string): string {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60_000);
  for (const [s, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(s);
  const q = new URLSearchParams({ client_id: `${appUrl}/`, redirect_uri: `${appUrl}/auth/callback`, state });
  return `${haPublicFor(appUrl)}/auth/authorize?${q}`;
}

export function consumeState(state: string): boolean {
  const ok = (pendingStates.get(state) || 0) > Date.now();
  pendingStates.delete(state);
  return ok;
}

async function haCurrentUser(accessToken: string): Promise<{ id: string; name: string }> {
  const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Home Assistant nie odpowiada.'));
    }, 10_000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
      else if (msg.type === 'auth_invalid') {
        clearTimeout(timer);
        reject(new Error('HA odrzucił token.'));
      } else if (msg.type === 'result' && msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        msg.success ? resolve(msg.result) : reject(new Error('Nie udało się odczytać użytkownika HA.'));
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Brak połączenia z Home Assistant.'));
    };
  });
}

/** Wymienia kod autoryzacyjny na użytkownika HA */
export async function loginWithCode(code: string, appUrl: string): Promise<SessionUser> {
  const res = await fetch(`${HA_URL}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: `${appUrl}/` }),
  });
  if (!res.ok) throw new Error(`HA odrzucił kod logowania (${res.status}).`);
  const tok = (await res.json()) as { access_token: string; refresh_token?: string };
  try {
    const u = await haCurrentUser(tok.access_token);
    if (ALLOWED.length && !ALLOWED.includes(u.name.toLowerCase()) && !ALLOWED.includes(u.id.toLowerCase())) {
      throw new Error('To konto HA nie ma dostępu do Flota JDG.');
    }
    return { uid: u.id, name: u.name };
  } finally {
    if (tok.refresh_token) {
      fetch(`${HA_URL}/auth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tok.refresh_token, action: 'revoke' }),
      }).catch(() => undefined);
    }
  }
}
