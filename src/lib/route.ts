/**
 * Trasa „skąd – dokąd”. W bazie trzymamy jeden tekst (routeDescription, jak w ewidencji),
 * a w formularzu rozbijamy go na „Skąd”, „Dokąd” i „z powrotem”.
 * Separator: myślnik z odstępem z co najmniej jednej strony (żeby nie ciąć kodów pocztowych 00-001).
 */

// także „13-Warszawa” / „129a-Warszawa” (numer, myślnik, wielka litera) – ale nie „00-001” ani „Bielsko-Biała”
const SEP = /\s+[-–—]\s*|\s*[-–—]\s+|(?<=\d\p{Ll}?)[-–—](?=\p{Lu})/u;

export function splitRoute(route: string): string[] {
  return (route || '')
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// --- Zapis miejsca: „Warszawa Kwiatowa 1” → „Kwiatowa 1, Warszawa” ------------------------------

const BASE_CITIES = [
  'Warszawa', 'Łódź', 'Warszawa', 'Kraków', 'Poznań', 'Gdańsk', 'Gdynia', 'Sopot', 'Szczecin', 'Katowice', 'Lublin', 'Białystok', 'Bydgoszcz',
  'Toruń', 'Kielce', 'Rzeszów', 'Opole', 'Olsztyn', 'Legnica', 'Wałbrzych', 'Głogów', 'Lubin', 'Świdnica', 'Bolesławiec', 'Kłodzko', 'Jawor',
  'Oleśnica', 'Oława', 'Trzebnica', 'Siechnice', 'Kąty Warszawaskie', 'Długołęka', 'Kobierzyce', 'Czernica', 'Środa Śląska', 'Brzeg', 'Nysa',
  'Częstochowa', 'Gliwice', 'Zabrze', 'Bytom', 'Sosnowiec', 'Tychy', 'Radom', 'Płock', 'Elbląg', 'Kalisz', 'Konin', 'Leszno', 'Piła', 'Koszalin',
  'Słupsk', 'Ostrów Wielkopolski', 'Gniezno', 'Piotrków Trybunalski', 'Tomaszów Mazowiecki', 'Skierniewice', 'Łowicz', 'Sieradz', 'Zgierz',
  'Pabianice', 'Bełchatów', 'Wieluń', 'Kutno', 'Zamość', 'Chełm', 'Przemyśl', 'Tarnów', 'Nowy Sącz', 'Nowy Targ', 'Zakopane', 'Oświęcim',
  'Racibórz', 'Rybnik', 'Jastrzębie-Zdrój', 'Pruszków', 'Piaseczno', 'Legionowo', 'Otwock', 'Mińsk Mazowiecki', 'Siedlce', 'Ostrołęka', 'Łomża',
  'Suwałki', 'Ełk', 'Grudziądz', 'Włocławek', 'Inowrocław', 'Zielona Góra', 'Gorzów Wielkopolski', 'Jelenia Góra', 'Bielsko-Biała', 'Nowa Sól',
  'Świebodzin', 'Żary', 'Żagań', 'Polkowice', 'Chojnów', 'Złotoryja', 'Kamienna Góra', 'Dzierżoniów', 'Bielawa', 'Strzelin', 'Wołów', 'Milicz',
  'Syców', 'Namysłów', 'Kępno', 'Berlin', 'Praga', 'Drezno',
];
// słowa, które zaczynają nazwę ulicy, a nie są miastem
const NOT_CITY = /^(al|aleja|ul|ulica|pl|plac|os|osiedle|rondo|droga|trakt|bulwar|skwer|park|rynek|stacja|parking)$/i;
const cities = new Map<string, string>(BASE_CITIES.map((c) => [norm(c), c]));

/** dopisuje miasta znane z danych użytkownika (adresy firmy, nauczone z tras) */
export function registerCities(list: (string | undefined | null)[]) {
  for (const c of list) if (c && c.trim().length >= 3 && !NOT_CITY.test(c.trim())) cities.set(norm(c), c.trim());
}

/** Miasto = pierwsze słowo, od którego zaczyna się ≥3 różnych adresów z numerem („Warszawa Polna 2a”, „Warszawa Lipowa 3”…) */
export function learnCities(routes: string[]) {
  const seen = new Map<string, Set<string>>();
  for (const r of routes) {
    for (const p of splitRoute(r)) {
      if (p.includes(',')) continue;
      const m = p.match(/^(\p{Lu}[\p{L}-]+)\s+(\p{L}.*\d.*)$/u);
      if (!m || NOT_CITY.test(m[1])) continue;
      const set = seen.get(m[1]) || new Set<string>();
      set.add(norm(m[2]));
      seen.set(m[1], set);
    }
  }
  registerCities(Array.from(seen.entries()).filter(([, s]) => s.size >= 3).map(([c]) => c));
}

const isCity = (s: string) => cities.has(norm(s));

/** „Warszawa Kwiatowa 1” → „Kwiatowa 1, Warszawa”; „Łódź, aleja X 13” → „aleja X 13, Łódź”; reszta bez zmian */
export function formatPlace(raw: string): string {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const comma = t.indexOf(',');
  if (comma > 0) {
    const a = t.slice(0, comma).trim();
    const b = t.slice(comma + 1).trim();
    return isCity(a) && b && !isCity(b) ? `${b}, ${a}` : `${a}, ${b}`;
  }
  const words = t.split(' ');
  // najdłuższe pasujące miasto na początku (obsługa „Kąty Warszawaskie …”, „Zielona Góra …”)
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const city = words.slice(0, n).join(' ');
    if (isCity(city)) {
      const rest = words.slice(n).join(' ');
      if (rest && !isCity(rest)) return `${rest}, ${cities.get(norm(city))}`;
    }
  }
  return t;
}

