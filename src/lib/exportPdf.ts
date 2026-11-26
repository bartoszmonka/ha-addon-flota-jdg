/**
 * Wydruk PDF ewidencji przebiegu pojazdu dla celów VAT – w układzie wzoru z arkusza Excel.
 *
 * Wbudowane czcionki jsPDF (helvetica) nie mają polskich znaków (ą, ę, ł, ś, ż…),
 * dlatego dołączamy DejaVu Sans (public/fonts, podzbiór Latin + Latin Extended-A).
 */

import jsPDF from 'jspdf';
import { formatRoute } from './route';
import autoTable from 'jspdf-autotable';
import { MileageEntry, MonthlyLedger, TaxpayerProfile, Vehicle } from '../types/fleet';
import { taxpayerForMonth } from './address';
import { getMonthBounds, getPolishMonthName, getPolishMonthNameGenitive } from './dateUtils';

const FONT = 'DejaVuSans';
let fontCache: { regular: string; bold: string } | null = null;

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nie udało się wczytać czcionki ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function createDoc(): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  if (!fontCache) {
    const base = (import.meta as any).env?.BASE_URL || '/';
    const [regular, bold] = await Promise.all([
      fetchBase64(`${base}fonts/DejaVuSans.ttf`),
      fetchBase64(`${base}fonts/DejaVuSans-Bold.ttf`),
    ]);
    fontCache = { regular, bold };
  }
  doc.addFileToVFS('DejaVuSans.ttf', fontCache.regular);
  doc.addFont('DejaVuSans.ttf', FONT, 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontCache.bold);
  doc.addFont('DejaVuSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  return doc;
}

interface MonthPageOptions {
  vehicle: Vehicle;
  taxpayer: TaxpayerProfile;
  monthKey: string;
  entries: MileageEntry[];
  ledger?: MonthlyLedger;
}

const fmt = (n: number) => n.toLocaleString('pl-PL');

