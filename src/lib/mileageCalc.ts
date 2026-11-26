/**
 * Logika ewidencji przebiegu – czyste funkcje (bez Reacta i Firebase), łatwe do testowania.
 *
 * Zasada jak w arkuszu Excel użytkownika:
 *   stan licznika przy udostępnieniu  = stan licznika przy zwrocie z poprzedniego wpisu
 *   liczba faktycznie przejechanych km = stan przy zwrocie − stan przy udostępnieniu
 *   stan na początek miesiąca          = stan na koniec poprzedniego miesiąca
 */

import { MileageEntry, MonthlyLedger } from '../types/fleet';
import { ddmmyyyyToIso, getMonthKeyFromDDMMYYYY } from './dateUtils';

export type StoredEntry = Omit<
  MileageEntry,
  'entryNumber' | 'odometerStart' | 'distanceKm' | 'odometerGap' | 'prevOdometerEnd' | 'odometerConflict' | 'conflictReason'
> &
  Partial<Pick<MileageEntry, 'entryNumber' | 'odometerStart' | 'distanceKm'>>;

export function compareEntries(a: StoredEntry, b: StoredEntry): number {
  const da = ddmmyyyyToIso(a.date);
  const dbb = ddmmyyyyToIso(b.date);
  if (da !== dbb) return da < dbb ? -1 : 1;
  const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
  const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  if (a.odometerEnd !== b.odometerEnd) return a.odometerEnd - b.odometerEnd;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

/**
 * Wylicza numery wpisów (od 1 w każdym miesiącu), stan licznika przy udostępnieniu i km.
 * Wpisy kolidujące z późniejszym wpisem (np. wpis ze stanem końcowym większym niż start
 * późniejszego wpisu po korekcie wstecz) są oznaczane jako `odometerConflict` i wyłączane
 * z liczenia ciągłości oraz sum kilometrów do czasu poprawy.
 */
export function deriveEntries(stored: StoredEntry[], initialOdometer: number): MileageEntry[] {
  const sorted = [...stored].sort(compareEntries);
  const perMonth: Record<string, number> = {};

  // Krok 1 (wstecz): wykryj wpisy, których stan końcowy przekracza stan początkowy późniejszego wpisu
  const invalidReason: (string | null)[] = new Array(sorted.length).fill(null);
  let maxAllowedEnd = Number.POSITIVE_INFINITY;
  let nextAnchorDate = '';
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (e.odometerEnd > maxAllowedEnd) {
      invalidReason[i] = `Stan końcowy (${e.odometerEnd.toLocaleString('pl-PL')} km) przekracza stan początkowy wpisu z ${nextAnchorDate} (${maxAllowedEnd.toLocaleString('pl-PL')} km).`;
      continue;
    }
    if (typeof e.odometerStartOverride === 'number' && Number.isFinite(e.odometerStartOverride)) {
      if (e.odometerStartOverride >= e.odometerEnd) {
        invalidReason[i] = `Stan po powrocie (${e.odometerEnd.toLocaleString('pl-PL')} km) musi być większy niż początkowy (${e.odometerStartOverride.toLocaleString('pl-PL')} km).`;
        continue;
      }
      if (e.odometerStartOverride < maxAllowedEnd) {
        maxAllowedEnd = e.odometerStartOverride;
        nextAnchorDate = e.date;
      }
    }
  }

  // Krok 2 (do przodu): wylicz ciągłość i numerację, pomijając błędne wpisy przy liczeniu
  let prevEnd = initialOdometer;
  return sorted.map((e, i) => {
    const monthKey = getMonthKeyFromDDMMYYYY(e.date) || e.monthKey;
    const hasOverride = typeof e.odometerStartOverride === 'number' && Number.isFinite(e.odometerStartOverride);
    const odometerStart = hasOverride ? e.odometerStartOverride! : prevEnd;
    const distanceKm = e.odometerEnd - odometerStart;

    let conflictReason = invalidReason[i];
    if (!conflictReason) {
      if (hasOverride && odometerStart < prevEnd) {
        conflictReason = `Stan początkowy (${odometerStart.toLocaleString('pl-PL')} km) jest mniejszy niż po poprzednim poprawnym wpisie (${prevEnd.toLocaleString('pl-PL')} km).`;
      } else if (distanceKm <= 0) {
        conflictReason = `Stan po powrocie (${e.odometerEnd.toLocaleString('pl-PL')} km) nie jest większy niż przy wyjeździe (${odometerStart.toLocaleString('pl-PL')} km).`;
      }
    }

    if (conflictReason) {
      return {
        ...e,
        monthKey,
        entryNumber: 0,
        odometerStart,
        distanceKm,
        odometerGap: false,
        prevOdometerEnd: prevEnd,
        odometerConflict: true,
        conflictReason,
      } as MileageEntry;
    }

    perMonth[monthKey] = (perMonth[monthKey] || 0) + 1;
    const odometerGap = odometerStart !== prevEnd;
    const prevOdometerEnd = prevEnd;
    prevEnd = e.odometerEnd;
    return {
      ...e,
      monthKey,
      entryNumber: perMonth[monthKey],
      odometerStart,
      distanceKm,
      odometerGap,
      prevOdometerEnd,
      odometerConflict: false,
    } as MileageEntry;
  });
}

