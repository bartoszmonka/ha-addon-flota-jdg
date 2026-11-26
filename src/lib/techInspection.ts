/**
 * Termin badania technicznego (art. 81 ustawy Prawo o ruchu drogowym, samochód osobowy):
 *  1. badanie – przed upływem 3 lat od pierwszej rejestracji,
 *  2. badanie – przed upływem 5 lat od pierwszej rejestracji (czyli 2 lata po pierwszym terminie),
 *  kolejne   – co roku (przed upływem roku od ostatniego badania).
 * Jeśli użytkownik wpisał termin z dowodu rejestracyjnego – ten ma pierwszeństwo.
 */
import { Vehicle } from '../types/fleet';
import { fmtDate, parseDate } from './calendar';

const addYears = (d: Date, y: number) => new Date(d.getFullYear() + y, d.getMonth(), d.getDate());

export interface TechInspectionInfo {
  due: string | null;
  source: 'manual' | 'computed' | 'estimated' | 'none';
  stage: 'first' | 'second' | 'annual' | null;
  explanation: string;
  /** wyliczony termin (gdy różni się od ręcznie wpisanego) */
  computedDue?: string | null;
}

export function computeTechInspection(v: Pick<Vehicle, 'techInspectionDate' | 'firstRegistrationDate' | 'lastTechInspectionDate' | 'productionYear'>): TechInspectionInfo {
  const reg = v.firstRegistrationDate ? parseDate(v.firstRegistrationDate) : null;
  const last = v.lastTechInspectionDate ? parseDate(v.lastTechInspectionDate) : null;
  let computed: TechInspectionInfo = { due: null, source: 'none', stage: null, explanation: 'Podaj datę pierwszej rejestracji (pole B w dowodzie) albo termin z dowodu.' };

  if (reg) {
    const due1 = addYears(reg, 3);
    const due2 = addYears(reg, 5);
    if (!last) {
      const today = new Date();
      if (today <= due1) computed = { due: fmtDate(due1), source: 'computed', stage: 'first', explanation: `1. badanie: do 3 lat od pierwszej rejestracji (${v.firstRegistrationDate}).` };
      else
        computed = {
          due: fmtDate(due1),
          source: 'computed',
          stage: 'first',
          explanation: `1. badanie należało wykonać do ${fmtDate(due1)}. Jeśli było zrobione, wpisz datę ostatniego badania.`,
        };
    } else if (last <= due1) {
      computed = { due: fmtDate(due2), source: 'computed', stage: 'second', explanation: `2. badanie: do 5 lat od pierwszej rejestracji (2 lata po pierwszym terminie).` };
    } else {
      computed = { due: fmtDate(addYears(last, 1)), source: 'computed', stage: 'annual', explanation: `Kolejne badania co roku – rok od ostatniego (${v.lastTechInspectionDate}).` };
    }
  } else if (v.productionYear) {
    // tylko rok produkcji – szacunek (koniec roku produkcji + 3 lata)
    const est = new Date(v.productionYear + 3, 11, 31);
    computed = {
      due: fmtDate(est),
      source: 'estimated',
      stage: 'first',
      explanation: `Szacunek z roku produkcji ${v.productionYear} (najpóźniej do końca ${v.productionYear + 3}). Dla dokładnego terminu podaj datę pierwszej rejestracji.`,
    };
  }

  if (v.techInspectionDate) {
    return {
      due: v.techInspectionDate,
      source: 'manual',
      stage: computed.stage,
      explanation: 'Termin wpisany ręcznie (np. z pieczątki w dowodzie rejestracyjnym).',
      computedDue: computed.due && computed.due !== v.techInspectionDate ? computed.due : null,
    };
  }
  return computed;
}
