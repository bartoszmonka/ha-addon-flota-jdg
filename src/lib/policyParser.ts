/**
 * Odczyt danych z tekstu polisy komunikacyjnej (PL): ubezpieczyciel, numer, okres,
 * OC / AC / NNW (każde osobno, może go nie być), składki, sumy, dodatkowe ochrony i warunki.
 * Działa na tekście z PDF (warstwa tekstowa albo OCR skanu). Wynik to propozycja –
 * użytkownik sprawdza ją przed zapisaniem.
 */

import { CoverKind } from '../types/fleet';

export interface ParsedCover {
  found: boolean;
  from?: string;
  to?: string;
  premium?: number;
  sumInsured?: number;
  /** np. „minimalna ustawowa”, „netto” */
  sumNote?: string;
  /** np. wariant AC „serwisowy” */
  variant?: string;
  snippet?: string;
}

export interface PolicyInfo {
  label: string;
  value: string;
}

export interface ParsedPolicy {
  insurer?: string;
  policyNumber?: string;
  from?: string;
  to?: string;
  vin?: string;
  plate?: string;
  brand?: string;
  model?: string;
  productionYear?: number;
  fuelType?: string;
  firstRegistrationDate?: string;
  premiumTotal?: number;
  covers: Record<CoverKind, ParsedCover>;
  extras: string[];
  conditions: string[];
  installments?: string;
  /** pozostałe przydatne dane: ubezpieczony (leasing), data zawarcia, poprzednia polisa, sumy gwarancyjne OC… */
  info: PolicyInfo[];
  warnings: string[];
}

// nazwa → wzorce (także typowe przekłamania OCR, np. „Hesla”, „Heslia” zamiast „Hestia”)
const INSURERS: [string, RegExp][] = [
  ['Ergo Hestia', /ergo\s*he[s5][tl1]?[il1]?[ae]|\bhestii?\b|ergohestia/gi],
  ['PZU', /\bPZU\b/g],
  ['Warta', /\bwarta\b/gi],
  ['Allianz', /\ballianz\b/gi],
  ['Generali', /\bgenerali\b/gi],
  ['Uniqa', /\buniqa\b/gi],
  ['Link4', /\blink\s?4\b/gi],
  ['Proama', /\bproama\b/gi],
  ['Compensa', /\bcompensa\b/gi],
  ['InterRisk', /\binter\s?risk\b/gi],
  ['Wiener', /\bwiener\b/gi],
  ['Trasti', /\btrasti\b/gi],
  ['TUZ', /\bTUZ\b/g],
  ['Balcia', /\bbalcia\b/gi],
  ['Benefia', /\bbenefia\b/gi],
  ['Beesafe', /\bbeesafe\b/gi],
  ['MTU', /\bMTU\b|mtu24/gi],
  ['You Can Drive', /you\s*can\s*drive/gi],
  ['Aviva', /\baviva\b/gi],
  ['AXA', /\bAXA\b/g],
  ['Saltus', /\bsaltus\b/gi],
  ['Euroins', /\beuroins\b/gi],
  ['Wefox', /\bwefox\b/gi],
  ['TUW TUZ', /\bTUW\b/g],
];

/** ubezpieczyciel: najpierw jawne „Nazwa Towarzystwa Ubezpieczeń: …”, potem najczęściej występująca nazwa */
function findInsurer(flat: string): string | undefined {
  const explicit = flat.match(/(?:nazwa\s+towarzystwa\s+ubezpiecze[ńn]|ubezpieczyciel)\s*[:.]\s*([^\n]{3,60})/i)?.[1];
  if (explicit) {
    const hit = INSURERS.find(([, re]) => new RegExp(re.source, re.flags.replace('g', '')).test(explicit));
    if (hit) return hit[0];
  }
  let best: { name: string; n: number } | undefined;
  for (const [name, re] of INSURERS) {
    const n = (flat.match(re) || []).length;
    if (n && (!best || n > best.n)) best = { name, n };
  }
  return best?.name;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** wszystkie daty w tekście → DD.MM.RRRR (obsługa 04.08.2025, 2025-08-04, 04-08-2025, 04/08/2025) */
export function findDates(s: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b|\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [d, mo, y] = m[1] ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[6]), Number(m[5]), Number(m[4])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100) out.push(`${pad(d)}.${pad(mo)}.${y}`);
  }
  return out;
}