export interface MonthSummary {
  monthKey: string;
  startOdometer: number;
  endOdometer: number;
  totalDistanceKm: number;
  entriesCount: number;
  pageNumber: number;
}

/** Lista miesięcy od pierwszego do ostatniego (bez dziur) */
export function monthRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let [y, m] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  if (!y || !m || !ty || !tm) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

export function addMonths(monthKey: string, delta: number): string {
  let [y, m] = monthKey.split('-').map(Number);
  m += delta;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Podsumowania miesięcy z ciągłością licznika i numeracją stron (1, 2, 3 … od początku ewidencji).
 */
export function summarizeMonths(
  entries: MileageEntry[],
  months: string[],
  initialOdometer: number
): Record<string, MonthSummary> {
  const out: Record<string, MonthSummary> = {};
  let carry = initialOdometer;
  months.forEach((mKey, idx) => {
    const list = entries.filter((e) => e.monthKey === mKey && !e.odometerConflict);
    const start = list.length ? list[0].odometerStart : carry;
    const end = list.length ? list[list.length - 1].odometerEnd : start;
    const totalDistanceKm = list.reduce((sum, e) => sum + e.distanceKm, 0);
    out[mKey] = {
      monthKey: mKey,
      startOdometer: start,
      endOdometer: end,
      totalDistanceKm,
      entriesCount: list.length,
      pageNumber: idx + 1,
    };
    carry = end;
  });
  return out;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  entryId?: string;
  monthKey?: string;
  message: string;
}

/** Kontrola poprawności ewidencji (pokazywana w aplikacji i w podglądzie importu) */
export function validateEntries(entries: MileageEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  entries.forEach((e) => {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(e.date)) {
      issues.push({ level: 'error', entryId: e.id, monthKey: e.monthKey, message: `Wpis ${e.entryNumber || '–'}: nieprawidłowa data „${e.date}”.` });
    }
    if (e.odometerConflict) {
      issues.push({
        level: 'error',
        entryId: e.id,
        monthKey: e.monthKey,
        message: `Wpis z ${e.date} (do poprawy, wyłączony z liczenia): ${e.conflictReason || 'nieprawidłowy stan licznika.'}`,
      });
    } else if (e.distanceKm <= 0) {
      issues.push({
        level: 'error',
        entryId: e.id,
        monthKey: e.monthKey,
        message: `Wpis ${e.entryNumber} (${e.date}): stan licznika po powrocie (${e.odometerEnd}) nie jest większy niż przy wyjeździe (${e.odometerStart}).`,
      });
    }
    if (e.odometerGap && e.prevOdometerEnd !== undefined) {
      const diff = e.odometerStart - e.prevOdometerEnd;
      if (diff < 0) {
        issues.push({
          level: 'error',
          entryId: e.id,
          monthKey: e.monthKey,
          message: `Wpis ${e.entryNumber} (${e.date}): stan początkowy (${e.odometerStart.toLocaleString('pl-PL')} km) cofa się względem poprzedniego wpisu (${e.prevOdometerEnd.toLocaleString('pl-PL')} km).`,
        });
      } else {
        issues.push({
          level: 'warning',
          entryId: e.id,
          monthKey: e.monthKey,
          message: `Wpis ${e.entryNumber} (${e.date}): brak ciągłości licznika (poprzednio ${e.prevOdometerEnd.toLocaleString('pl-PL')} km, start wpisu ${e.odometerStart.toLocaleString('pl-PL')} km – brakuje ${diff.toLocaleString('pl-PL')} km wcześniejszych wyjazdów).`,
        });
      }
    }
    if (!e.routeDescription?.trim() || !e.purposeDescription?.trim() || !e.driverName?.trim()) {
      issues.push({
        level: 'error',
        entryId: e.id,
        monthKey: e.monthKey,
        message: `Wpis ${e.entryNumber || '–'} (${e.date}): brak trasy, celu wyjazdu lub osoby kierującej.`,
      });
    }
  });
  return issues;
}

