import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, X, ArrowLeftRight, Gauge, Route as RouteIcon } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { MileageEntry } from '../../types/fleet';
import { ddmmyyyyToIso, getMonthBounds, getMonthKeyFromDDMMYYYY, isoToDDMMYYYY, getPolishMonthName } from '../../lib/dateUtils';
import { composeRoute, isSamePlace, parseRoute, rankPlaces } from '../../lib/route';
import { checkPlausibility } from '../../lib/plausibility';
import { weekdayName } from '../../lib/calendar';
import { getAffectedClosedMonths, planShiftCorrection } from '../../lib/mileageCalc';
import { useConfirm } from '../ui/ConfirmDialog';
import { PlaceInput } from './PlaceInput';
import { AddPurposeModal } from './AddPurposeModal';
import { KmInput, fmtKm } from './KmInput';

const inputCls =
  'w-full px-3 py-2.5 border border-line-strong rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-subtle';

interface Props {
  mode: 'add' | 'edit';
  monthKey: string;
  entry?: MileageEntry | null;
  initialDate?: string;
  disabled?: boolean;
  onDone?: () => void;
  /** wersja w wierszu tabeli (edycja pod rekordem) */
  inline?: boolean;
}

export const EntryForm: React.FC<Props> = ({ mode, monthKey, entry, initialDate, disabled, onDone, inline }) => {
  const {
    taxpayer,
    activeVehicle,
    entries,
    months,
    addMileageEntry,
    updateMileageEntry,
    correctWithShift,
    hasEntriesAfterMonth,
    getStartOdometerForDate,
    getPurposeSuggestions,
    getLastDistanceForRoute,
    monthlyLedgers,
  } = useFleet();
  const confirm = useConfirm();

  const places = useMemo(() => rankPlaces(entries.map((e) => e.routeDescription)), [entries]);
  const defaultFrom = places[0]?.place || '';

  const gapKmForDate = (date: string): number | '' => {
    if (entry) return '';
    const iso = ddmmyyyyToIso(date);
    if (!iso) return '';
    const hasPrevValid = entries.some((e) => !e.odometerConflict && ddmmyyyyToIso(e.date) <= iso);
    if (!hasPrevValid) return '';
    const next = entries.find((e) => !e.odometerConflict && ddmmyyyyToIso(e.date) > iso);
    if (!next) return '';
    const prevEnd = getStartOdometerForDate(date);
    const diff = next.odometerStart - prevEnd;
    return diff > 0 && diff <= 3000 ? diff : '';
  };

  const init = () => {
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    const r = entry ? parseRoute(entry.routeDescription) : { from: defaultFrom, to: '', roundTrip: true };
    const date = entry?.date || initialDate || (getMonthKeyFromDDMMYYYY(todayStr) === monthKey ? todayStr : getMonthBounds(monthKey).start);
    return {
      date,
      from: r.from,
      to: r.to,
      roundTrip: r.roundTrip,
      purpose: entry?.purposeDescription || '',
      startOdo: entry?.odometerStartOverride !== undefined ? (entry.odometerStartOverride as number | '') : ('' as number | ''),
      odo: entry ? (entry.odometerEnd as number | '') : ('' as number | ''),
      km: entry ? (entry.distanceKm as number | '') : gapKmForDate(date),
      driver: entry?.driverName || taxpayer.defaultDriverName || '',
      doc: entry?.documentReferences || '',
    };
  };
  const initialCustomStartForEntry = () => {
    if (!entry || entry.odometerStartOverride === undefined) return false;
    const idx = entries.findIndex((e) => e.id === entry.id);
    const nextForEntry = idx >= 0 ? entries.slice(idx + 1).find((e) => !e.odometerConflict) : undefined;
    const alignedToNext = Boolean(
      nextForEntry &&
        typeof nextForEntry.odometerStartOverride === 'number' &&
        (entry.odometerConflict || entry.odometerEnd === nextForEntry.odometerStart)
    );
    return !alignedToNext;
  };

  const [f, setF] = useState(init);
  const [kmTouched, setKmTouched] = useState(false);
  const [useCustomStart, setUseCustomStart] = useState(initialCustomStartForEntry);
  const [submitted, setSubmitted] = useState(false);
  const [closeSignal, setCloseSignal] = useState(0);
  const [kmFormatError, setKmFormatError] = useState<string | null>(null);
  const [startFormatError, setStartFormatError] = useState<string | null>(null);
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    setKmTouched(false);
    setSubmitted(false);
    setKmFormatError(null);
    setStartFormatError(null);
    setSubmitError(null);
    setF(init());
    setUseCustomStart(initialCustomStartForEntry());
  }, [entry?.id, initialDate, monthKey]);
  const autoGapKm = useMemo(() => gapKmForDate(f.date), [entries, entry, f.date]);
  useEffect(() => {
    if (!entry && !kmTouched) {
      setF((s) => (s.km === autoGapKm ? s : { ...s, km: autoGapKm }));
    }
  }, [entry, kmTouched, autoGapKm]);
  useEffect(() => {
    if (!f.from && defaultFrom && !entry) set('from', defaultFrom);
  }, [defaultFrom]);
  useEffect(() => {
    if (!f.driver && taxpayer.defaultDriverName) set('driver', taxpayer.defaultDriverName);
  }, [taxpayer.defaultDriverName]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [showPurpose, setShowPurpose] = useState(false);

  const route = composeRoute({ from: f.from, to: f.to, roundTrip: f.roundTrip });
  const sameFromTo = isSamePlace(f.from, f.to);
  const autoStart = getStartOdometerForDate(f.date, entry?.id);
  const minVehicleOdometer = activeVehicle?.initialOdometer ?? 0;
  const probeIso = ddmmyyyyToIso(f.date);
  const nextEntry = useMemo(() => {
    if (entry) {
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx < 0) return null;
      return entries.slice(idx + 1).find((e) => !e.odometerConflict) || null;
    }
    return entries.find((e) => !e.odometerConflict && ddmmyyyyToIso(e.date) > probeIso) || null;
  }, [entries, entry, probeIso]);
  const canAlignToNext = Boolean(nextEntry && typeof nextEntry.odometerStartOverride === 'number');
  const [anchorDirection, setAnchorDirection] = useState<'backward' | 'forward'>('backward');
  useEffect(() => {
    setAnchorDirection('backward');
  }, [entry?.id, initialDate, monthKey]);

  const laterExists = entry
    ? entries[entries.length - 1]?.id !== entry.id
    : hasEntriesAfterMonth(monthKey) || entries.some((e) => e.monthKey === monthKey && ddmmyyyyToIso(e.date) > probeIso);
  // tryb: „km” – wpisujesz kilometry (kolejne stany licznika przesuną się), „odo” – stan licznika z odczytu
  const [mode2, setMode2] = useState<'km' | 'odo'>(laterExists ? 'km' : 'odo');
  useEffect(() => setMode2(laterExists ? 'km' : 'odo'), [entry?.id]);
  useEffect(() => {
    if (!entry && autoGapKm !== '' && !kmTouched) setMode2('km');
  }, [entry, autoGapKm, kmTouched]);

  const backwardActive = canAlignToNext && anchorDirection === 'backward' && !useCustomStart && mode2 === 'km';
  const backwardEnd = backwardActive && nextEntry ? nextEntry.odometerStart : null;

  const customStartVal = typeof f.startOdo === 'number' && Number.isFinite(f.startOdo) ? f.startOdo : null;
  const km =
    mode2 === 'km'
      ? typeof f.km === 'number'
        ? f.km
        : null
      : typeof f.odo === 'number' && (useCustomStart ? customStartVal : autoStart) !== null
        ? f.odo - (useCustomStart ? customStartVal! : autoStart)
        : null;

  const start = useCustomStart
    ? customStartVal
    : backwardEnd !== null
      ? km !== null && km > 0
        ? backwardEnd - km
        : null
      : autoStart;
  const startOverride = (useCustomStart || backwardActive) && start !== null && start !== autoStart ? start : undefined;

  const willConflictEntries = useMemo(() => {
    if (!backwardActive || start === null || km === null || km <= 0) return [] as MileageEntry[];
    return entries.filter((e) => {
      if (e.id === entry?.id || e.odometerConflict) return false;
      const eIso = ddmmyyyyToIso(e.date);
      if (nextEntry && eIso >= ddmmyyyyToIso(nextEntry.date)) return false;
      if (entry) {
        const idx = entries.findIndex((x) => x.id === entry.id);
        const eIdx = entries.findIndex((x) => x.id === e.id);
        if (eIdx >= idx && eIso >= probeIso) return false;
      } else if (eIso > probeIso) {
        return false;
      }
      return e.odometerEnd > start;
    });
  }, [backwardActive, start, km, entries, entry, probeIso, nextEntry]);
  const closedConflictEntries = useMemo(
    () => willConflictEntries.filter((e) => monthlyLedgers[e.monthKey]?.isClosed),
    [willConflictEntries, monthlyLedgers]
  );

  const shiftPreview = useMemo(() => {
    if (mode2 !== 'km' || !laterExists || backwardActive || km === null || km <= 0 || start === null) {
      return { shiftedCount: 0, delta: 0, affectedClosedMonths: [] as string[], error: null as string | null };
    }
    try {
      const dummyBase = {
        date: f.date,
        routeDescription: route,
        purposeDescription: f.purpose,
        driverName: f.driver,
        odometerStartOverride: startOverride,
      };
      const shiftOp = entry
        ? { kind: 'update' as const, id: entry.id, updates: dummyBase, km }
        : {
            kind: 'add' as const,
            entry: { ...dummyBase, id: '__preview__', vehicleId: '', monthKey, odometerEnd: 0 },
            km,
          };
      const initOdo = activeVehicle?.initialOdometer ?? 0;
      const plan = planShiftCorrection(entries, shiftOp, initOdo);
      const affectedClosedMonths =
        plan.shiftedIds.length > 0 && plan.delta !== 0
          ? getAffectedClosedMonths(entries, shiftOp, initOdo, monthlyLedgers, months)
          : [];
      return { shiftedCount: plan.shiftedIds.length, delta: plan.delta, affectedClosedMonths, error: null };
    } catch (err) {
      return { shiftedCount: 0, delta: 0, affectedClosedMonths: [] as string[], error: err instanceof Error ? err.message : String(err) };
    }
  }, [mode2, laterExists, backwardActive, km, start, startOverride, f.date, route, f.purpose, f.driver, entries, entry, monthKey, activeVehicle?.initialOdometer, monthlyLedgers, months]);

  const shiftDelta = shiftPreview.shiftedCount > 0 ? shiftPreview.delta : 0;
  const lastRouteKm = route ? getLastDistanceForRoute(route) : null;
  const purposeSuggestions = getPurposeSuggestions(f.purpose);
  const bounds = getMonthBounds(monthKey);

  const dateInvalid = getMonthKeyFromDDMMYYYY(f.date) !== monthKey;
  const fromError = submitted && !f.from.trim() ? 'Podaj miejsce wyjazdu.' : null;
  const toError = submitted && !f.to.trim() ? 'Podaj miejsce docelowe.' : null;
  const purposeError = submitted && !f.purpose.trim() ? 'Podaj cel wyjazdu.' : null;
  const startError =
    startFormatError ||
    (submitted && useCustomStart && start === null ? 'Podaj stan licznika przy wyjeździe.' : null);
  const kmValueError =
    kmFormatError ||
    (submitted && km === null
      ? mode2 === 'km'
        ? 'Podaj liczbę kilometrów.'
        : 'Podaj stan licznika po powrocie.'
      : submitted && km !== null && km <= 0
        ? mode2 === 'km'
          ? 'Liczba kilometrów musi być większa od zera.'
          : `Stan licznika musi być większy niż ${fmtKm(start ?? autoStart)} km.`
        : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setCloseSignal((c) => c + 1);
    setShowPurpose(false);
    setSubmitError(null);

    if (
      !f.from.trim() ||
      !f.to.trim() ||
      !f.purpose.trim() ||
      sameFromTo ||
      dateInvalid ||
      Boolean(kmFormatError) ||
      Boolean(startFormatError) ||
      (useCustomStart && start === null) ||
      km === null ||
      km <= 0 ||
      start === null ||
      start < minVehicleOdometer ||
      closedConflictEntries.length > 0 ||
      (!backwardActive && start < autoStart) ||
      Boolean(shiftPreview.error)
    ) {
      return;
    }

    // ostrzeżenia: nietypowe km, duplikat, niedziela/święto… – zapis po podaniu powodu
    const warnings = checkPlausibility({ id: entry?.id, date: f.date, routeDescription: route, km }, entries);
    const unchanged =
      entry &&
      entry.date === f.date &&
      entry.routeDescription === route &&
      entry.distanceKm === km &&
      entry.odometerStart === start &&
      entry.verification;
    let verification = entry?.verification;
    if (warnings.length && !unchanged) {
      const r = await confirm({
        title: 'Czy na pewno chcesz zapisać ten wpis?',
        message: 'Dane wyglądają nietypowo. Jeśli są prawidłowe, podaj krótko powód – zapisze się przy wpisie.',
        warnings,
        tone: 'warn',
        requireReason: true,
        confirmLabel: 'Tak, zapisz',
      });
      if (!r.ok) return;
      verification = { reason: r.reason || '', warnings, at: new Date().toISOString() };
    }
    if (shiftDelta !== 0) {
      const closedLabels = shiftPreview.affectedClosedMonths.map((m) => `${getPolishMonthName(m)} ${m.slice(0, 4)}`);
      const r = await confirm({
        title: closedLabels.length
          ? 'Przesunąć stany licznika (także w zamkniętych miesiącach)?'
          : 'Przesunąć kolejne stany licznika?',
        message: `Stany licznika we wszystkich kolejnych wpisach ${shiftDelta > 0 ? 'zwiększą' : 'zmniejszą'} się o ${fmtKm(Math.abs(shiftDelta))} km. Kilometry tych wpisów się nie zmienią.`,
        warnings: closedLabels.length
          ? [
              `Zmiana przepisze zamknięte miesiące (${closedLabels.length}): ${closedLabels.join(', ')}.`,
              'W zamkniętych miesiącach zmienią się stany na początek i koniec okresu, a korekta trafi do ich historii.',
            ]
          : undefined,
        tone: closedLabels.length ? 'warn' : 'default',
        confirmLabel: closedLabels.length ? 'Przesuń mimo zamkniętych miesięcy' : 'Przesuń i zapisz',
      });
      if (!r.ok) return;
    }

    const base = {
      date: f.date,
      routeDescription: route,
      purposeDescription: f.purpose.trim(),
      driverName: f.driver.trim() || taxpayer.defaultDriverName,
      documentReferences: f.doc.trim() || undefined,
      odometerStartOverride: startOverride,
      verification,
    };
    setBusy(true);
    try {
      if (mode2 === 'km' && laterExists && !backwardActive) {
        if (entry) await correctWithShift({ kind: 'update', id: entry.id, updates: base, km }, `wpis z ${f.date}`);
        else await correctWithShift({ kind: 'add', input: base, km }, `nowy wpis z ${f.date}`);
      } else {
        const payload = { ...base, odometerEnd: start + km };
        if (entry) await updateMileageEntry(entry.id, payload);
        else await addMileageEntry(payload);
      }
      if (mode === 'add') {
        setKmTouched(false);
        setSubmitted(false);
        setKmFormatError(null);
        setStartFormatError(null);
        setF((s) => ({ ...init(), startOdo: '', date: s.date, from: s.from, driver: s.driver }));
        setUseCustomStart(false);
      }
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(
        /insufficient permissions|permission-denied/i.test(msg)
          ? 'Serwer odrzucił zapis (brak uprawnień, np. miesiąc jest zamknięty). Nic nie zostało zmienione.'
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} noValidate className={inline ? 'space-y-4 p-5 bg-brand-soft/40 border-y-2 border-brand' : 'space-y-4'}>
      {inline && (
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-ink">
            {entry ? (entry.odometerConflict ? `Poprawa wpisu · ${entry.date}` : `Edycja wpisu nr ${entry.entryNumber} · ${entry.date}`) : `Nowy wyjazd · ${f.date}`}
          </div>
          <button type="button" onClick={onDone} className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[170px_1fr_1fr_auto] gap-3 items-start">
        <div>
          <label className="flex items-baseline justify-between gap-2 text-xs font-semibold text-ink-2 mb-1">
            <span>Data wyjazdu *</span>
            <span className="text-[11px] font-normal text-ink-3">{weekdayName(f.date)}</span>
          </label>
          <input
            type="date"
            disabled={disabled}
            min={ddmmyyyyToIso(bounds.start)}
            max={ddmmyyyyToIso(bounds.end)}
            value={ddmmyyyyToIso(f.date)}
            onChange={(e) => set('date', isoToDDMMYYYY(e.target.value))}
            className={`${inputCls} font-num ${submitted && dateInvalid ? '!border-danger !ring-1 !ring-danger' : ''}`}
          />
          {submitted && dateInvalid && (
            <div className="text-xs text-danger font-semibold mt-1">
              Data musi mieścić się w miesiącu {getPolishMonthName(monthKey)} {monthKey.slice(0, 4)}.
            </div>
          )}
        </div>
        <PlaceInput label="Skąd" required value={f.from} onChange={(v) => set('from', v)} places={places} exclude={f.to} error={fromError} closeSignal={closeSignal} placeholder="np. Warszawa Kwiatowa 1" disabled={disabled} />
        <PlaceInput label="Dokąd" required value={f.to} onChange={(v) => set('to', v)} places={places} exclude={f.from} invalid={sameFromTo} error={toError} closeSignal={closeSignal} placeholder="np. Powstańców Śląskich 95" disabled={disabled} />
        <div className="md:pt-[22px]">
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-[10px] border text-sm font-semibold cursor-pointer select-none ${f.roundTrip ? 'bg-brand-soft border-[#C9D7FF] text-brand' : 'bg-white border-line-strong text-ink-2'}`}>
            <input type="checkbox" className="sr-only" checked={f.roundTrip} disabled={disabled} onChange={(e) => set('roundTrip', e.target.checked)} />
            <ArrowLeftRight className="w-4 h-4" /> z powrotem
          </label>
        </div>
      </div>
      {sameFromTo ? (
        <div className="text-xs text-danger font-semibold -mt-2.5">Miejsce „Dokąd” musi być inne niż miejsce „Skąd”.</div>
      ) : (
        route && <div className="text-[11px] text-ink-3 -mt-2.5">Trasa w ewidencji: {route}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="relative">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-ink-2">Cel wyjazdu / udostępnienia pojazdu *</label>
            <button type="button" onClick={() => setPurposeOpen(true)} disabled={disabled} className="text-xs text-brand font-semibold inline-flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Wybierz / dodaj cel
            </button>
          </div>
          <input
            type="text"
            disabled={disabled}
            value={f.purpose}
            onChange={(e) => {
              set('purpose', e.target.value);
              setShowPurpose(e.target.value.length >= 3);
            }}
            onBlur={() => setTimeout(() => setShowPurpose(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowPurpose(false);
            }}
            placeholder="np. Przejazd do biura klienta"
            className={`${inputCls} ${purposeError ? '!border-danger !ring-1 !ring-danger focus:!ring-danger' : ''}`}
          />
          {purposeError && <div className="text-xs text-danger font-semibold mt-1">{purposeError}</div>}
          {showPurpose && purposeSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-line rounded-xl shadow-xl py-1 z-40 max-h-56 overflow-y-auto">
              {purposeSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    set('purpose', s);
                    setShowPurpose(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-soft truncate"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1">Numer dowodu celowości (opcjonalnie)</label>
          <input
            type="text"
            disabled={disabled}
            value={f.doc}
            onChange={(e) => set('doc', e.target.value)}
            placeholder="np. FV/2025/08/12 – pliki dołączysz przyciskiem „Załącz”"
            className={inputCls}
          />
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 items-start ${useCustomStart ? 'md:grid-cols-[auto_175px_175px_1fr]' : 'md:grid-cols-[auto_190px_1fr]'}`}>
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1.5 leading-4 whitespace-nowrap">Wpisuję</label>
          <div className="inline-flex p-1 rounded-[10px] bg-subtle border border-line">
            {(
              [
                ['km', 'kilometry', RouteIcon],
                ['odo', 'stan licznika', Gauge],
              ] as const
            ).map(([k, l, Icon]) => (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => setMode2(k)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${mode2 === k ? 'bg-white shadow-sm text-ink' : 'text-ink-3'}`}
              >
                <Icon className="w-3.5 h-3.5" /> {l}
              </button>
            ))}
          </div>
        </div>
        {useCustomStart && (
          <div>
            <label className="block text-xs font-semibold text-ink-2 mb-1.5 leading-4 whitespace-nowrap">Licznik początkowy *</label>
            <KmInput
              disabled={disabled}
              value={f.startOdo}
              invalid={Boolean(startError)}
              onInvalidChange={setStartFormatError}
              onChange={(v) => set('startOdo', v)}
              placeholder={`np. ${fmtKm(autoStart)}`}
              className={`${inputCls} font-num font-bold`}
            />
            {startError && <div className="text-xs text-danger font-semibold mt-1">{startError}</div>}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setUseCustomStart(false);
                setStartFormatError(null);
                set('startOdo', '');
              }}
              className="mt-1 text-[11px] font-semibold text-brand hover:underline whitespace-nowrap"
              title={`Wróć do stanu z ciągłości (${fmtKm(autoStart)} km)`}
            >
              Przywróć ciągłość ({fmtKm(autoStart)})
            </button>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1.5 leading-4 whitespace-nowrap">
            {mode2 === 'km' ? 'Liczba km *' : 'Licznik po powrocie *'}
          </label>
          {mode2 === 'km' ? (
            <KmInput
              disabled={disabled}
              value={f.km}
              invalid={Boolean(kmValueError)}
              onInvalidChange={setKmFormatError}
              onChange={(v) => {
                setKmTouched(true);
                set('km', v);
              }}
              placeholder={lastRouteKm ? fmtKm(lastRouteKm) : 'np. 19'}
              className={`${inputCls} font-num font-bold text-brand`}
            />
          ) : (
            <KmInput
              disabled={disabled}
              value={f.odo}
              invalid={Boolean(kmValueError)}
              onInvalidChange={setKmFormatError}
              onChange={(v) => set('odo', v)}
              placeholder={start !== null ? `powyżej ${fmtKm(start)}` : 'np. 45 660'}
              className={`${inputCls} font-num font-bold text-brand`}
            />
          )}
          {kmValueError && <div className="text-xs text-danger font-semibold mt-1">{kmValueError}</div>}
        </div>
        <div className="text-xs text-ink-2 font-num md:pt-7 space-y-1">
          <div>
            Licznik: {start !== null ? fmtKm(start) : '…'} →{' '}
            <b className="text-brand">
              {backwardActive && backwardEnd !== null
                ? fmtKm(backwardEnd)
                : start !== null && km !== null && km > 0
                  ? fmtKm(start + km)
                  : mode2 === 'odo' && typeof f.odo === 'number'
                    ? fmtKm(f.odo)
                    : '…'}
            </b>
            {km !== null && <span className={km > 0 ? '' : 'text-danger'}> · {fmtKm(km)} km</span>}
          </div>
          {backwardActive && nextEntry ? (
            <>
              {start !== null && start < minVehicleOdometer ? (
                <div className="text-danger font-sans font-semibold">
                  Licznik początkowy ({fmtKm(start)} km) nie może być mniejszy niż początkowy licznik pojazdu ({fmtKm(minVehicleOdometer)} km).
                </div>
              ) : closedConflictEntries.length > 0 ? (
                <div className="text-danger font-sans font-semibold">
                  Wpis kolidowałby z wpisem z {closedConflictEntries.map((e) => e.date).join(', ')} w zamkniętym miesiącu – najpierw go otwórz.
                </div>
              ) : willConflictEntries.length > 0 ? (
                <div className="bg-warn-soft border border-[#F5D9A8] text-warn font-sans font-semibold px-2.5 py-1.5 rounded-lg">
                  Wyrównano wstecz do {nextEntry.date} ({fmtKm(nextEntry.odometerStart)} km). Wpis z{' '}
                  {willConflictEntries.map((e) => e.date).join(', ')} ma wyższy stan licznika – po zapisie zostanie oznaczony na czerwono do poprawy i wyłączony z liczenia.
                </div>
              ) : start !== null && start > autoStart ? (
                <div className="text-warn font-sans font-semibold">
                  Wyliczono wstecz do wpisu z {nextEntry.date} – przed tym dniem zostanie przerwa (+{fmtKm(start - autoStart)} km od {fmtKm(autoStart)} km).
                </div>
              ) : start !== null && start === autoStart ? (
                <div className="text-ok font-sans font-semibold">Ciągłość licznika z poprzednim i kolejnym wpisem będzie pełna.</div>
              ) : (
                <div className="text-ink-3 font-sans">
                  Wpis przed {nextEntry.date} ({fmtKm(nextEntry.odometerStart)} km) – wpisane km odejmą się od tego stanu.
                </div>
              )}
              <div className="font-sans flex flex-wrap gap-x-3 gap-y-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setAnchorDirection('forward')}
                  className="text-brand hover:underline font-semibold"
                >
                  Licz od poprzedniego ({fmtKm(autoStart)} →)
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setUseCustomStart(true)}
                  className="text-brand hover:underline font-semibold"
                >
                  Podaj własny stan początkowy
                </button>
              </div>
            </>
          ) : (
            !useCustomStart && (
              <div className="font-sans flex flex-wrap gap-x-3 gap-y-1">
                {mode2 === 'odo' && km !== null && km > 500 ? (
                  <div className="inline-flex flex-wrap items-center gap-1.5 bg-warn-soft border border-[#F5D9A8] text-warn px-2.5 py-1 rounded-lg">
                    <span>Duży skok (+{fmtKm(km)} km od {fmtKm(autoStart)}). Uzupełniasz nie po kolei?</span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setUseCustomStart(true)}
                      className="font-bold underline hover:opacity-80"
                    >
                      Wpisz licznik początkowy
                    </button>
                  </div>
                ) : (
                  <>
                    {canAlignToNext && mode2 === 'km' && nextEntry && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setAnchorDirection('backward')}
                        className="text-brand hover:underline font-semibold"
                      >
                        Licz wstecz do kolejnego (→ {fmtKm(nextEntry.odometerStart)})
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setUseCustomStart(true)}
                      className="text-brand hover:underline font-semibold"
                    >
                      Brak ciągłości? Podaj też stan początkowy licznika
                    </button>
                  </>
                )}
              </div>
            )
          )}
          {useCustomStart && start !== null && start > autoStart && (
            <div className="text-warn font-sans font-semibold">
              Brak ciągłości (+{fmtKm(start - autoStart)} km od {fmtKm(autoStart)} km) – pamiętaj uzupełnić wcześniejsze wpisy.
            </div>
          )}
          {useCustomStart && start !== null && start < autoStart && (
            <div className="text-danger font-sans font-semibold">
              Stan początkowy nie może być mniejszy niż poprzedni wpis ({fmtKm(autoStart)} km).
            </div>
          )}
          {shiftPreview.error && <div className="text-danger font-sans font-semibold">{shiftPreview.error}</div>}
          {lastRouteKm !== null && <div className="text-ink-3 font-sans">Ostatnio na tej trasie: {fmtKm(lastRouteKm)} km</div>}
          {shiftDelta !== 0 && (
            <div className="text-warn font-sans font-semibold">
              Kolejne stany licznika: {shiftDelta > 0 ? '+' : '−'}
              {fmtKm(Math.abs(shiftDelta))} km
            </div>
          )}
          {shiftDelta !== 0 && shiftPreview.affectedClosedMonths.length > 0 && (
            <div className="bg-warn-soft border border-[#F5D9A8] text-warn font-sans font-semibold px-2.5 py-1.5 rounded-lg">
              Uwaga: korekta przepisze stany licznika w zamkniętych miesiącach:{' '}
              {shiftPreview.affectedClosedMonths.map((m) => `${getPolishMonthName(m)} ${m.slice(0, 4)}`).join(', ')}.
            </div>
          )}
          {mode2 === 'km' && laterExists && shiftDelta === 0 && !backwardActive && !shiftPreview.error && km !== null && km > 0 && (
            <div className="text-ink-3 font-sans">Kolejne wpisy bez zmian (mają własny stan początkowy).</div>
          )}
          {mode2 === 'odo' && laterExists && <div className="text-ink-3 font-sans">Kolejne stany bez zmian – różnicę przejmie następny wpis.</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
        <div className="max-w-xs">
          <label className="block text-xs font-semibold text-ink-2 mb-1">Osoba kierująca pojazdem *</label>
          <input type="text" disabled={disabled} value={f.driver} onChange={(e) => set('driver', e.target.value)} className={inputCls} />
        </div>
        <div className="flex gap-2 justify-end">
          {(inline || mode === 'edit') && (
            <button type="button" onClick={onDone} className="px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-white rounded-[10px]">
              Anuluj
            </button>
          )}
          <button type="submit" disabled={busy || disabled} className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 shadow-sm">
            {mode === 'edit' ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {mode === 'edit' ? 'Zapisz zmiany' : 'Dodaj wyjazd'}
          </button>
        </div>
      </div>

      {entry?.verification && (
        <div className="text-xs text-ink-2 bg-white border border-line rounded-[10px] p-2.5">
          Potwierdzono mimo ostrzeżeń: <i>„{entry.verification.reason}”</i>
        </div>
      )}
        {submitError && <div className="text-sm text-danger bg-danger-soft rounded-[10px] p-3 whitespace-pre-line">{submitError}</div>}
      </form>
      <AddPurposeModal isOpen={purposeOpen} onClose={() => setPurposeOpen(false)} onSelectPurpose={(p) => set('purpose', p)} />
    </>
  );
};