/** kwoty: „1 234,56 zł”, „1234.56 PLN”, „1.234,00 zł” */
export function findAmounts(s: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[ \u00a0.]\d{3})+|\d+)(?:[,.](\d{2}))?\s*(?:z[łl](?:otych|ote|oty)?|PLN)(?!\p{L})/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const whole = m[1].replace(/[ \u00a0.]/g, '');
    out.push(Number(`${whole}.${m[2] || '00'}`));
  }
  return out;
}

const iso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

/** okres „od … do …” w fragmencie tekstu */
function findPeriod(s: string): { from?: string; to?: string } {
  const m = s.match(/od\s*(?:dnia)?\s*([\d.\-/]{8,10})(?:\s*(?:r\.|roku))?[^\d]{0,30}?do\s*(?:dnia)?\s*([\d.\-/]{8,10})/i);
  if (m) {
    const a = findDates(m[1])[0];
    const b = findDates(m[2])[0];
    if (a && b) return { from: a, to: b };
  }
  const ds = findDates(s);
  if (ds.length >= 2) {
    const sorted = [...ds].sort((x, y) => iso(x).localeCompare(iso(y)));
    // okres roczny: dwie daty odległe o ok. rok
    for (let i = 0; i < sorted.length; i++) {
      for (let j = sorted.length - 1; j > i; j--) {
        const days = (new Date(iso(sorted[j])).getTime() - new Date(iso(sorted[i])).getTime()) / 86400000;
        if (days > 300 && days < 400) return { from: sorted[i], to: sorted[j] };
      }
    }
  }
  return {};
}

const COVER_PATTERNS: Record<CoverKind, RegExp> = {
  oc: /\bOC\b|odpowiedzialno\p{L}*\s+c\p{L}{0,3}wiln\p{L}*/iu,
  ac: /\bAC\b|auto\s?cas[ck]o|autocesco/i,
  nnw: /\bNNW\b|nast[ęe]pstw\p{L}*\s+nieszcz\p{L}*\s+wypad/iu,
};
const KINDS: CoverKind[] = ['oc', 'ac', 'nnw'];
/** zaprzeczenie zaraz po nazwie ochrony: „AC: nie obejmuje”, „NNW – brak”, „OC krótkoterminowe: NIE” */
const NEGATION = /^[^a-ząćęłńóśźż]{0,4}(?:\p{L}+\W{0,3})?(nie\b|brak\b|nie\s+(obejmuje|dotyczy|wykupiono|zawarto))|^\s*[-—–]\s*$/iu;
const POSITIVE = /\bTAK\b/;

/** kod OWU w tabeli polisy (np. E-ACD-02/26, E-NNW-01/26) albo podstawa prawna OC */
const OWU_CODE = /\b[A-Z]{1,3}[-.][A-Z]{2,4}[-.]\d{2}\s?[/.]\s?\d{2}\b|ustawa\s+dz\.?\s*u/i;

/** liczby z wiersza tabeli (bez dat i kodów): „133 201(Netto) 4 230” → [133201, 4230] */
function rowNumbers(row: string): number[] {
  const cut = row.split(OWU_CODE)[0]
    .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}/g, ' ')
    .replace(/\b\d+\s*m-?cy\b|\b\d+\s*miesi\p{L}*/giu, ' ')
    .replace(/[()]/g, ' ');
  const out: number[] = [];
  const re = /(?<![\d.,/-])(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[,.](\d{2}))?(?![\d/-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut))) {
    const groups = m[1].split(/[ \u00a0]/);
    // „25 000 926” w tabeli to zwykle dwie kolumny (suma 25 000 i składka 926), a nie 25 mln
    if (groups.length >= 3 && !m[2]) {
      out.push(Number(groups.slice(0, -1).join('')), Number(groups[groups.length - 1]));
    } else out.push(Number(`${groups.join('')}.${m[2] || '00'}`));
  }
  return out;
}

const isTableRow = (l: string) => OWU_CODE.test(l) && rowNumbers(l).length > 0;

const EXTRA_PATTERNS: [RegExp, string][] = [
  [/assistance/i, 'Assistance'],
  [/\bszyb(y|a|om)?\b/i, 'Ubezpieczenie szyb'],
  [/ochron\p{L}*\s+(\p{L}+\s+)?zni[żz]k/iu, 'Ochrona utraty zniżki'],
  [/\bopon(y|a)?\b/i, 'Ubezpieczenie opon'],
  [/\bbaga[żz]\p{L}*/iu, 'Ubezpieczenie bagażu'],
  [/pojazd\p{L}* zast[ęe]pcz|auto zast[ęe]pcz|samoch[óo]d\p{L}* zast[ęe]pcz/iu, 'Pojazd zastępczy'],
  [/\bGAP\b/, 'GAP'],
  [/zielona karta/i, 'Zielona Karta'],
  [/ochron\p{L}* prawn/iu, 'Ochrona prawna'],
  [/sta[łl]a suma ubezpieczenia/i, 'Stała suma ubezpieczenia AC'],
];