/**
 * Sprawdza nowy / zmieniony wpis zanim trafi do bazy.
 * Zwraca komunikat błędu albo null.
 */
export function checkEntryAgainstChain(
  candidate: StoredEntry,
  others: StoredEntry[],
  initialOdometer: number,
  ledgers: Record<string, MonthlyLedger>
): string | null {
  const monthKey = getMonthKeyFromDDMMYYYY(candidate.date);
  if (!monthKey) return 'Podaj datę w formacie DD.MM.RRRR.';
  if (ledgers[monthKey]?.isClosed) return `Miesiąc ${monthKey} jest zamknięty – najpierw go otwórz.`;
  if (!Number.isFinite(candidate.odometerEnd)) return 'Podaj stan licznika po powrocie.';
  if (candidate.odometerStartOverride !== undefined && (!Number.isFinite(candidate.odometerStartOverride) || candidate.odometerStartOverride < 0)) {
    return 'Podaj prawidłowy stan licznika przy wyjeździe.';
  }

  const prevDerived = deriveEntries(others, initialOdometer);
  const prevConflictIds = new Set(prevDerived.filter((e) => e.odometerConflict).map((e) => e.id));
  const derived = deriveEntries([...others, { ...candidate, monthKey }], initialOdometer);
  const idx = derived.findIndex((e) => e.id === candidate.id);
  const me = derived[idx];
  if (me.odometerConflict) {
    return me.conflictReason || 'Nieprawidłowy stan licznika względem pozostałych wpisów.';
  }
  const newlyConflictedClosed = derived.find(
    (e) => e.id !== candidate.id && e.odometerConflict && !prevConflictIds.has(e.id) && ledgers[e.monthKey]?.isClosed
  );
  if (newlyConflictedClosed) {
    return `Ten wpis kolidowałby z wpisem z ${newlyConflictedClosed.date} w zamkniętym miesiącu ${newlyConflictedClosed.monthKey}.`;
  }
  if (me.odometerGap && me.prevOdometerEnd !== undefined && me.odometerStart < me.prevOdometerEnd) {
    return `Stan licznika przy wyjeździe (${me.odometerStart} km) nie może być mniejszy niż po poprzednim wpisie (${me.prevOdometerEnd} km).`;
  }
  if (me.distanceKm <= 0) {
    return `Stan licznika po powrocie musi być większy niż przy wyjeździe (${me.odometerStart} km).`;
  }
  const next = derived.slice(idx + 1).find((e) => !e.odometerConflict);
  if (next && typeof next.odometerStartOverride !== 'number') {
    if (next.odometerEnd <= me.odometerEnd) {
      return `Kolejny wpis (${next.date}) ma stan licznika ${next.odometerEnd} km – licznik nie może się cofać. Sprawdź datę lub stan licznika.`;
    }
    if (ledgers[next.monthKey]?.isClosed && next.monthKey !== monthKey) {
      return `Ten wpis zmieniłby stan licznika w zamkniętym miesiącu ${next.monthKey}.`;
    }
  }
  if (me.distanceKm > 3000) {
    return `Wyliczono ${me.distanceKm} km na jeden wyjazd – sprawdź stan licznika.`;
  }
  return null;
}

