/**
 * Eksport ewidencji do Excela (.xlsx) w układzie dotychczasowego arkusza:
 * jeden arkusz = jeden miesiąc, nazwy arkuszy „sierpień 2023”, kolumny A–H,
 * km liczone formułą (stan przy zwrocie − stan przy udostępnieniu), sumy formułami.
 */

import * as XLSX from 'xlsx';
import { formatRoute } from './route';
import { MileageEntry, MonthlyLedger, TaxpayerProfile, Vehicle } from '../types/fleet';
import { taxpayerForMonth } from './address';
import { getMonthBounds, getPolishMonthName, getPolishMonthNameGenitive, parseDateDDMMYYYY } from './dateUtils';

/** Data jako liczba seryjna Excela z formatem dd.mm.rrrr (sortuje się i filtruje jak data) */
function toExcelDate(ddmmyyyy: string): XLSX.CellObject | string {
  const d = parseDateDDMMYYYY(ddmmyyyy);
  if (!d) return ddmmyyyy;
  const serial = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  return { t: 'n', v: serial, z: 'dd\\.mm\\.yyyy', w: ddmmyyyy };
}

interface ExportExcelOptions {
  vehicle: Vehicle;
  taxpayer: TaxpayerProfile;
  monthKey: string;
  entries: MileageEntry[];
  ledger?: MonthlyLedger;
}

const COLS = [{ wch: 9 }, { wch: 12 }, { wch: 48 }, { wch: 48 }, { wch: 13 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 34 }];

function sheetName(monthKey: string) {
  return `${getPolishMonthName(monthKey)} ${monthKey.slice(0, 4)}`.slice(0, 31);
}

function buildMonthSheet(o: ExportExcelOptions): XLSX.WorkSheet {
  const { vehicle, monthKey, entries, ledger } = o;
  const taxpayer = taxpayerForMonth(o.taxpayer, monthKey); // adres obowiązujący w tym miesiącu
  const bounds = getMonthBounds(monthKey);
  const monthName = getPolishMonthName(monthKey);
  const monthNameGen = getPolishMonthNameGenitive(monthKey);
  const year = Number(monthKey.slice(0, 4));
  const startOdometer = ledger?.startOdometer ?? (entries[0]?.odometerStart ?? vehicle.initialOdometer);
  const taxpayerLine = [taxpayer.companyName, taxpayer.address, taxpayer.nip ? `NIP ${taxpayer.nip}` : ''].filter(Boolean).join(', ');

  const rows: any[][] = [
    ['', '', '', '', '', '', `nr strony ${ledger?.pageNumber || 1}`],
    [taxpayerLine, '', '', '', '', '', `Dzień rozpoczęcia prowadzenia ewidencji ${ledger?.startDate || bounds.start}`],
    ['Dane podatnika (nazwisko, imię/ nazwa, adres prowadzonej działalności, NIP)', '', '', '', '', '', `Dzień zakończenia prowadzenia ewidencji ${ledger?.endDate || bounds.end}`],
    [],
    [`Numer rejestracyjny pojazdu samochodowego ${vehicle.registrationNumber}`],
    ['Stan licznika przebiegu pojazdu na dzień rozpoczęcia prowadzenia ewidencji', '', '', '', startOdometer, 'km'],
    ['Stan licznika przebiegu pojazdu na dzień zakończenia prowadzenia ewidencji', '', '', '', null, 'km'], // formuła niżej
    [],
    ['', '', '', 'EWIDENCJA PRZEBIEGU POJAZDU DLA CELÓW VAT'],
    ['', '', '', 'za miesiąc', monthName, 'roku', year],
    [],
    ['Stan licznika', startOdometer, `na początek miesiąca ${monthName} ${year}`],
    [],
    [
      'Nr kolejny wpisu',
      'Data wyjazdu/ udostępnienia',
      'Opis trasy wyjazdu (skąd-dokąd)',
      'Cel wyjazdu/ udostępnienia pojazdu',
      'Liczba faktycznie przejechanych kilometrów',
      'Imię i nazwisko osoby kierującej pojazdem/ osoby której udostępniony został pojazd',
      'Stan licznika na dzień udostępnienia pojazdu',
      'Stan licznika na dzień zwrotu pojazdu',
      'Dowody celowości (dokumenty / załączniki)',
    ],
  ];
  const firstDataRow = rows.length + 1; // numeracja Excela od 1
  entries.forEach((e, i) => {
    const r = firstDataRow + i;
    const docs = [e.documentReferences, ...(e.attachments || []).map((a) => a.name)].filter(Boolean).join('; ');
    rows.push([
      `${i + 1}.`,
      toExcelDate(e.date),
      formatRoute(e.routeDescription),
      e.purposeDescription,
      { f: `H${r}-G${r}`, v: e.distanceKm, t: 'n' },
      e.driverName,
      e.odometerStart,
      e.odometerEnd,
      docs,
    ]);
  });
  const lastDataRow = firstDataRow + Math.max(entries.length, 1) - 1;
  rows.push([]);
  const sumRow = rows.length + 1;
  const total = entries.reduce((s, e) => s + e.distanceKm, 0);
  rows.push(['', '', '', 'Podsumowanie strony', { f: `SUM(E${firstDataRow}:E${lastDataRow})`, v: total, t: 'n' }]);
  rows.push(['', '', '', 'Z przeniesienia', { f: `B12`, v: startOdometer, t: 'n' }]);
  rows.push(['', '', '', 'Razem', { f: `E${sumRow}+E${sumRow + 1}`, v: startOdometer + total, t: 'n' }]);
  rows.push([]);
  rows.push(['Stan licznika', { f: `E${sumRow + 2}`, v: startOdometer + total, t: 'n' }, `na koniec miesiąca ${monthNameGen} ${year}`]);
  rows.push([]);
  rows.push(['', '', '', '', '', '', 'Podpis podatnika . . . . . . . . . . . . . . . . . . . .']);

  // stan na koniec w nagłówku = Razem
  rows[6][4] = { f: `E${sumRow + 2}`, v: startOdometer + total, t: 'n' };

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = COLS;
  ws['!merges'] = [
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 5 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } },
    { s: { r: 6, c: 0 }, e: { r: 6, c: 3 } },
  ];
  ws['!autofilter'] = { ref: `A${firstDataRow - 1}:I${lastDataRow}` };
  return ws;
}

