import React, { useMemo, useState } from 'react';
import { CalendarRange, ArrowLeftRight, X } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { ddmmyyyyToIso, getMonthBounds, isoToDDMMYYYY, getPolishMonthName } from '../../lib/dateUtils';
import { composeRoute, isSamePlace, rankPlaces } from '../../lib/route';
import { checkPlausibility } from '../../lib/plausibility';
import { daysOfMonth, holidayName, weekdayOf, WEEKDAYS_SHORT } from '../../lib/calendar';
import { useConfirm } from '../ui/ConfirmDialog';
import { PlaceInput } from './PlaceInput';
import { KmInput } from './KmInput';
import { getAffectedClosedMonths } from '../../lib/mileageCalc';

const inputCls =
  'w-full px-3 py-2.5 border border-line-strong rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand';
// kolejność przycisków Pn…Nd, wartości jak Date.getDay()
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Masowe dodawanie powtarzalnych przejazdów (np. do pracy Pn–Pt albo w środy i czwartki) */
export const BulkAddPanel: React.FC<{ monthKey: string; onClose: () => void }> = ({ monthKey, onClose }) => {
  const { entries, activeVehicle, months, monthlyLedgers, taxpayer, correctWithShift, getPurposeSuggestions } = useFleet();
  const confirm = useConfirm();
  const places = useMemo(() => rankPlaces(entries.map((e) => e.routeDescription)), [entries]);
  const bounds = getMonthBounds(monthKey);

  const [from, setFrom] = useState(bounds.start);
  const [to, setTo] = useState(bounds.end);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [skipBusy, setSkipBusy] = useState(true);
  const [placeFrom, setPlaceFrom] = useState(places[0]?.place || '');
  const [placeTo, setPlaceTo] = useState('');
  const [roundTrip, setRoundTrip] = useState(true);
  const [purpose, setPurpose] = useState('Przejazd do biura klienta');
  const [km, setKm] = useState<number | ''>('');
  const [kmFormatError, setKmFormatError] = useState<string | null>(null);
  const [driver, setDriver] = useState(taxpayer.defaultDriverName || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const route = composeRoute({ from: placeFrom, to: placeTo, roundTrip });
  const sameFromTo = isSamePlace(placeFrom, placeTo);
  const busyDays = new Set(entries.filter((e) => e.monthKey === monthKey).map((e) => e.date));
  const dates = daysOfMonth(monthKey).filter((d) => {
    const iso = ddmmyyyyToIso(d);
    if (iso < ddmmyyyyToIso(from) || iso > ddmmyyyyToIso(to)) return false;
    if (!days.includes(weekdayOf(d))) return false;
    if (skipHolidays && holidayName(d)) return false;
    if (skipBusy && busyDays.has(d)) return false;
    return true;
  });
  const skippedHolidays = daysOfMonth(monthKey).filter((d) => days.includes(weekdayOf(d)) && holidayName(d));
  const total = typeof km === 'number' ? km * dates.length : 0;

  const toggle = (d: number) => setDays((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));

  const submit = async () => {
    setError(null);
    if (!placeFrom.trim() || !placeTo.trim() || !purpose.trim()) return setError('Uzupełnij skąd, dokąd i cel wyjazdu.');
    if (sameFromTo) return setError('Miejsce „Dokąd” musi być inne niż miejsce „Skąd”.');
    if (kmFormatError) return setError(kmFormatError);
    if (!(typeof km === 'number' && Number.isInteger(km) && km > 0)) return setError('Podaj liczbę kilometrów jednego przejazdu.');
    if (!dates.length) return setError('Nie ma dni pasujących do wybranych ustawień.');

    const warnings = Array.from(new Set(checkPlausibility({ date: dates[0], routeDescription: route, km }, entries).filter((w) => !w.startsWith(dates[0]) && !w.includes('w przyszłości'))));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const future = dates.filter((d) => new Date(ddmmyyyyToIso(d)) > today).length;
    if (future) warnings.push(`${future} z ${dates.length} dat jest w przyszłości – ewidencja powinna odpowiadać faktycznym przejazdom, więc sprawdź je po fakcie.`);

    let affectedClosed: string[] = [];
    try {
      affectedClosed = getAffectedClosedMonths(
        entries,
        {
          kind: 'addMany',
          items: dates.map((d, idx) => ({
            entry: {
              id: `__bulk_prev_${idx}`,
              vehicleId: activeVehicle?.id || '',
              monthKey,
              date: d,
              routeDescription: route,
              purposeDescription: purpose.trim(),
              driverName: driver.trim() || taxpayer.defaultDriverName,
              odometerEnd: 0,
            },
            km,
          })),
        },
        activeVehicle?.initialOdometer ?? 0,
        monthlyLedgers,
        months
      );
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    const extraShiftWarnings = affectedClosed.length
      ? [`Dodanie wpisów przesunie stany licznika także w zamkniętych miesiącach: ${affectedClosed.map((m) => `${getPolishMonthName(m)} ${m.slice(0, 4)}`).join(', ')}.`]
      : [];

    const allWarnings = [...warnings, ...extraShiftWarnings];
    const r = await confirm({
      title: `Dodać ${dates.length} przejazdów?`,
      message: `${route}\n${purpose}\n${dates.length} × ${km} km = ${total.toLocaleString('pl-PL')} km. Kolejne stany licznika przeliczą się automatycznie.`,
      warnings: allWarnings,
      tone: allWarnings.length ? 'warn' : 'default',
      requireReason: warnings.length > 0,
      confirmLabel: `Dodaj ${dates.length} wpisów`,
    });
    if (!r.ok) return;
    const verification = warnings.length ? { reason: r.reason || '', warnings, at: new Date().toISOString() } : undefined;
    setBusy(true);
    try {
      await correctWithShift(
        {
          kind: 'addMany',
          items: dates.map((d) => ({
            input: { date: d, routeDescription: route, purposeDescription: purpose.trim(), driverName: driver.trim() || taxpayer.defaultDriverName, source: 'bulk', verification },
            km,
          })),
        },
        `masowe dodanie ${dates.length} przejazdów`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = getPurposeSuggestions(purpose).slice(0, 5);

  return (
    <div className="card p-6 space-y-4 border-brand/40">
      <div className="flex items-center gap-2">
        <CalendarRange className="w-5 h-5 text-brand" />
        <h3 className="flex-1 font-bold text-base">
          Dodaj seryjnie – {getPolishMonthName(monthKey)} {monthKey.slice(0, 4)}
        </h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-subtle">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-ink-2">Dni tygodnia</div>
          <div className="flex gap-1">
            {ORDER.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                className={`w-10 h-10 rounded-[10px] text-sm font-bold ${days.includes(d) ? 'bg-brand text-white' : 'bg-subtle text-ink-3 hover:bg-line'}`}
              >
                {WEEKDAYS_SHORT[d]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Pn–Pt', [1, 2, 3, 4, 5]],
              ['Śr + Cz', [3, 4]],
              ['Wt + Cz', [2, 4]],
              ['Codziennie', [0, 1, 2, 3, 4, 5, 6]],
            ].map(([l, v]) => (
              <button key={l as string} type="button" onClick={() => setDays(v as number[])} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-line hover:bg-subtle">
                {l as string}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink-2 mb-1">Od</label>
            <input type="date" min={ddmmyyyyToIso(bounds.start)} max={ddmmyyyyToIso(bounds.end)} value={ddmmyyyyToIso(from)} onChange={(e) => setFrom(isoToDDMMYYYY(e.target.value))} className={`${inputCls} font-num`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-2 mb-1">Do</label>
            <input type="date" min={ddmmyyyyToIso(bounds.start)} max={ddmmyyyyToIso(bounds.end)} value={ddmmyyyyToIso(to)} onChange={(e) => setTo(isoToDDMMYYYY(e.target.value))} className={`${inputCls} font-num`} />
          </div>
          <label className="flex items-center gap-2 text-sm col-span-2 sm:col-span-1">
            <input type="checkbox" checked={skipHolidays} onChange={(e) => setSkipHolidays(e.target.checked)} /> Pomiń święta
            {skipHolidays && skippedHolidays.length > 0 && <span className="text-ink-3 text-xs">({skippedHolidays.map((d) => d.slice(0, 5)).join(', ')})</span>}
          </label>
          <label className="flex items-center gap-2 text-sm col-span-2 sm:col-span-1">
            <input type="checkbox" checked={skipBusy} onChange={(e) => setSkipBusy(e.target.checked)} /> Pomiń dni z wpisami
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <PlaceInput label="Skąd" required value={placeFrom} onChange={setPlaceFrom} places={places} exclude={placeTo} />
        <PlaceInput label="Dokąd" required value={placeTo} onChange={setPlaceTo} places={places} exclude={placeFrom} invalid={sameFromTo} />
        <label className={`flex items-center gap-2 px-3 py-2.5 rounded-[10px] border text-sm font-semibold cursor-pointer ${roundTrip ? 'bg-brand-soft border-[#C9D7FF] text-brand' : 'bg-white border-line-strong text-ink-2'}`}>
          <input type="checkbox" className="sr-only" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
          <ArrowLeftRight className="w-4 h-4" /> z powrotem
        </label>
      </div>
      {sameFromTo && <div className="text-xs text-danger font-semibold -mt-2">Miejsce „Dokąd” musi być inne niż miejsce „Skąd”.</div>}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_220px] gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1">Cel wyjazdu *</label>
          <input list="bulk-purposes" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} />
          <datalist id="bulk-purposes">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1">Km jednego przejazdu *</label>
          <KmInput
            value={km}
            onInvalidChange={setKmFormatError}
            onChange={setKm}
            placeholder="np. 19"
            className={`${inputCls} font-num font-bold text-brand`}
          />
          {kmFormatError && <div className="text-xs text-danger font-semibold mt-1">{kmFormatError}</div>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1">Kierowca</label>
          <input value={driver} onChange={(e) => setDriver(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="rounded-xl bg-subtle p-3">
        <div className="text-xs font-semibold text-ink-2 mb-2">
          Zostanie dodanych <b className="text-ink">{dates.length}</b> przejazdów{total ? ` · razem ${total.toLocaleString('pl-PL')} km` : ''}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <span key={d} className="px-2 py-1 rounded-md bg-white border border-line text-xs font-num">
              {WEEKDAYS_SHORT[weekdayOf(d)]} {d.slice(0, 5)}
            </span>
          ))}
          {!dates.length && <span className="text-xs text-ink-3">brak dni</span>}
        </div>
      </div>

      {error && <div className="text-sm text-danger bg-danger-soft rounded-[10px] p-3">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-subtle rounded-[10px]">
          Anuluj
        </button>
        <button onClick={submit} disabled={busy || !dates.length} className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-[10px] text-sm font-semibold shadow-sm">
          Dodaj {dates.length} przejazdów
        </button>
      </div>
    </div>
  );
};
