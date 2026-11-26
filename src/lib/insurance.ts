import { CoverKind, InsuranceCover, InsuranceSet, Vehicle } from '../types/fleet';
import { getDaysRemaining } from './dateUtils';

export const COVER_LABELS: Record<CoverKind, string> = { oc: 'OC', ac: 'AC', nnw: 'NNW' };
export const COVER_DESCRIPTIONS: Record<CoverKind, string> = {
  oc: 'Obowiązkowe – szkody wyrządzone innym',
  ac: 'Dobrowolne – szkody własnego auta (kradzież, kolizja)',
  nnw: 'Dobrowolne – następstwa nieszczęśliwych wypadków kierowcy i pasażerów',
};

/** Ubezpieczenia pojazdu – z nowego pola `insurance` albo ze starych pól (jedna data dla całej polisy) */
export function getInsurance(v: Vehicle): InsuranceSet {
  if (v.insurance) return v.insurance;
  if (!v.insuranceDate && !v.insuranceProvider && !v.insurancePolicyNumber) return {};
  const base: InsuranceCover = { enabled: true, provider: v.insuranceProvider, policyNumber: v.insurancePolicyNumber, to: v.insuranceDate };
  const t = (v.insuranceType || 'OC').toUpperCase();
  return {
    oc: base,
    ac: t.includes('AC') ? { ...base } : undefined,
    nnw: t.includes('NNW') ? { ...base } : undefined,
    extras: t.includes('ASSISTANCE') ? ['Assistance'] : [],
  };
}

export function activeCovers(ins: InsuranceSet): { kind: CoverKind; cover: InsuranceCover; days: number | null }[] {
  return (['oc', 'ac', 'nnw'] as CoverKind[])
    .filter((k) => ins[k]?.enabled)
    .map((k) => ({ kind: k, cover: ins[k]!, days: getDaysRemaining(ins[k]!.to) }));
}

/** Najbliżej wygasające aktywne ubezpieczenie */
export function nearestCover(ins: InsuranceSet) {
  const list = activeCovers(ins).filter((c) => c.days !== null);
  list.sort((a, b) => (a.days as number) - (b.days as number));
  return list[0] || null;
}