export function exportMonthToExcel(options: ExportExcelOptions) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildMonthSheet(options), sheetName(options.monthKey));
  XLSX.writeFile(wb, `Ewidencja_VAT_${options.vehicle.registrationNumber}_${options.monthKey}.xlsx`);
}

export function exportAllMonthsToExcel(
  vehicle: Vehicle,
  taxpayer: TaxpayerProfile,
  allMonthsEntries: Record<string, MileageEntry[]>,
  ledgers: Record<string, MonthlyLedger>
) {
  const wb = XLSX.utils.book_new();
  const keys = Object.keys(allMonthsEntries).sort();

  const summary: any[][] = [
    ['ZESTAWIENIE EWIDENCJI PRZEBIEGU POJAZDU DLA CELÓW VAT'],
    [`Pojazd: ${vehicle.registrationNumber} (${vehicle.brand} ${vehicle.model})`],
    [`Podatnik: ${taxpayer.companyName}${taxpayer.nip ? `, NIP ${taxpayer.nip}` : ''}`],
    [],
    ['Nr strony', 'Miesiąc', 'Stan na początek (km)', 'Przejechano (km)', 'Stan na koniec (km)', 'Liczba wpisów', 'Status'],
  ];
  let total = 0;
  keys.forEach((k) => {
    const l = ledgers[k];
    const list = allMonthsEntries[k] || [];
    const km = list.reduce((s, e) => s + e.distanceKm, 0);
    total += km;
    summary.push([
      l?.pageNumber ?? '',
      sheetName(k),
      l?.startOdometer ?? list[0]?.odometerStart ?? '',
      km,
      l?.endOdometer ?? list[list.length - 1]?.odometerEnd ?? '',
      list.length,
      l?.isClosed ? 'zamknięty' : 'otwarty',
    ]);
  });
  summary.push([]);
  summary.push(['', 'RAZEM', '', total]);
  const ss = XLSX.utils.aoa_to_sheet(summary);
  ss['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ss, 'Podsumowanie');

  keys.forEach((k) => {
    XLSX.utils.book_append_sheet(
      wb,
      buildMonthSheet({ vehicle, taxpayer, monthKey: k, entries: allMonthsEntries[k] || [], ledger: ledgers[k] }),
      sheetName(k)
    );
  });
  XLSX.writeFile(wb, `Ewidencja_VAT_${vehicle.registrationNumber}_calosc.xlsx`);
}
