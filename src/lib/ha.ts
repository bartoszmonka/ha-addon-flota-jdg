/** Dane pojazdu pobierane z Home Assistant przez serwer Flota JDG (tylko odczyt) */
import { api } from './docstore';
import type { Vehicle } from '../types/fleet';

export interface HaVehicleLive {
  prefix: string;
  name: string;
  plate?: string;
  vin?: string;
  firstRegistration?: string; // YYYY-MM-DD
  purchaseDate?: string;
  inspectionUntil?: string;
  insuranceUntil?: string;
  asoNext?: string;
  odometerKm?: number;
  odometerUpdatedAt?: string;
}

export const isoToPl = (iso?: string): string | undefined => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : undefined;
};

export const fetchHaVehicles = () => api<{ vehicles: HaVehicleLive[] }>('/api/ha/vehicles').then((r) => r.vehicles);
export const fetchHaVehicle = (prefix: string) =>
  api<{ vehicle: HaVehicleLive }>(`/api/ha/vehicle/${encodeURIComponent(prefix)}`).then((r) => r.vehicle);

/** Nakłada dane z HA na pojazd (terminy i dane z dowodu mają pierwszeństwo przed wpisanymi ręcznie) */
export function overlayHa(v: Vehicle, ha: HaVehicleLive | null): Vehicle {
  if (!ha) return v;
  const out: Vehicle = { ...v };
  // przebieg z HA jest nadrzędny wobec zapisanego w aplikacji
  if (ha.odometerKm != null) out.currentOdometer = ha.odometerKm;
  if (ha.plate) out.registrationNumber = ha.plate;
  if (ha.vin) out.vin = ha.vin;
  const reg = isoToPl(ha.firstRegistration);
  if (reg) out.firstRegistrationDate = reg;
  const tech = isoToPl(ha.inspectionUntil);
  if (tech) out.techInspectionDate = tech;
  const aso = isoToPl(ha.asoNext);
  if (aso) out.asoInspectionDate = aso;
  const oc = isoToPl(ha.insuranceUntil);
  if (oc) {
    const ins = v.insurance || {};
    out.insurance = { ...ins, oc: { ...(ins.oc || {}), enabled: true, to: oc } };
    out.insuranceDate = oc;
  }
  return out;
}