const CONDITION_KEYWORDS = /(udzia[łl]\p{L}* w[łl]asn|franszyz|wariant|serwisow|kosztorys|\bASO\b|amortyzac|warto[śs][ćc]\p{L}* (rynkow|pojazdu)|wy[łl][ąa]czeni|limit|holowani|urz[ąa]dze\p{L}* zabezpiecz|immobilizer|nie ma(ją)? zastosowania|dopuszcza si[ęe]|obj[ęe]ci\p{L}* ochron|szkod\p{L}* ca[łl]kowit|teren\p{L}* (europ|polski|rp))/iu;
/** formułki zgód i oświadczeń – to nie są warunki ubezpieczenia */
const BOILERPLATE = /(zgadzam si|wyra[żz]am zgod|o[śs]wiadczam|wnioskuj|marketing|dane osobowe|dystrybut|zapozna[łl]em|korespondencj|nośniku|informacji handlow|reklamacj|podpis)/i;

const letterRatio = (l: string) => (l.match(/\p{L}/gu) || []).length / Math.max(1, l.replace(/\s/g, '').length);
const fmt = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });

export function parsePolicyText(raw: string): ParsedPolicy {
  const text = raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const lines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^[\s|:;,'"`>©$£%=_~.\-–—]+(?=\S)/, '')
        // śmieci z marginesu skanu (pionowy napis): „sj s Odpowiedzialność…” → „Odpowiedzialność…”
        .replace(/^(?:[a-ząćęłńóśźż\W\d]{1,2}\s+){1,3}(?=\p{Lu})/u, '')
        .replace(/[\s|]+$/, '')
        .trim()
    )
    .filter((l) => l.length > 1);
  const flat = lines.join('\n');
  const warnings: string[] = [];
  const info: PolicyInfo[] = [];

  const insurer = findInsurer(flat);

  // numer polisy – musi zawierać cyfry; pomijamy „numer poprzedniej polisy”
  const NUM = '([A-Z0-9/\\-.]*\\d[A-Z0-9/\\-.]{4,})';
  const pn =
    flat.match(new RegExp(`(?:nr|numer)\\s*(?:polisy|umowy|dokumentu)\\s*[:.]?\\s*${NUM}`, 'i')) ||
    flat.match(new RegExp(`(?<!poprzedniej\\s)polisa\\s*(?:nr\\.?|numer)?\\s*[:.]?\\s*${NUM}`, 'i')) ||
    flat.match(new RegExp(`${NUM}\\s*\\n?[^\\n]{0,40}\\n?\\s*numer\\s+polisy`, 'i'));
  const policyNumber = pn?.[1]?.replace(/[.,]$/, '');
  const prev = flat.match(/numer\s+poprzedniej\s+polisy\s*[:.]?\s*([A-Z0-9/\-.]*\d[A-Z0-9/\-.]{4,})/i)?.[1];
  if (prev) info.push({ label: 'Poprzednia polisa', value: prev });

  const vin = flat.match(/\bVIN\b[^A-Z0-9]{0,6}([A-HJ-NPR-Z0-9O]{17})\b/i)?.[1]?.toUpperCase() || flat.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)?.[1];
  const plate = flat.match(/(?:nr|numer)\s*rejestr\p{L}*\s*[:.]?\s*([A-Z]{1,3}\s?[A-Z0-9]{3,6})\b/iu)?.[1]?.replace(/\s/g, '').toUpperCase();
  const vehicleMeta = extractVehicleMetadata(flat);

  // okres całej polisy
  const periodLine = lines.findIndex((l) => /okres\s*(ubezpieczenia|ochrony|obowi[ąa]zywania)|zakres\s+ochrony/i.test(l));
  let period = periodLine >= 0 ? findPeriod(lines.slice(periodLine, periodLine + 2).join(' ')) : {};
  if (!period.from) period = findPeriod(flat);

  // składka łączna: „do zapłaty”, „składka łączna”, „Suma:”, „płatność realizowana…: 7 100 zł” – wybieramy najczęstszą kwotę
  const premCandidates = lines
    .filter((l) => /sk[łl]adk\p{L}*\s*(ł[ąa]czn|razem|do zap[łl]aty|ca[łl]kowit)|do\s+zap[łl]aty|kwoty\s+p[łl]atno|realizowana|^suma\b/iu.test(l))
    .flatMap((l) => findAmounts(l));
  const counts = new Map<number, number>();
  premCandidates.forEach((a) => counts.set(a, (counts.get(a) || 0) + 1));
  const premiumTotal = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];

  // OC / AC / NNW – każde osobno; najlepszy jest wiersz tabeli ze składką, potem „AC: TAK”, potem dowolna wzmianka
  const covers = {} as Record<CoverKind, ParsedCover>;
  const usedRows = new Set<number>();
  KINDS.forEach((k) => {
    const idxs = lines.map((l, i) => (COVER_PATTERNS[k].test(l) ? i : -1)).filter((i) => i >= 0);
    const negative = idxs.filter((i) => NEGATION.test(lines[i].split(COVER_PATTERNS[k])[1] || ''));
    const positive = idxs.filter((i) => !negative.includes(i));
    if (!positive.length) {
      covers[k] = { found: false };
      return;
    }
    const others = KINDS.filter((o) => o !== k).map((o) => COVER_PATTERNS[o]);
    const score = (i: number) => {
      const l = lines[i];
      const after = l.split(COVER_PATTERNS[k])[1] || '';
      return (isTableRow(l) ? 10 : 0) + (POSITIVE.test(after.slice(0, 12)) ? 4 : 0) - (others.some((re) => re.test(l)) ? 3 : 0) - (BOILERPLATE.test(l) ? 5 : 0) - l.length / 200;
    };
    const best = [...positive].sort((a, b) => score(b) - score(a))[0];
    const line = lines[best];
    const cover: ParsedCover = { found: true, snippet: line.slice(0, 160) };
    if (isTableRow(line)) {
      usedRows.add(best);
      const nums = rowNumbers(line);
      cover.premium = nums[nums.length - 1];
      if (nums.length >= 2) cover.sumInsured = nums[nums.length - 2];
      if (/minimaln\p{L}*\s+ustawow/iu.test(line)) cover.sumNote = 'minimalna ustawowa';
      if (/netto/i.test(line)) cover.sumNote = 'netto';
      else if (/brutto/i.test(line)) cover.sumNote = 'brutto';
      const variant = line.match(/[-–]\s*([A-ZĄĆĘŁŃÓŚŹŻ]{4,}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ]{3,})?)\b/)?.[1];
      if (variant) cover.variant = variant.charAt(0) + variant.slice(1).toLowerCase();
    } else {
      // opisowy zapis: okno tej linii + maks. 2 kolejne, dopóki nie zaczyna się inna ochrona
      const win = [line];
      for (let j = best + 1; j < Math.min(lines.length, best + 3); j++) {
        if (others.some((re) => re.test(lines[j])) || /sk[łl]adk\p{L}*\s*(ł[ąa]czn|razem|do zap[łl]aty)/iu.test(lines[j])) break;
        win.push(lines[j]);
      }
      const w = win.join(' ');
      const sumM = w.match(/suma\s*ubezpieczenia[^0-9]{0,20}([\d \u00a0.,]+\s*(?:zł|PLN))/i);
      const premM = w.match(/sk[łl]adk\p{L}*[^0-9]{0,20}([\d \u00a0.,]+\s*(?:zł|PLN))/iu);
      if (premM) cover.premium = findAmounts(premM[1])[0];
      if (sumM) cover.sumInsured = findAmounts(sumM[1])[0];
    }
    // własny okres ochrony (jeśli jest w pobliżu)
    const p = findPeriod(lines.slice(best, best + 2).join(' '));
    cover.from = p.from;
    cover.to = p.to;
    covers[k] = cover;
  });

  // dodatkowe ochrony: pozostałe wiersze tabeli (nazwa + suma + składka) oraz słowa kluczowe
  const extras: string[] = [];
  lines.forEach((l, i) => {
    if (usedRows.has(i) || !isTableRow(l) || KINDS.some((k) => COVER_PATTERNS[k].test(l) && !/sta[łl]a suma/i.test(l))) return;
    const name = l.split(OWU_CODE)[0].replace(/[\d\s.,()]+$/g, '').replace(/\s+[-–]\s+/g, ' – ').trim();
    if (name.length < 4 || letterRatio(name) < 0.7 || /^(suma|razem|nazwa)\b/i.test(name)) return;
    const nums = rowNumbers(l);
    const prem = nums[nums.length - 1];
    const sum = nums.length >= 2 ? nums[nums.length - 2] : undefined;
    extras.push(`${name}${sum ? ` (suma ${fmt(sum)} zł)` : ''}${prem ? ` – składka ${fmt(prem)} zł` : ''}`);
  });
  EXTRA_PATTERNS.forEach(([re, n]) => {
    if (re.test(flat) && !extras.some((x) => re.test(x))) extras.push(n);
  });

  // warunki: zdania z kluczowymi słowami, bez formułek zgód; linia kontynuacji (mała litera) dołączana do poprzedniej
  const sentences: string[] = [];
  lines.forEach((l) => {
    if (sentences.length && /^[a-ząćęłńóśźż]/.test(l) && !/[.;]$/.test(sentences[sentences.length - 1])) sentences[sentences.length - 1] += ' ' + l;
    else sentences.push(l);
  });
  const conditions = Array.from(
    new Set(
      sentences
        .filter((l) => CONDITION_KEYWORDS.test(l) && !BOILERPLATE.test(l) && !isTableRow(l) && l.length >= 30 && letterRatio(l) > 0.72)
        .map((l) => l.replace(/^[-•]\s*/, '').replace(/[«»|]+/g, '').trim().slice(0, 400))
    )
  ).slice(0, 15);

  // płatność
  const once = /p[łl]atno[śs][ćc]\s*[-–:]?\s*jednorazow/i.test(flat);
  const inst = flat.match(/(?:p[łl]atn\p{L}*|sk[łl]adka)[^.\n]{0,40}?(\d+)\s*rat/iu);
  const payDue = flat.match(/terminy?\s+i\s+kwoty\s+p[łl]atno\p{L}*\s*\d*\s*[-–]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/iu)?.[1];
  const installments = once ? `jednorazowo${payDue ? `, termin ${findDates(payDue)[0]}` : ''}` : inst ? `${inst[1]} rat(y)` : undefined;

  // pozostałe informacje
  const insured = flat.match(/[Uu]bezpieczony\s*\n[^\n]{0,40}?(?:REGON\s*)?([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ0-9 .,&-]{6,80}?(?:SP\.?\s*Z\s*O\.?\s*O\.?|S\.?A\.?))/)?.[1];
  if (insured) info.push({ label: 'Ubezpieczony (właściciel)', value: insured.trim() });
  const concl = flat.match(/data\s+i\s+miejsce\s+zawarcia[^\n]{0,30}?(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})\s*([A-ZĄĆĘŁŃÓŚŹŻ]{3,})?/i);
  if (concl) info.push({ label: 'Zawarcie umowy', value: `${findDates(concl[1])[0] || concl[1]}${concl[2] ? `, ${concl[2].charAt(0)}${concl[2].slice(1).toLowerCase()}` : ''}` });
  const ocSums = flat.match(/szkody\s+na\s+osobie\s*[-–:]?\s*([\d ]+)\s*z[łl]\p{L}*,?\s*szkody\s+w\s+mieniu\s*[-–:]?\s*([\d ]+)\s*z[łl]/iu);
  if (ocSums) info.push({ label: 'Sumy gwarancyjne OC', value: `osoby ${ocSums[1].trim()} zł, mienie ${ocSums[2].trim()} zł` });
  if (once || inst) info.push({ label: 'Płatność', value: installments! });

  if (!insurer) warnings.push('Nie rozpoznano ubezpieczyciela.');
  if (!period.to) warnings.push('Nie znaleziono okresu ubezpieczenia – sprawdź daty ręcznie.');
  if (!covers.oc.found && !covers.ac.found && !covers.nnw.found) warnings.push('Nie znaleziono OC, AC ani NNW – to może nie być polisa komunikacyjna.');
  if (text.trim().length < 200) warnings.push('Odczytano bardzo mało tekstu – jakość skanu może być za słaba.');

  // kontrola: suma składek z tabeli = składka łączna
  const tablePrem = lines.filter(isTableRow).map((l) => rowNumbers(l)).map((n) => n[n.length - 1] || 0).reduce((a, b) => a + b, 0);
  if (premiumTotal && tablePrem && Math.abs(tablePrem - premiumTotal) > 1) {
    warnings.push(`Składki z tabeli dają razem ${fmt(tablePrem)} zł, a do zapłaty jest ${fmt(premiumTotal)} zł – któraś kwota mogła się źle odczytać.`);
  }

  // ochrona bez własnego okresu dziedziczy okres polisy
  KINDS.forEach((k) => {
    if (covers[k].found) {
      covers[k].from = covers[k].from || period.from;
      covers[k].to = covers[k].to || period.to;
    }
  });

  return {
    insurer,
    policyNumber,
    from: period.from,
    to: period.to,
    vin,
    plate,
    ...vehicleMeta,
    premiumTotal,
    covers,
    extras,
    conditions,
    installments,
    info,
    warnings,
  };
}

