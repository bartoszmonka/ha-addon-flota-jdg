/** Dni tygodnia i polskie dni ustawowo wolne od pracy */

export const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
export const WEEKDAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

const pad = (n: number) => String(n).padStart(2, '0');

export function parseDate(ddmmyyyy: string): Date | null {
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}
export const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

export function weekdayOf(ddmmyyyy: string): number {
  return parseDate(ddmmyyyy)?.getDay() ?? -1;
}
export function weekdayName(ddmmyyyy: string): string {
  const d = weekdayOf(ddmmyyyy);
  return d >= 0 ? WEEKDAYS[d] : '';
}

/** Wielkanoc (algorytm Meeusa/Jonesa/Butchera) */
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const cache: Record<number, Record<string, string>> = {};
export function holidaysOf(year: number): Record<string, string> {
  if (cache[year]) return cache[year];
  const e = easter(year);
  const list: [Date, string][] = [
    [new Date(year, 0, 1), 'Nowy Rok'],
    [new Date(year, 0, 6), 'Trzech Króli'],
    [e, 'Wielkanoc'],
    [addDays(e, 1), 'Poniedziałek Wielkanocny'],
    [new Date(year, 4, 1), 'Święto Pracy'],
    [new Date(year, 4, 3), 'Święto Konstytucji 3 Maja'],
    [addDays(e, 49), 'Zielone Świątki'],
    [addDays(e, 60), 'Boże Ciało'],
    [new Date(year, 7, 15), 'Wniebowzięcie NMP'],
    [new Date(year, 10, 1), 'Wszystkich Świętych'],
    [new Date(year, 10, 11), 'Święto Niepodległości'],
    [new Date(year, 11, 25), 'Boże Narodzenie'],
    [new Date(year, 11, 26), 'Drugi dzień Bożego Narodzenia'],
  ];
  if (year >= 2025) list.push([new Date(year, 11, 24), 'Wigilia']);
  const out: Record<string, string> = {};
  list.forEach(([d, n]) => (out[fmtDate(d)] = n));
  return (cache[year] = out);
}
export function holidayName(ddmmyyyy: string): string | null {
  const y = Number(ddmmyyyy.slice(6));
  return holidaysOf(y)[ddmmyyyy] || null;
}

/** Wszystkie dni miesiąca (DD.MM.RRRR) */
export function daysOfMonth(monthKey: string): string[] {
  const [y, m] = monthKey.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${pad(i + 1)}.${pad(m)}.${y}`);
}