export type ShiftOp =
  | { kind: 'update'; id: string; updates: Partial<StoredEntry>; km: number }
  | { kind: 'add'; entry: StoredEntry; km: number }
  | { kind: 'addMany'; items: { entry: StoredEntry; km: number }[] }
  | { kind: 'delete'; id: string };

export interface ShiftPlan {
  /** wpisy w nowej kolejności z nowym stanem licznika po powrocie */
  rows: (StoredEntry & { km: number })[];
  /** id wpisów, którym zmienia się tylko stan licznika */
  shiftedIds: string[];
  /** wpis zmieniany / dodawany w całości (null przy usunięciu) */
  targetId: string | null;
  /** wszystkie wpisy zapisywane w całości (przy addMany – wiele) */
  targetIds: string[];
  opMonth: string;
  /** zmiana stanu licznika na końcu ewidencji */
  delta: number;
}

/**
 * Korekta „jak w Excelu”: km zmienianego / dodawanego / usuwanego wpisu się zmieniają,
 * km wszystkich pozostałych wpisów zostają, więc kolejne stany licznika przesuwają się o różnicę.
 * `entries` – wpisy z wyliczonymi polami (deriveEntries), `stored` – te same wpisy z bazy.
 */
export function planShiftCorrection(entries: MileageEntry[], op: ShiftOp, initialOdometer: number): ShiftPlan {
  type Row = StoredEntry & { km: number; pos: number; wasConflict?: boolean };
  let rows: Row[] = entries.map((e, pos) => {
    const {
      entryNumber: _n,
      odometerStart: _s,
      distanceKm,
      odometerGap: _g,
      prevOdometerEnd: _p,
      odometerConflict,
      conflictReason: _cr,
      ...rest
    } = e;
    return { ...rest, km: distanceKm, pos, wasConflict: Boolean(odometerConflict) };
  });
  let opMonth = '';
  let targetId: string | null = null;
  let targetIds: string[] = [];
  if (op.kind === 'update') {
    const cur = rows.find((r) => r.id === op.id);
    if (!cur) throw new Error('Nie znaleziono wpisu.');
    const date = (op.updates.date as string) ?? cur.date;
    opMonth = getMonthKeyFromDDMMYYYY(date);
    targetId = op.id;
    rows = rows.map((r) => (r.id === op.id ? { ...r, ...op.updates, date, monthKey: opMonth, km: op.km, wasConflict: false } : r));
  } else if (op.kind === 'add') {
    opMonth = getMonthKeyFromDDMMYYYY(op.entry.date);
    const iso = ddmmyyyyToIso(op.entry.date);
    const before = rows
      .filter((r) => {
        const rIso = ddmmyyyyToIso(r.date);
        if (rIso < iso) return true;
        if (rIso > iso) return false;
        if (typeof op.entry.odometerStartOverride === 'number') return r.odometerEnd <= op.entry.odometerStartOverride;
        return true;
      })
      .pop();
    targetId = op.entry.id;
    rows.push({ ...op.entry, monthKey: opMonth, km: op.km, pos: (before?.pos ?? -1) + 0.5 });
  } else if (op.kind === 'addMany') {
    if (!op.items.length) throw new Error('Brak wpisów do dodania.');
    if (op.items.some((it) => !(it.km > 0))) throw new Error('Liczba kilometrów musi być większa od zera.');
    const sorted = [...op.items].sort((a, b) => ddmmyyyyToIso(a.entry.date).localeCompare(ddmmyyyyToIso(b.entry.date)));
    opMonth = getMonthKeyFromDDMMYYYY(sorted[0].entry.date);
    const base = [...rows];
    sorted.forEach((it, j) => {
      const iso = ddmmyyyyToIso(it.entry.date);
      const before = base.filter((r) => ddmmyyyyToIso(r.date) <= iso).pop();
      rows.push({ ...it.entry, monthKey: getMonthKeyFromDDMMYYYY(it.entry.date), km: it.km, pos: (before?.pos ?? -1) + 0.5 + j / 10000 });
    });
    targetIds = sorted.map((it) => it.entry.id);
  } else {
    const cur = rows.find((r) => r.id === op.id);
    if (!cur) throw new Error('Nie znaleziono wpisu.');
    opMonth = cur.monthKey;
    rows = rows.filter((r) => r.id !== op.id);
  }
  if ((op.kind === 'update' || op.kind === 'add') && !(op.km > 0)) throw new Error('Liczba kilometrów musi być większa od zera.');

  rows.sort((a, b) => {
    const da = ddmmyyyyToIso(a.date);
    const dbb = ddmmyyyyToIso(b.date);
    return da !== dbb ? (da < dbb ? -1 : 1) : a.pos - b.pos;
  });
  if (targetId) targetIds = [targetId];
  const targets = new Set(targetIds);
  let prev = initialOdometer;
  const shiftedIds: string[] = [];
  const out = rows.map(({ pos: _p, wasConflict, ...r }) => {
    if (wasConflict) return r;
    if (typeof r.odometerStartOverride === 'number' && Number.isFinite(r.odometerStartOverride)) {
      if (prev > r.odometerStartOverride) {
        throw new Error(
          `Wpis z ${r.date} ma ustawiony licznik początkowy ${r.odometerStartOverride} km, a poprzednie wpisy osiągnęły ${prev} km.`
        );
      }
      prev = r.odometerStartOverride;
    }
    const end = prev + r.km;
    prev = end;
    if (!targets.has(r.id) && r.odometerEnd !== end) shiftedIds.push(r.id);
    return { ...r, odometerEnd: end };
  });
  const validOld = entries.filter((e) => !e.odometerConflict);
  const oldLast = validOld.length ? validOld[validOld.length - 1].odometerEnd : initialOdometer;
  return { rows: out, shiftedIds, targetId, targetIds, opMonth, delta: prev - oldLast };
}

/**
 * Zwraca listę zamkniętych miesięcy (`YYYY-MM`), w których korekta przesunie stany licznika.
 */
export function getAffectedClosedMonths(
  entries: MileageEntry[],
  op: ShiftOp,
  initialOdometer: number,
  ledgers: Record<string, MonthlyLedger>,
  months: string[]
): string[] {
  const plan = planShiftCorrection(entries, op, initialOdometer);
  const newDerived = deriveEntries(
    plan.rows.map((r, i) => ({ ...r, seq: i })),
    initialOdometer
  );
  const sums = summarizeMonths(newDerived, months, initialOdometer);
  const shiftedSet = new Set(plan.shiftedIds);
  const shiftedMonths = new Set(entries.filter((e) => shiftedSet.has(e.id)).map((e) => e.monthKey));
  return months.filter((mKey) => {
    const l = ledgers[mKey];
    if (!l?.isClosed) return false;
    if (shiftedMonths.has(mKey)) return true;
    if (mKey <= plan.opMonth) return false;
    const s2 = sums[mKey];
    return Boolean(s2 && (s2.startOdometer !== l.startOdometer || s2.endOdometer !== l.endOdometer));
  });
}