const TWO_WORD_BRANDS = ['alfa romeo', 'aston martin', 'land rover', 'rolls royce', 'rolls-royce', 'lynk & co', 'mercedes benz', 'mercedes-benz'];

function normalizeBrandModel(raw: string): { brand?: string; model?: string } {
  const cleaned = raw
    .replace(/\b(?:nr|vin|rok|pojemno|moc|paliwo|masa|rodzaj)\b.*$/i, '')
    .replace(/[|•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 2) return {};
  const lower = cleaned.toLowerCase();
  const two = TWO_WORD_BRANDS.find((b) => lower.startsWith(b + ' ') || lower === b);
  if (two) {
    const brand = cleaned.slice(0, two.length).trim();
    const model = cleaned.slice(two.length).trim();
    return { brand, model: model || undefined };
  }
  const parts = cleaned.split(/\s+/);
  const brand = parts[0];
  const model = parts.slice(1).join(' ').trim();
  return { brand, model: model || undefined };
}

function normalizeFuelType(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/elektr|\bEV\b|BEV|pr[ąa]d/i.test(raw)) return 'Elektryczny';
  if (/hybryd|PHEV|HEV|MHEV/i.test(raw)) return 'Hybryda';
  if (/diesel|olej\s+nap[ęe]dowy|\bON\b/i.test(raw)) return 'Diesel';
  if (/\bLPG\b|autogaz|gaz/i.test(raw)) return 'LPG';
  if (/benzyn|\bPB\b/i.test(raw)) return 'Benzyna';
  return undefined;
}

