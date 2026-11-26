/**
 * Adres prowadzonej działalności z historią zmian.
 *
 * Każdy adres ma miesiąc, od którego obowiązuje (YYYY-MM). W nagłówku ewidencji za dany miesiąc
 * drukujemy adres z najpóźniejszym „obowiązuje od” nie późniejszym niż ten miesiąc —
 * np. Polna od 2023-08, Kwiatowa od 2023-10 → sierpień i wrzesień 2023 mają Polną.
 */

import { AddressPeriod, TaxpayerProfile } from '../types/fleet';

export const EARLIEST = '1900-01';

export function formatAddress(a?: Pick<AddressPeriod, 'street' | 'postalCode' | 'city'> | null): string {
  if (!a) return '';
  const street = a.street.trim();
  const cityLine = [a.postalCode.trim(), a.city.trim()].filter(Boolean).join(' ');
  return [street, cityLine].filter(Boolean).join(', ');
}

export function isValidPostalCode(code: string): boolean {
  return /^\d{2}-\d{3}$/.test(code.trim());
}

/** „ul.POLNA 2A/5, 00-001 Warszawa” → ulica / kod / miasto (najlepsza próba) */
export function parseAddress(text: string): Omit<AddressPeriod, 'id' | 'validFrom'> {
  const t = (text || '').trim();
  const m = t.match(/^(.*?)[,\s]+(\d{2}-\d{3})\s+(.+)$/);
  if (m) {
    return { street: tidyStreet(m[1]), postalCode: m[2], city: m[3].replace(/,.*$/, '').trim() };
  }
  return { street: t, postalCode: '', city: '' };
}

function tidyStreet(s: string): string {
  return s
    .replace(/,\s*$/, '')
    .replace(/^ul\.?\s*/i, 'ul. ')
    .trim();
}

/** Historia adresów posortowana rosnąco; stare profile z jednym polem `address` są zamieniane na 1 okres */
export function getAddressHistory(t: Pick<TaxpayerProfile, 'addresses' | 'address'>): AddressPeriod[] {
  if (t.addresses && t.addresses.length) {
    return [...t.addresses].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  }
  if (t.address) return [{ id: 'legacy', validFrom: EARLIEST, ...parseAddress(t.address) }];
  return [];
}

export function getAddressForMonth(t: Pick<TaxpayerProfile, 'addresses' | 'address'>, monthKey: string): AddressPeriod | null {
  const history = getAddressHistory(t);
  let found: AddressPeriod | null = null;
  for (const a of history) {
    if (a.validFrom <= monthKey) found = a;
  }
  // miesiąc sprzed pierwszego adresu – bierzemy najstarszy, żeby nagłówek nie był pusty
  return found || history[0] || null;
}

/** Dane podatnika z adresem obowiązującym w danym miesiącu (do nagłówka, PDF i Excela) */
export function taxpayerForMonth(t: TaxpayerProfile, monthKey: string): TaxpayerProfile {
  const a = getAddressForMonth(t, monthKey);
  return a ? { ...t, address: formatAddress(a) } : t;
}

/** Aktualny adres (najpóźniejszy) */
export function currentAddress(t: Pick<TaxpayerProfile, 'addresses' | 'address'>): AddressPeriod | null {
  const h = getAddressHistory(t);
  return h[h.length - 1] || null;
}
