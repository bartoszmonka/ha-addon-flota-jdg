import React, { useCallback, useEffect, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { api } from '../../lib/docstore';
import { useFleet } from '../../context/FleetContext';

interface PendingTrip {
  id: string;
  date: string;
  routeDescription: string;
  odometerStart: number;
  odometerEnd: number;
  distanceKm: number;
}

const fmtKm = (n: number) => n.toLocaleString('pl-PL');

/**
 * Przejazdy wykryte automatycznie z Home Assistanta („dymki” nad ewidencją).
 * Data, trasa i km są gotowe – użytkownik wpisuje tylko cel wyjazdu i zatwierdza albo odrzuca.
 * Odrzucenie NIE zmniejsza „nieprzypisanych km”: kilometry nadal trzeba przypisać do wpisów.
 */
export const PendingTrips: React.FC = () => {
  const { activeVehicle, entries, taxpayer, savedPurposes, addMileageEntry } = useFleet();
  const prefix = activeVehicle?.haPrefix;
  const [trips, setTrips] = useState<PendingTrip[]>([]);
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!prefix) return;
    api<{ trips: PendingTrip[] }>(`/api/trips/${encodeURIComponent(prefix)}`)
      .then((r) => setTrips(r.trips))
      .catch((e) => console.warn('Przejazdy do zatwierdzenia:', e));
  }, [prefix]);

  useEffect(() => {
    setTrips([]);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!prefix || !trips.length) return null;

  const mark = (id: string, status: 'approved' | 'rejected') =>
    api(`/api/trips/${encodeURIComponent(prefix)}/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ status }) });

  const approve = async (t: PendingTrip) => {
    const purpose = (purposes[t.id] || '').trim();
    if (!purpose) return;
    setBusyId(t.id);
    setError(null);
    try {
      const valid = entries.filter((e) => !e.odometerConflict);
      const prevEnd = valid.length ? valid[valid.length - 1].odometerEnd : activeVehicle!.initialOdometer;
      await addMileageEntry({
        date: t.date,
        routeDescription: t.routeDescription,
        purposeDescription: purpose,
        driverName: taxpayer.defaultDriverName || '',
        odometerEnd: t.odometerEnd,
        odometerStartOverride: t.odometerStart !== prevEnd ? t.odometerStart : undefined,
        source: 'manual',
      });
      await mark(t.id, 'approved');
      setTrips((l) => l.filter((x) => x.id !== t.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (t: PendingTrip) => {
    setBusyId(t.id);
    setError(null);
    try {
      await mark(t.id, 'rejected');
      setTrips((l) => l.filter((x) => x.id !== t.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-bold flex items-center gap-2">
        <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-brand text-white text-xs">{trips.length}</span>
        Przejazdy do zatwierdzenia
      </div>
      {error && <div className="text-sm text-danger bg-danger-soft rounded-xl p-3 whitespace-pre-line">{error}</div>}
      {trips.map((t) => (
        <div key={t.id} className="card px-4 py-3.5 border-brand flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-start gap-3 min-w-0 lg:flex-1">
            <MapPin className="w-5 h-5 text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-bold">
                {t.date} · <span className="font-num">{fmtKm(t.distanceKm)} km</span>
                <span className="ml-2 text-xs font-num font-medium text-ink-3">
                  licznik {fmtKm(t.odometerStart)} → {fmtKm(t.odometerEnd)}
                </span>
              </div>
              <div className="text-[13px] text-ink-2">{t.routeDescription}</div>
            </div>
          </div>
          <input
            value={purposes[t.id] || ''}
            onChange={(e) => setPurposes((p) => ({ ...p, [t.id]: e.target.value }))}
            list={`purposes-${t.id}`}
            placeholder="Cel wyjazdu…"
            className="lg:w-72 px-3 py-2 rounded-[10px] border border-line text-sm bg-white"
          />
          <datalist id={`purposes-${t.id}`}>
            {savedPurposes.map((p) => (
              <option key={p.id} value={p.title} />
            ))}
          </datalist>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => approve(t)}
              disabled={busyId === t.id || !(purposes[t.id] || '').trim()}
              className="px-3.5 py-2 rounded-[10px] bg-brand hover:bg-brand-hover text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Check className="w-4 h-4" /> Zatwierdź
            </button>
            <button
              onClick={() => reject(t)}
              disabled={busyId === t.id}
              title="Odrzuć – km nadal pozostaną nieprzypisane"
              className="px-3 py-2 rounded-[10px] bg-white border border-line hover:bg-subtle text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <X className="w-4 h-4" /> Odrzuć
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