function extractVehicleMetadata(flat: string): {
  brand?: string;
  model?: string;
  productionYear?: number;
  fuelType?: string;
  firstRegistrationDate?: string;
} {
  let brand: string | undefined;
  let model: string | undefined;

  const combined = flat.match(/(?:marka\s*(?:,|i|\/)\s*model|marka\s+i\s+typ(?:\s+model)?|pojazd)\s*[:.]\s*([^\n]{2,60})/i)?.[1];
  if (combined) {
    const bm = normalizeBrandModel(combined);
    brand = bm.brand;
    model = bm.model;
  }
  if (!brand) {
    const b = flat.match(/\bmarka(?:\s+pojazdu)?\s*[:.]\s*([^\n,;]{2,35})/i)?.[1]?.trim();
    if (b) brand = b.split(/\s{2,}/)[0].trim();
  }
  if (!model) {
    const m = flat.match(/\bmodel(?:\s+pojazdu)?\s*[:.]\s*([^\n,;]{1,40})/i)?.[1]?.trim();
    if (m) model = m.split(/\s{2,}/)[0].trim();
  }

  const yrStr = flat.match(/rok\s+produkcji\s*[:.]?\s*((?:19|20)\d{2})\b/i)?.[1];
  const productionYear = yrStr ? Number(yrStr) : undefined;

  const firstRegRaw = flat.match(
    /(?:data\s+(?:1\.?|pierwszej)\s+rejestracji|pierwsza\s+rejestracja|1\.?\s*rejestracja)\s*[:.]?\s*([^\n]{6,25})/i
  )?.[1];
  const firstRegistrationDate = firstRegRaw ? findDates(firstRegRaw)[0] : undefined;

  const fuelRaw = flat.match(/(?:rodzaj\s+paliwa|paliwo|nap[ęe]d)\s*[:.]?\s*([^\n,;]{3,35})/i)?.[1];
  const fuelType = normalizeFuelType(fuelRaw);

  return { brand, model, productionYear, fuelType, firstRegistrationDate };
}

/** porównanie numerów odpornie na pomyłki OCR (O↔0, I↔1, Q↔0) */
export const sameId = (a?: string, b?: string) => {
  const n = (s?: string) => (s || '').toUpperCase().replace(/\s/g, '').replace(/[OQ]/g, '0').replace(/I/g, '1');
  return !!a && !!b && n(a) === n(b);
};
