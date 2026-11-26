/**
 * Kontrola „czy to na pewno prawda?” – ostrzeżenia przed zapisem wpisu.
 * To nie są błędy blokujące: użytkownik może zapisać wpis, ale musi podać powód.
 */

import { MileageEntry } from '../types/fleet';
import { holidayName, weekdayOf } from './calendar';
import { parseRoute } from './route';

export interface PlausibilityInput {
  id?: string;
  date: string;
  routeDescription: string;
  km: number;
}

// klucz trasy niezależny od zapisu: „Warszawa Kwiatowa 1- Długa 4- Kwiatowa 1” = „Warszawa Kwiatowa 1 – Długa 4 – Warszawa Kwiatowa 1”
// miejsce bez miasta po przecinku („Kwiatowa 1, Warszawa” → „kwiatowa 1”), ostatnie 2 słowa
const tail = (s: string) => s.split(',')[0].toLowerCase().replace(/[.]/g, ' ').split(/\s+/).filter(Boolean).slice(-2).join(' ');
export const routeKey = (route: string) => {
  const r = parseRoute(route);
  return `${tail(r.from)}|${tail(r.to)}|${r.roundTrip ? 'r' : ''}`;
};
const norm = routeKey;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export const LIMITS = {
  longTripKm: 500,
  dailyKm: 800,
};

export function checkPlausibility(c: PlausibilityInput, entries: MileageEntry[]): string[] {
  const w: string[] = [];
  const others = entries.filter((e) => e.id !== c.id);

  // 1. ta sama trasa zwykle miała inne km
  const same = others.filter((e) => norm(e.routeDescription) === norm(c.routeDescription) && e.distanceKm > 0).map((e) => e.distanceKm);
  if (same.length >= 2) {
    const med = median(same);
    const tol = Math.max(5, med * 0.25);
    if (Math.abs(c.km - med) > tol) {
      w.push(`Na tej trasie zwykle wychodzi ok. ${med} km (${same.length} wyjazdów), a teraz ${c.km} km.`);
    }
  }
  // 2. bardzo długi pojedynczy wyjazd
  if (c.km > LIMITS.longTripKm) w.push(`Bardzo długi wyjazd: ${c.km} km w jednym wpisie.`);
  // 3. suma km w ciągu dnia
  const dayKm = others.filter((e) => e.date === c.date).reduce((s, e) => s + e.distanceKm, 0) + c.km;
  if (dayKm > LIMITS.dailyKm) w.push(`Łącznie ${dayKm} km w dniu ${c.date} – to dużo jak na jeden dzień.`);
  // 4. duplikat
  if (others.some((e) => e.date === c.date && norm(e.routeDescription) === norm(c.routeDescription))) {
    w.push('W tym dniu jest już wyjazd na tej samej trasie (możliwy duplikat).');
  }
  // 5. niedziela / święto
  const hol = holidayName(c.date);
  if (hol) w.push(`${c.date} to dzień wolny od pracy (${hol}).`);
  else if (weekdayOf(c.date) === 0) w.push(`${c.date} to niedziela.`);
  // 6. data w przyszłości
  const [d, m, y] = c.date.split('.').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(y, m - 1, d) > today) w.push('Data wyjazdu jest w przyszłości.');
  return w;
}
