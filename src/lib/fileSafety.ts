/**
 * Bezpieczeństwo plików użytkownika (załączniki, polisa, import).
 * Typ pliku ustalamy po jego ZAWARTOŚCI (magic bytes), a nie po nazwie czy deklarowanym typie.
 * Dzięki temu plik .html / .svg podany jako „zdjęcie” nie może zostać otwarty jako strona
 * w domenie aplikacji (blob: dziedziczy origin, więc skrypt miałby dostęp do sesji Firebase).
 */

export const SAFE_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'] as const;
export type SafeMime = (typeof SAFE_MIME)[number];

export const isSafeMime = (t?: string): t is SafeMime => !!t && (SAFE_MIME as readonly string[]).includes(t.toLowerCase());

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));

/** Rozpoznaje PDF / JPEG / PNG / WebP / GIF / HEIC po nagłówku. Inne pliki → null. */
export async function sniffMime(blob: Blob): Promise<SafeMime | null> {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  // %PDF może poprzedzać kilka bajtów śmieci, ale nie więcej niż 1 kB – bierzemy tylko ścisły nagłówek
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 3) === 'GIF') return 'image/gif';
  if (ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(b, 8, 4))) return 'image/heic';
  return null;
}

/** Zwraca blob z typem wymuszonym na bezpieczny; dla nieznanej zawartości – application/octet-stream (tylko pobranie). */
export async function withSafeType(blob: Blob): Promise<Blob> {
  const t = await sniffMime(blob);
  return new Blob([blob], { type: t || 'application/octet-stream' });
}

export const UNSUPPORTED_FILE_MSG = 'Ten typ pliku nie jest obsługiwany. Dozwolone: PDF, JPG, PNG, WebP, GIF, HEIC.';

/** Import Excela: archiwum ZIP (xlsx) – nagłówek „PK”, rozsądny rozmiar */
export const MAX_XLSX_BYTES = 8 * 1024 * 1024;
export function checkXlsxBuffer(buf: ArrayBuffer): void {
  if (buf.byteLength > MAX_XLSX_BYTES) throw new Error('Plik jest za duży (maks. 8 MB) – to nie wygląda na ewidencję przebiegu.');
  const h = new Uint8Array(buf.slice(0, 4));
  if (!(h[0] === 0x50 && h[1] === 0x4b)) throw new Error('To nie jest plik .xlsx (nieprawidłowy nagłówek). Zapisz arkusz w formacie „Skoroszyt programu Excel (.xlsx)”.');
}

/** Usuwa z tekstu dane, których nie warto trzymać w bazie: PESEL i inne długie ciągi cyfr (konta, dowody) */
export function redactSensitive(text: string): string {
  return text
    .replace(/(PESEL[^\d\n]{0,20})(\d{11})/gi, '$1***********')
    .replace(/(?<![\d])\d{11}(?![\d])(?=\s*(?:\/|\n|,|$))/g, (m) => (/^\d{11}$/.test(m) && !/^(0|4)5000/.test(m) ? '***********' : m))
    .replace(/\b\d{2}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[numer konta]')
    .replace(/\b(seria\s+i\s+numer|nr)\s+dowodu[^\n]{0,30}/gi, '$1 dowodu: [ukryto]');
}
