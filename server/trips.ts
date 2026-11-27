/**
 * Automatyczne wykrywanie przejazdów z Home Assistanta.
 *
 * Co 30 s czytamy stan auta (device_tracker z GPS, binary_sensor *_is_moving, przebieg):
 *  - wyjazd = auto przestaje być w strefie „home” → zapamiętujemy przebieg z chwili wyjazdu,
 *  - pierwszy postój poza domem (is_moving = off, > 300 m od domu) = cel przejazdu (kolejne punkty ignorujemy),
 *  - powrót = auto znów w strefie „home” → po odświeżeniu przebiegu powstaje przejazd „do zatwierdzenia”:
 *    data, trasa „dom – cel – dom” i km. Użytkownik uzupełnia tylko cel wyjazdu i zatwierdza lub odrzuca.
 * Przejazdy zapisujemy w tabeli docs pod ścieżką system/trips/<prefiks>/<id> (stan automatu: system/trips_state/<prefiks>).
 */
import express from 'express';
import { db, getDoc, listCollection } from './store.ts';
import type { SessionUser } from './auth.ts';

const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const PREFIXES = (process.env.HA_VEHICLE_PREFIXES || '').split(',').map((s) => s.trim()).filter(Boolean);
const HOME_LABEL = process.env.TRIP_HOME_LABEL || 'Gruszowa 36, Wrocław';
const POLL_MS = 30_000;
const STOP_MIN_DIST_M = 300;
const WAIT_ODOMETER_MS = 20 * 60_000;
const MIN_TRIP_KM = 1;

interface HaState {
  entity_id: string;
  state: string;
  last_updated: string;
  last_changed: string;
  attributes: Record<string, any>;
}
interface Point {
  lat: number;
  lon: number;
}
interface TripState {
  phase: 'home' | 'away' | 'returning';
  lastOdoHome?: number;
  startedAt?: string;
  odoStart?: number;
  dest?: Point;
  far?: Point & { dist: number };
  arrivedAt?: string;
}
export interface PendingTrip {
  id: string;
  prefix: string;
  status: 'pending' | 'approved' | 'rejected';
  date: string; // DD.MM.RRRR
  startedAt: string;
  endedAt: string;
  odometerStart: number;
  odometerEnd: number;
  distanceKm: number;
  routeDescription: string;
  createdAt: string;
}

const stmtPut = db.prepare('INSERT INTO docs(path, parent, id, data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data = excluded.data');
const put = (parent: string, id: string, data: unknown) => stmtPut.run(`${parent}/${id}`, parent, id, JSON.stringify(data));

const num = (s?: HaState) => {
  const n = s && s.state !== 'unknown' && s.state !== 'unavailable' ? Number(s.state) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function haversineM(a: Point, b: Point): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function datePl(iso: string): string {
  const parts = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('day')}.${g('month')}.${g('year')}`;
}

async function reverseGeocode(p: Point): Promise<string> {
  const fallback = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${p.lat}&lon=${p.lon}`,
      { headers: { 'user-agent': 'flota-jdg-addon (ewidencja przebiegu)', 'accept-language': 'pl' }, signal: ctl.signal }
    );
    clearTimeout(t);
    if (!res.ok) return fallback;
    const a = ((await res.json()) as any).address || {};
    const street = a.road || a.pedestrian || a.footway || a.suburb;
    const city = a.city || a.town || a.village || a.municipality;
    if (!street && !city) return fallback;
    return [street && a.house_number ? `${street} ${a.house_number}` : street, city].filter(Boolean).join(', ');
  } catch {
    return fallback;
  }
}

async function fetchStates(): Promise<HaState[]> {
  const res = await fetch(`${HA_URL}/api/states`, { headers: { authorization: `Bearer ${HA_TOKEN}` } });
  if (!res.ok) throw new Error(`Home Assistant odpowiedział ${res.status}.`);
  return (await res.json()) as HaState[];
}

