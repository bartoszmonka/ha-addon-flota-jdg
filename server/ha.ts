/**
 * Integracja z Home Assistant – tylko ODCZYT danych pojazdów.
 *
 * Pojazd w HA rozpoznajemy po prefiksie encji (np. „audi”, „land_rover”):
 *   input_text.<prefix>_numer_rejestracyjny, input_text.<prefix>_vin,
 *   input_datetime.<prefix>_data_pierwszej_rejestracji / _data_zakupu /
 *   _przeglad_techniczny_do / _ubezpieczenie_do / _nastepny_serwis_aso,
 *   sensor.<prefix>_*_mileage (przebieg z integracji samochodu).
 * Pojedyncze encje można nadpisać zmienną HA_ENTITY_OVERRIDES (JSON), np.
 *   {"audi":{"odometer":"sensor.audi_q4_mileage"}}
 */
import express from 'express';
import type { SessionUser } from './auth.ts';

const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const OVERRIDES: Record<string, Record<string, string>> = (() => {
  try {
    return JSON.parse(process.env.HA_ENTITY_OVERRIDES || '{}');
  } catch {
    return {};
  }
})();
/** Prefiksy pojazdów, które mają być widoczne w aplikacji (puste = wszystkie znalezione) */
const ONLY = (process.env.HA_VEHICLE_PREFIXES || '').split(',').map((s) => s.trim()).filter(Boolean);

interface HaState {
  entity_id: string;
  state: string;
  last_updated: string;
  attributes: Record<string, any>;
}

let cache: { at: number; states: HaState[] } | null = null;

async function fetchStates(): Promise<HaState[]> {
  if (cache && Date.now() - cache.at < 20_000) return cache.states;
  if (!HA_URL || !HA_TOKEN) throw new Error('Brak HA_URL / HA_TOKEN w konfiguracji serwera.');
  const res = await fetch(`${HA_URL}/api/states`, { headers: { authorization: `Bearer ${HA_TOKEN}` } });
  if (!res.ok) throw new Error(`Home Assistant odpowiedział ${res.status}.`);
  const states = (await res.json()) as HaState[];
  cache = { at: Date.now(), states };
  return states;
}

const valid = (s?: HaState) => (s && s.state !== 'unknown' && s.state !== 'unavailable' && s.state !== '' ? s.state : undefined);

export interface HaVehicleLive {
  prefix: string;
  name: string;
  plate?: string;
  vin?: string;
  firstRegistration?: string; // YYYY-MM-DD
  purchaseDate?: string;
  inspectionUntil?: string;
  insuranceUntil?: string;
  asoNext?: string;
  odometerKm?: number;
  odometerUpdatedAt?: string;
}

function vehicleFrom(states: Map<string, HaState>, prefix: string): HaVehicleLive {
  const o = OVERRIDES[prefix] || {};
  const get = (key: string, fallback: string) => states.get(o[key] || fallback);
  const plate = get('plate', `input_text.${prefix}_numer_rejestracyjny`);
  const odoEntity =
    states.get(o.odometer || '') ||
    [...states.values()].find((s) => s.entity_id.startsWith(`sensor.${prefix}_`) && /_(mileage|odometer)$/.test(s.entity_id));
  const km = odoEntity ? Number(valid(odoEntity)) : NaN;
  const nameRaw = plate?.attributes.friendly_name as string | undefined;
  return {
    prefix,
    name: (nameRaw ? nameRaw.replace(/\s*numer rejestracyjny\s*$/i, '') : prefix).trim(),
    plate: valid(plate),
    vin: valid(get('vin', `input_text.${prefix}_vin`)),
    firstRegistration: valid(get('firstRegistration', `input_datetime.${prefix}_data_pierwszej_rejestracji`)),
    purchaseDate: valid(get('purchaseDate', `input_datetime.${prefix}_data_zakupu`)),
    inspectionUntil: valid(get('inspection', `input_datetime.${prefix}_przeglad_techniczny_do`)),
    insuranceUntil: valid(get('insurance', `input_datetime.${prefix}_ubezpieczenie_do`)),
    asoNext: valid(get('aso', `input_datetime.${prefix}_nastepny_serwis_aso`)),
    odometerKm: Number.isFinite(km) ? Math.round(km) : undefined,
    odometerUpdatedAt: odoEntity?.last_updated,
  };
}

async function allVehicles(): Promise<HaVehicleLive[]> {
  const states = new Map((await fetchStates()).map((s) => [s.entity_id, s]));
  const prefixes = new Set<string>();
  for (const id of states.keys()) {
    const m = id.match(/^input_text\.(.+)_numer_rejestracyjny$/);
    if (m) prefixes.add(m[1]);
  }
  return [...prefixes].filter((p) => !ONLY.length || ONLY.includes(p)).sort().map((p) => vehicleFrom(states, p));
}

export function haRouter(requireUser: (req: express.Request, res: express.Response) => SessionUser | null) {
  const r = express.Router();

  r.get('/status', (req, res) => {
    if (!requireUser(req, res)) return;
    res.json({ configured: Boolean(HA_URL && HA_TOKEN) });
  });

  /** Samochody znalezione w HA (kandydaci do importu) */
  r.get('/vehicles', async (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      res.json({ vehicles: await allVehicles() });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  /** Bieżące dane jednego samochodu */
  r.get('/vehicle/:prefix', async (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      const prefix = String(req.params.prefix);
      if (!/^[a-z0-9_]+$/.test(prefix)) return res.status(400).json({ error: 'Niepoprawny prefiks.' });
      const states = new Map((await fetchStates()).map((s) => [s.entity_id, s]));
      if (!states.has(`input_text.${prefix}_numer_rejestracyjny`) && !OVERRIDES[prefix]?.plate) {
        return res.status(404).json({ error: 'Nie znaleziono pojazdu w Home Assistant.' });
      }
      res.json({ vehicle: vehicleFrom(states, prefix) });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  return r;
}