/** cała trasa w jednolitym zapisie: „Kwiatowa 1, Warszawa – Polna 2a, Warszawa” */
export function formatRoute(route: string): string {
  const parts = splitRoute(route);
  return parts.length ? parts.map(formatPlace).join(' – ') : route;
}

export interface RouteParts {
  from: string;
  to: string;
  roundTrip: boolean;
}

export function parseRoute(route: string): RouteParts {
  const parts = splitRoute(route);
  if (parts.length === 0) return { from: '', to: '', roundTrip: false };
  if (parts.length === 1) return { from: formatPlace(parts[0]), to: '', roundTrip: false };
  const fp = parts.map(formatPlace);
  const first = fp[0];
  const last = fp[fp.length - 1];
  const lastIsReturn = parts.length >= 3 && (norm(last) === norm(first) || norm(first).endsWith(norm(last)) || norm(last).endsWith(norm(first)));
  if (lastIsReturn) return { from: first, to: fp.slice(1, -1).join(' – '), roundTrip: true };
  return { from: first, to: fp.slice(1).join(' – '), roundTrip: false };
}

export function composeRoute({ from, to, roundTrip }: RouteParts): string {
  const f = formatPlace(from);
  const t = splitRoute(to).map(formatPlace).join(' – ');
  if (!f) return t;
  if (!t) return f;
  return roundTrip ? `${f} – ${t} – ${f}` : `${f} – ${t}`;
}

/** Sprawdza czy „Skąd” i „Dokąd” wskazują na to samo miejsce (po normalizacji i formacie miasta) */
export function isSamePlace(from: string, to: string): boolean {
  const fa = norm(formatPlace(from));
  if (!fa) return false;
  const parts = splitRoute(to).map((p) => norm(formatPlace(p)));
  return parts.length > 0 && parts.every((p) => p === fa);
}

/** Miejsca z dotychczasowych tras, posortowane od najczęściej odwiedzanych */
export function rankPlaces(routes: string[]): { place: string; count: number }[] {
  const counts = new Map<string, { place: string; count: number }>();
  for (const r of routes) {
    for (const raw of splitRoute(r)) {
      const p = formatPlace(raw);
      const k = norm(p);
      if (k.length < 3) continue;
      const cur = counts.get(k);
      if (cur) cur.count++;
      else counts.set(k, { place: p, count: 1 });
    }
  }
  // „Kwiatowa 1” i „Warszawa Kwiatowa 1” to to samo miejsce – łączymy, zostaje dłuższa nazwa
  const list = Array.from(counts.entries()).sort((a, b) => b[0].length - a[0].length);
  const merged: { key: string; place: string; count: number }[] = [];
  for (const [k, v] of list) {
    // dłuższa nazwa = jedno słowo (np. miasto) + krótsza
    const target = merged.find(
      (m) => (m.key.endsWith(' ' + k) && !m.key.slice(0, -k.length - 1).includes(' ')) || (m.key.startsWith(k + ' ') && isCity(m.key.slice(k.length + 1)))
    );
    if (target) target.count += v.count;
    else merged.push({ key: k, ...v });
  }
  return merged.map(({ place, count }) => ({ place, count })).sort((a, b) => b.count - a.count);
}