export async function tick(prefix: string) {
  const states = await fetchStates();
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const tracker =
    states.find((s) => s.entity_id.startsWith(`device_tracker.${prefix}_`) && /position/.test(s.entity_id) && s.attributes.latitude != null) ||
    states.find((s) => s.entity_id.startsWith(`device_tracker.${prefix}_`) && s.attributes.latitude != null);
  const odoEntity = states.find((s) => s.entity_id.startsWith(`sensor.${prefix}_`) && /_(mileage|odometer)$/.test(s.entity_id));
  const moving = states.find((s) => s.entity_id.startsWith(`binary_sensor.${prefix}_`) && /_is_moving$/.test(s.entity_id));
  const zone = byId.get('zone.home');
  if (!tracker || !odoEntity || !zone || tracker.state === 'unknown' || tracker.state === 'unavailable') return;
  const odo = num(odoEntity);
  if (odo === undefined) return;
  const home: Point = { lat: Number(zone.attributes.latitude), lon: Number(zone.attributes.longitude) };
  const pos: Point = { lat: Number(tracker.attributes.latitude), lon: Number(tracker.attributes.longitude) };
  const atHome = tracker.state === 'home';
  const stateDoc = 'system/trips_state';
  let st: TripState = getDoc(`${stateDoc}/${prefix}`) || { phase: 'home' };
  const before = JSON.stringify(st);

  if (st.phase === 'home') {
    if (atHome) st.lastOdoHome = odo;
    else {
      st = { phase: 'away', startedAt: tracker.last_changed, odoStart: st.lastOdoHome ?? odo };
    }
  }
  if (st.phase === 'away') {
    const dist = haversineM(home, pos);
    if (!st.far || dist > st.far.dist) st.far = { ...pos, dist };
    if (!st.dest && moving?.state === 'off' && dist > STOP_MIN_DIST_M) st.dest = pos;
    if (atHome) st = { ...st, phase: 'returning', arrivedAt: new Date().toISOString() };
  }
  if (st.phase === 'returning') {
    const arrived = Date.parse(st.arrivedAt || '') || Date.now();
    const fresh = Date.parse(odoEntity.last_updated) > arrived;
    if (!atHome) {
      // wyjechał ponownie, zanim przebieg się odświeżył – traktujemy jako ciąg dalszy tego samego przejazdu
      st.phase = 'away';
      delete st.arrivedAt;
    } else if (fresh || Date.now() - arrived > WAIT_ODOMETER_MS) {
      const km = odo - (st.odoStart ?? odo);
      if (km >= MIN_TRIP_KM && st.startedAt) {
        const target = st.dest || st.far;
        const where = target ? await reverseGeocode(target) : 'miejsce docelowe';
        const id = `trip_${Date.parse(st.startedAt).toString(36)}`;
        const trip: PendingTrip = {
          id,
          prefix,
          status: 'pending',
          date: datePl(st.startedAt),
          startedAt: st.startedAt,
          endedAt: new Date().toISOString(),
          odometerStart: Math.round(st.odoStart ?? odo),
          odometerEnd: Math.round(odo),
          distanceKm: Math.round(km),
          routeDescription: `${HOME_LABEL} – ${where} – ${HOME_LABEL}`,
          createdAt: new Date().toISOString(),
        };
        if (!getDoc(`system/trips/${prefix}/${id}`)) put(`system/trips/${prefix}`, id, trip);
        console.log(`[trips] ${prefix}: nowy przejazd ${trip.date}, ${trip.distanceKm} km → ${where}`);
      }
      st = { phase: 'home', lastOdoHome: odo };
    }
  }
  if (JSON.stringify(st) !== before) put(stateDoc, prefix, st);
}

export function startTripTracker() {
  if (!HA_URL || !HA_TOKEN || !PREFIXES.length) return;
  const run = () => PREFIXES.forEach((p) => tick(p).catch((e) => console.warn(`[trips] ${p}:`, (e as Error).message)));
  setTimeout(run, 5000);
  setInterval(run, POLL_MS);
  console.log(`[trips] śledzenie przejazdów włączone: ${PREFIXES.join(', ')}`);
}

export function tripsRouter(requireUser: (req: express.Request, res: express.Response) => SessionUser | null) {
  const r = express.Router();
  const okPrefix = (p: string) => /^[a-z0-9_]+$/.test(p);

  /** Przejazdy czekające na zatwierdzenie */
  r.get('/:prefix', (req, res) => {
    if (!requireUser(req, res)) return;
    const prefix = String(req.params.prefix);
    if (!okPrefix(prefix)) return res.status(400).json({ error: 'Niepoprawny prefiks.' });
    const trips = listCollection(`system/trips/${prefix}`)
      .map((d) => d.data as PendingTrip)
      .filter((t) => t.status === 'pending')
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    res.json({ trips });
  });

  /** Oznaczenie przejazdu jako zatwierdzony (wpis w ewidencji tworzy aplikacja) lub odrzucony */
  r.post('/:prefix/:id', (req, res) => {
    if (!requireUser(req, res)) return;
    const prefix = String(req.params.prefix);
    const id = String(req.params.id);
    const status = req.body?.status;
    if (!okPrefix(prefix) || !/^[a-z0-9_]+$/.test(id) || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Niepoprawne żądanie.' });
    const trip = getDoc(`system/trips/${prefix}/${id}`) as PendingTrip | null;
    if (!trip) return res.status(404).json({ error: 'Nie znaleziono przejazdu.' });
    put(`system/trips/${prefix}`, id, { ...trip, status });
    res.json({ ok: true });
  });

  return r;
}
