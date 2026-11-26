/**
 * Import dotychczasowej ewidencji z pliku Excel (format „Ewidencja przebiegu pojazdu dla celów VAT.xlsx”):
 * jeden arkusz na miesiąc, wpis zajmuje dwa wiersze, w kolumnie G stan licznika
 * przy udostępnieniu (wiersz 1) i przy zwrocie (wiersz 2).
 *
 * Importer niczego nie zmienia po cichu: każda wykryta nieprawidłowość jest pokazana
 * w podglądzie, a wiersz można wykluczyć lub zostawić.
 */

import * as XLSX from 'xlsx';
import { checkXlsxBuffer } from './fileSafety';
import { AddressPeriod, MileageEntryInput } from '../types/fleet';
import { EARLIEST, parseAddress } from './address';
import { POLISH_MONTHS } from './dateUtils';

export interface ImportRow {
  key: string;
  sheet: string;
  sheetMonthKey: string | null;
  lp: string;
  date: string; // DD.MM.RRRR (po ewentualnej korekcie)
  originalDate: string;
  route: string;
  purpose: string;
  driver: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  km: number | null;
  include: boolean;
  issues: string[];
  /** brak daty w pliku – użytkownik musi ją wpisać w podglądzie */
  needsDate?: boolean;
  /** podpowiedź zakresu dat (sąsiednie wpisy) */
  dateHint?: string;
  /** dozwolony zakres daty (DD.MM.RRRR) – między sąsiednimi wpisami, w miesiącu arkusza */
  dateMin?: string;
  dateMax?: string;
}

export interface ImportPreview {
  taxpayerLine: string | null;
  /** nazwa firmy z nagłówka (część przed pierwszym przecinkiem) */
  companyName: string | null;
  /** adresy z nagłówków arkuszy – zmiana adresu między miesiącami tworzy nowy okres */
  addressHistory: AddressPeriod[];
  plate: string | null;
  initialOdometer: number | null;
  firstDate: string | null;
  rows: ImportRow[];
  sheets: { name: string; monthKey: string | null; rows: number; km: number; issues: number }[];
  warnings: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function cellValue(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : undefined;
}
function cellText(ws: XLSX.WorkSheet, r: number, c: number): string {
  const v = cellValue(ws, r, c);
  return v === undefined || v === null ? '' : String(v).trim();
}
function cellNumber(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const v = cellValue(ws, r, c);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
  return null;
}
function cellDate(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const v = cellValue(ws, r, c);
  if (typeof v === 'number') {
    // numer seryjny daty Excela (system 1900) → data w UTC, bez przesunięć strefy czasowej
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    if (d.getUTCFullYear() > 1990) return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
    if (m) return `${pad(Number(m[1]))}.${pad(Number(m[2]))}.${m[3]}`;
  }
  if (v instanceof Date) return `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()}`;
  return null;
}

/** „sierpień 2023”, „Grudzień 2023”, „Luty 2025” → „2023-08” */
export function monthKeyFromSheetName(name: string): string | null {
  const m = name.trim().toLowerCase().match(/^([a-ząćęłńóśźż]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = POLISH_MONTHS.indexOf(m[1]);
  return idx >= 0 ? `${m[2]}-${pad(idx + 1)}` : null;
}

const monthOf = (ddmmyyyy: string) => `${ddmmyyyy.slice(6, 10)}-${ddmmyyyy.slice(3, 5)}`;

export async function parseRegisterXlsx(file: File | ArrayBuffer): Promise<ImportPreview> {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  // zabezpieczenie przed podstawionym plikiem (biblioteka xlsx 0.18 ma znane podatności na złośliwe pliki)
  checkXlsxBuffer(buf);
  const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, bookVBA: false, sheetRows: 5000 });
  const rows: ImportRow[] = [];
  const warnings: string[] = [];
  let taxpayerLine: string | null = null;
  let plate: string | null = null;
  let initialOdometer: number | null = null;
  let missingValues = 0;
  const sheetAddresses: { monthKey: string | null; line: string }[] = [];

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    const ws = wb.Sheets[sheetName];
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const sheetMonthKey = monthKeyFromSheetName(sheetName);
    let headerRow = -1;

    for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
      const a = cellText(ws, r, 0);
      if (a.startsWith('Nr kolejny')) {
        headerRow = r;
        break;
      }
      if (/^Dane podatnika/i.test(a) && r > 0) {
        const line = cellText(ws, r - 1, 0);
        if (line) {
          if (!taxpayerLine) taxpayerLine = line;
          sheetAddresses.push({ monthKey: sheetMonthKey, line });
        }
      }
      const reg = a.match(/Numer rejestracyjny pojazdu samochodowego\s+(\S+)/i);
      if (reg && !plate) plate = reg[1].toUpperCase();
      if (sheetIdx === 0 && /^Stan licznika przebiegu pojazdu na dzień rozpoczęcia/i.test(a) && initialOdometer === null) {
        initialOdometer = cellNumber(ws, r, 4);
      }
    }
    if (headerRow < 0) {
      warnings.push(`Arkusz „${sheetName}”: nie znaleziono nagłówka tabeli – pominięty.`);
      return;
    }

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const lp = cellText(ws, r, 0);
      if (!/^\d+\.?$/.test(lp)) continue;
      const date = cellDate(ws, r, 1);
      const route = cellText(ws, r, 2);
      const purpose = cellText(ws, r, 3);
      if (!date && !route && !purpose) continue; // pusty wiersz szablonu