/** Rysuje jeden miesiąc (jedną „stronę” ewidencji – przy wielu wpisach może zająć kilka kartek) */
function drawMonth(doc: jsPDF, o: MonthPageOptions) {
  const { vehicle, monthKey, entries, ledger } = o;
  const taxpayer = taxpayerForMonth(o.taxpayer, monthKey); // adres obowiązujący w tym miesiącu
  const bounds = getMonthBounds(monthKey);
  const monthName = getPolishMonthName(monthKey);
  const monthNameGen = getPolishMonthNameGenitive(monthKey);
  const year = Number(monthKey.slice(0, 4));

  const startOdometer = ledger?.startOdometer ?? (entries[0]?.odometerStart ?? vehicle.initialOdometer);
  const totalKm = entries.reduce((sum, e) => sum + (e.distanceKm || 0), 0);
  const endOdometer = ledger?.endOdometer ?? startOdometer + totalKm;

  const taxpayerLine = [taxpayer.companyName, taxpayer.address, taxpayer.nip ? `NIP ${taxpayer.nip}` : '']
    .filter(Boolean)
    .join(', ');

  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(taxpayerLine || 'DANE PODATNIKA', 92), 14, 13);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100);
  doc.text('Dane podatnika (nazwisko, imię/ nazwa, adres prowadzonej działalności, NIP)', 14, 23);
  doc.setTextColor(0);

  doc.setFontSize(8);
  doc.text(`nr strony ${ledger?.pageNumber || 1}`, 196, 13, { align: 'right' });
  doc.text(`Dzień rozpoczęcia prowadzenia ewidencji ${ledger?.startDate || bounds.start}`, 196, 17, { align: 'right' });
  doc.text(`Dzień zakończenia prowadzenia ewidencji ${ledger?.endDate || bounds.end}`, 196, 21, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setFont(FONT, 'bold');
  doc.text(`Numer rejestracyjny pojazdu samochodowego: ${vehicle.registrationNumber}`, 14, 31);
  doc.setFont(FONT, 'normal');
  doc.text('Stan licznika przebiegu pojazdu na dzień rozpoczęcia prowadzenia ewidencji', 14, 36);
  doc.text(`${fmt(startOdometer)} km`, 196, 36, { align: 'right' });
  doc.text('Stan licznika przebiegu pojazdu na dzień zakończenia prowadzenia ewidencji', 14, 41);
  doc.text(`${fmt(endOdometer)} km`, 196, 41, { align: 'right' });

  doc.setFont(FONT, 'bold');
  doc.setFontSize(12);
  doc.text('EWIDENCJA PRZEBIEGU POJAZDU DLA CELÓW VAT', 105, 51, { align: 'center' });
  doc.setFontSize(9.5);
  doc.setFont(FONT, 'normal');
  doc.text(`za miesiąc ${monthName} roku ${year}`, 105, 57, { align: 'center' });
  doc.setFontSize(8.5);
  doc.text(`Stan licznika ${fmt(startOdometer)} na początek miesiąca`, 14, 64);

  const body = entries.map((entry, idx) => {
    const docs = [
      entry.documentReferences,
      (entry.attachments || []).length ? `załączniki: ${(entry.attachments || []).map((a) => a.name).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return [
      `${idx + 1}.`,
      entry.date,
      formatRoute(entry.routeDescription),
      entry.purposeDescription + (docs ? `\n[${docs}]` : ''),
      String(entry.distanceKm),
      entry.driverName,
      `${entry.odometerStart}\n${entry.odometerEnd}`,
    ];
  });

  autoTable(doc, {
    startY: 67,
    head: [[
      'Nr\nkolejny\nwpisu',
      'Data\nwyjazdu/\nudostęp.',
      'Opis trasy wyjazdu (skąd-dokąd)',
      'Cel wyjazdu/ udostępnienia pojazdu',
      'Liczba\nfaktycznie\nprzejech.\nkm',
      'Imię i nazwisko osoby kierującej pojazdem',
      'Stan licznika\nw dniu\nudostępn./\nzwrotu',
    ]],
    body,
    theme: 'grid',
    styles: { font: FONT, fontSize: 7, cellPadding: 1.6, textColor: 20, lineColor: [120, 120, 120], lineWidth: 0.15, valign: 'middle' },
    headStyles: { font: FONT, fillColor: [242, 242, 242], textColor: 0, fontStyle: 'bold', halign: 'center', fontSize: 6.2, cellPadding: 1 },
    rowPageBreak: 'avoid',
    columnStyles: {
      // suma = 182 mm (A4 210 mm − marginesy 2 × 14 mm)
      0: { cellWidth: 11, halign: 'center' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 48 },
      3: { cellWidth: 47 },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 23, halign: 'center' },
      6: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: 14, right: 14, top: 14 },
  });

  let y = ((doc as any).lastAutoTable?.finalY || 180) + 4;
  if (y > 245) {
    doc.addPage();
    y = 20;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 100, right: 14 },
    theme: 'grid',
    styles: { font: FONT, fontSize: 8, cellPadding: 1.5, lineColor: [120, 120, 120], lineWidth: 0.15 },
    body: [
      ['Podsumowanie strony', fmt(totalKm)],
      ['Z przeniesienia', fmt(startOdometer)],
      ['Razem', fmt(endOdometer)],
    ],
    columnStyles: { 0: { cellWidth: 66, fontStyle: 'bold' }, 1: { cellWidth: 30, halign: 'center', fontStyle: 'bold' } },
  });

  const after = (doc as any).lastAutoTable?.finalY || y + 20;
  doc.setFontSize(8.5);
  doc.setFont(FONT, 'normal');
  doc.text(`Stan licznika ${fmt(endOdometer)} na koniec miesiąca ${monthNameGen} ${year}`, 14, after + 8);
  doc.text('Podpis podatnika ........................................................', 196, after + 18, { align: 'right' });
}

export async function generateVatMileagePdf(options: MonthPageOptions): Promise<jsPDF> {
  const doc = await createDoc();
  drawMonth(doc, options);
  return doc;
}

export async function downloadVatMileagePdf(options: MonthPageOptions, filename?: string) {
  const doc = await generateVatMileagePdf(options);
  doc.save(filename || `Ewidencja_VAT_${options.vehicle.registrationNumber}_${options.monthKey}.pdf`);
}

/** Cała ewidencja w jednym pliku PDF – każdy miesiąc od nowej kartki */
export async function downloadFullRegisterPdf(o: {
  vehicle: Vehicle;
  taxpayer: TaxpayerProfile;
  months: string[];
  entries: MileageEntry[];
  ledgers: Record<string, MonthlyLedger>;
}) {
  const doc = await createDoc();
  o.months.forEach((mKey, i) => {
    if (i > 0) doc.addPage();
    drawMonth(doc, {
      vehicle: o.vehicle,
      taxpayer: o.taxpayer,
      monthKey: mKey,
      entries: o.entries.filter((e) => e.monthKey === mKey),
      ledger: o.ledgers[mKey],
    });
  });
  const first = o.months[0] || '';
  const last = o.months[o.months.length - 1] || '';
  doc.save(`Ewidencja_VAT_${o.vehicle.registrationNumber}_${first}_${last}.pdf`);
}
