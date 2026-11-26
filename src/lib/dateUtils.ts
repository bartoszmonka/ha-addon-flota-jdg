/**
 * Narzędzia do obsługi dat z bezwzględnym formatowaniem DD.MM.RRRR
 */

export const POLISH_MONTHS = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień'
];

export const POLISH_MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia'
];

/**
 * Formatuje obiekt Date do formatu DD.MM.RRRR
 */
export function formatDateDDMMYYYY(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/**
 * Zwraca dzisiejszą datę w formacie DD.MM.RRRR
 */
export function getTodayDDMMYYYY(): string {
  return formatDateDDMMYYYY(new Date());
}

/**
 * Parsuje string DD.MM.RRRR do obiektu Date
 */
export function parseDateDDMMYYYY(str: string): Date | null {
  if (!str) return null;
  const parts = str.split('.');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

/**
 * Konwertuje format ISO YYYY-MM-DD (np. z input type="date") do DD.MM.RRRR
 */
export function isoToDDMMYYYY(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Konwertuje format DD.MM.RRRR do ISO YYYY-MM-DD dla <input type="date">
 */
export function ddmmyyyyToIso(ddmmyyyy: string): string {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('.');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * Zwraca klucz miesiąca w formacie YYYY-MM z daty DD.MM.RRRR
 */
export function getMonthKeyFromDDMMYYYY(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('.');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}`;
}

/**
 * Zwraca polską nazwę miesiąca (mianownik) z klucza YYYY-MM
 */
export function getPolishMonthName(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return '';
  const monthIndex = parseInt(parts[1], 10) - 1;
  return POLISH_MONTHS[monthIndex] || '';
}

/**
 * Zwraca polską nazwę miesiąca (dopełniacz) z klucza YYYY-MM (np. "sierpnia 2023")
 */
export function getPolishMonthNameGenitive(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return '';
  const monthIndex = parseInt(parts[1], 10) - 1;
  return POLISH_MONTHS_GENITIVE[monthIndex] || '';
}

/**
 * Zwraca pierwszy i ostatni dzień danego miesiąca w formacie DD.MM.RRRR
 */
export function getMonthBounds(monthKey: string): { start: string; end: string } {
  const parts = monthKey.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const lastDay = new Date(year, month, 0).getDate();
  const start = `01.${String(month).padStart(2, '0')}.${year}`;
  const end = `${String(lastDay).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
  return { start, end };
}

/**
 * Oblicza liczbę dni pozostałych do zadanej daty w formacie DD.MM.RRRR
 */
export function getDaysRemaining(targetDateStr?: string): number | null {
  if (!targetDateStr) return null;
  const target = parseDateDDMMYYYY(targetDateStr);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffTime = target.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