      const odometerStart = cellNumber(ws, r, 6);
      let odometerEnd = cellNumber(ws, r + 1, 6);
      const km = cellNumber(ws, r, 4);
      if (odometerEnd === null && odometerStart !== null && km !== null) odometerEnd = odometerStart + km;
      if (odometerStart === null || odometerEnd === null) missingValues++;

      const issues: string[] = [];
      let finalDate = date || '';
      if (!date) issues.push('Brak daty w pliku – wpisz ją w podglądzie (nie zgadujemy).');
      if (date && sheetMonthKey && monthOf(date) !== sheetMonthKey) {
        const [sy, sm] = sheetMonthKey.split('-');
        if (date.slice(3, 5) === sm && date.slice(6) !== sy) {
          finalDate = `${date.slice(0, 6)}${sy}`;
          issues.push(`Data ${date} ma rok inny niż arkusz – poprawiono na ${finalDate}.`);
        } else {
          issues.push(`Data ${date} nie należy do miesiąca arkusza (${sheetName}).`);
        }
      }
      rows.push({
        key: `${sheetIdx}-${r}`,
        sheet: sheetName,
        sheetMonthKey,
        lp,
        date: finalDate,
        originalDate: date || '',
        route,
        purpose,
        driver: cellText(ws, r, 5),
        odometerStart,
        odometerEnd,
        km: odometerStart !== null && odometerEnd !== null ? odometerEnd - odometerStart : km,
        include: true,
        issues,
        needsDate: !date,
      });
    }
  });

  if (missingValues) {
    warnings.push(
      `W ${missingValues} wierszach brakuje wyliczonych stanów licznika (plik zapisany bez wartości formuł). Otwórz plik w Excelu, zapisz go ponownie i zaimportuj jeszcze raz.`
    );
  }

  // Duplikaty: wpis z datą spoza miesiąca arkusza, identyczny (data + trasa) z wpisem w innym arkuszu
  const signature = (r: ImportRow) => `${r.originalDate}|${r.route.toLowerCase()}`;
  const bySig = new Map<string, ImportRow[]>();
  rows.forEach((r) => bySig.set(signature(r), [...(bySig.get(signature(r)) || []), r]));
  rows.forEach((r) => {
    const outOfMonth = r.sheetMonthKey && r.originalDate && monthOf(r.originalDate) !== r.sheetMonthKey;
    const twin = (bySig.get(signature(r)) || []).find((o) => o !== r && o.sheet !== r.sheet);
    if (outOfMonth && twin) {
      r.include = false;
      r.issues.push(`Kopia wpisu z arkusza „${twin.sheet}” (ta sama data i trasa) – wykluczony z importu.`);
    }
  });

  // Arkusz-szablon: wszystkie wpisy spoza miesiąca arkusza i co najmniej jedna kopia → wyklucz cały arkusz
  const bySheet = new Map<string, ImportRow[]>();
  rows.forEach((r) => bySheet.set(r.sheet, [...(bySheet.get(r.sheet) || []), r]));
  bySheet.forEach((list, name) => {
    const allOut = list.every((r) => r.sheetMonthKey && r.originalDate && monthOf(r.originalDate) !== r.sheetMonthKey);
    if (allOut && list.some((r) => !r.include)) {
      list.forEach((r) => {
        if (r.include) {
          r.include = false;
          r.issues.push(`Arkusz „${name}” wygląda na skopiowany szablon poprzedniego miesiąca – wiersz wykluczony.`);
        }
      });
      warnings.push(`Arkusz „${name}” zawiera wyłącznie wpisy z innego miesiąca (kopia szablonu) – pominięty.`);
    }
  });

  // Podpowiedź daty dla wierszy bez daty
  rows.forEach((r, i) => {
    if (!r.needsDate) return;
    const prev = rows.slice(0, i).reverse().find((x) => x.date && x.include);
    const next = rows.slice(i + 1).find((x) => x.date && x.include);
    r.dateHint = [prev?.date, next?.date].filter(Boolean).join(' – ');
    const [sy, sm] = (r.sheetMonthKey || '').split('-').map(Number);
    if (sy && sm) {
      const first = `01.${pad(sm)}.${sy}`;
      const last = `${pad(new Date(sy, sm, 0).getDate())}.${pad(sm)}.${sy}`;
      const inSheet = (d?: string) => (d && monthOf(d) === r.sheetMonthKey ? d : undefined);
      r.dateMin = inSheet(prev?.date) || first;
      r.dateMax = inSheet(next?.date) || last;
    }
  });

  // Ciągłość licznika i dodatnie km (po wykluczeniach)
  let prevEnd: number | null = initialOdometer;
  rows.forEach((r) => {
    if (!r.include) return;
    if (r.odometerStart === null || r.odometerEnd === null) {
      r.include = false;
      r.issues.push('Brak stanu licznika – wiersz pominięty.');
      return;
    }
    if (prevEnd !== null && r.odometerStart !== prevEnd) {
      r.issues.push(`Licznik przy wyjeździe ${r.odometerStart} km ≠ stan po poprzednim wpisie ${prevEnd} km. W aplikacji liczy się ciągłość, więc km tego wpisu wyniosą ${r.odometerEnd - prevEnd}.`);
    }
    if (r.odometerEnd <= (prevEnd ?? r.odometerStart)) {
      r.issues.push('Stan licznika po powrocie nie rośnie – sprawdź wiersz.');
    }
    if (!r.route || !r.purpose) r.issues.push('Brak trasy lub celu wyjazdu.');
    prevEnd = r.odometerEnd;
  });

  const firstIncluded = rows.find((r) => r.include);
  const sheets = wb.SheetNames.map((name) => {
    const list = rows.filter((r) => r.sheet === name);
    const inc = list.filter((r) => r.include);
    return {
      name,
      monthKey: monthKeyFromSheetName(name),
      rows: inc.length,
      km: inc.reduce((s, r) => s + (r.km || 0), 0),
      issues: list.filter((r) => r.issues.length).length,
    };
  });

  // historia adresów: nagłówek „FIRMA, ulica, kod miasto[, NIP …]” – liczy się część po nazwie firmy
  const addressHistory: AddressPeriod[] = [];
  const splitLine = (line: string) => {
    const noNip = line.replace(/,?\s*NIP[:\s].*$/i, '');
    const idx = noNip.indexOf(',');
    return { company: idx > 0 ? noNip.slice(0, idx).trim() : noNip.trim(), address: idx > 0 ? noNip.slice(idx + 1).trim() : '' };
  };
  sheetAddresses.forEach(({ monthKey, line }) => {
    const parsed = parseAddress(splitLine(line).address);
    const last = addressHistory[addressHistory.length - 1];
    const same =
      last &&
      last.street.toLowerCase().replace(/\s+/g, '') === parsed.street.toLowerCase().replace(/\s+/g, '') &&
      last.postalCode === parsed.postalCode;
    if (!same && parsed.street) {
      addressHistory.push({
        id: `addr_imp_${addressHistory.length}`,
        ...parsed,
        validFrom: addressHistory.length === 0 ? EARLIEST : monthKey || EARLIEST,
      });
    }
  });

  return {
    taxpayerLine,
    companyName: taxpayerLine ? splitLine(taxpayerLine).company : null,
    addressHistory,
    plate,
    initialOdometer: initialOdometer ?? firstIncluded?.odometerStart ?? null,
    firstDate: firstIncluded?.date || null,
    rows,
    sheets,
    warnings,
  };
}

/** Wiersze gotowe do zapisu (kolejność w obrębie dnia = kolejność w pliku) */
export function toEntryInputs(preview: ImportPreview, defaultDriver: string): MileageEntryInput[] {
  return preview.rows
    .filter((r) => r.include && r.odometerEnd !== null && r.date)
    .map((r, i) => ({
      date: r.date,
      routeDescription: r.route,
      purposeDescription: r.purpose,
      driverName: r.driver || defaultDriver,
      odometerEnd: r.odometerEnd as number,
      seq: i,
      source: 'import' as const,
    }));
}

const isoOf = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

/**
 * Kontrola tuż przed zapisem (po zmianach w podglądzie): data uzupełniona ręcznie musi mieścić się
 * między sąsiednimi wpisami, a licznik musi rosnąć wpis po wpisie. Zwraca listę błędów.
 */
export function checkBeforeImport(preview: ImportPreview, initialOdometer: number): string[] {
  const errors: string[] = [];
  preview.rows.forEach((r) => {
    if (!r.include || !r.needsDate || !r.date) return;
    if ((r.dateMin && isoOf(r.date) < isoOf(r.dateMin)) || (r.dateMax && isoOf(r.date) > isoOf(r.dateMax))) {
      errors.push(`${r.sheet}, wpis ${r.lp}: data ${r.date} musi być między ${r.dateMin} a ${r.dateMax}.`);
    }
  });
  const inputs = toEntryInputs(preview, '-');
  const sorted = inputs
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => (isoOf(a.date) === isoOf(b.date) ? (a.seq ?? 0) - (b.seq ?? 0) : isoOf(a.date) < isoOf(b.date) ? -1 : 1));
  let prev = initialOdometer;
  sorted.forEach((e) => {
    if (e.odometerEnd <= prev) {
      errors.push(`Wpis z ${e.date} („${e.routeDescription.slice(0, 40)}”): licznik ${e.odometerEnd} km nie jest większy niż poprzedni ${prev} km – sprawdź datę.`);
    }
    prev = e.odometerEnd;
  });
  return errors.slice(0, 10);
}
