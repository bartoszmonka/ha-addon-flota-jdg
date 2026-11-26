import React, { useEffect, useState } from 'react';
import { Car, Link2, Loader2, Plus, Unlink, AlertTriangle } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { fetchHaVehicles, HaVehicleLive, isoToPl } from '../../lib/ha';
import { deleteField } from '../../lib/docstore';

/**
 * Samochody z Home Assistant: import (dodanie pojazdu z danymi z HA) albo powiązanie
 * istniejącego pojazdu. Powiązany pojazd pobiera na żywo przebieg, przegląd i ubezpieczenie z HA.
 */
export const HaVehiclesPanel: React.FC = () => {
  const { vehicles, addVehicle, updateVehicle, setActiveVehicle } = useFleet();
  const [list, setList] = useState<HaVehicleLive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null);
    fetchHaVehicles()
      .then(setList)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const norm = (s?: string) => (s || '').replace(/\s+/g, '').toUpperCase();

  const link = async (ha: HaVehicleLive, vehicleId: string) => {
    setBusy(ha.prefix);
    try {
      await updateVehicle(vehicleId, { haPrefix: ha.prefix });
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (vehicleId: string) => {
    setBusy(vehicleId);
    try {
      await updateVehicle(vehicleId, { haPrefix: deleteField() as unknown as undefined });
    } finally {
      setBusy(null);
    }
  };

  const importNew = async (ha: HaVehicleLive) => {
    setBusy(ha.prefix);
    try {
      const [brand, ...rest] = ha.name.split(' ');
      const reg = isoToPl(ha.firstRegistration);
      await addVehicle({
        registrationNumber: ha.plate || '',
        brand: brand || ha.name,
        model: rest.join(' '),
        vin: ha.vin,
        productionYear: ha.firstRegistration ? Number(ha.firstRegistration.slice(0, 4)) : undefined,
        initialOdometer: 0,
        currentOdometer: 0,
        firstRegistrationDate: reg,
        registerStartDate: isoToPl(ha.purchaseDate),
        haPrefix: ha.prefix,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
        <div className="p-2 bg-sky-50 text-sky-600 rounded-lg">
          <Car className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-base text-slate-900">Samochody z Home Assistant</h2>
          <p className="text-xs text-slate-500">Przebieg, przegląd i ubezpieczenie pobierane na żywo z HA. Pojazd przełączasz w menu po lewej.</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {!list && !error && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Szukam samochodów w Home Assistant…
        </div>
      )}

      <div className="space-y-2.5">
        {list?.map((ha) => {
          const linked = vehicles.find((v) => v.haPrefix === ha.prefix);
          const sameVehicle = vehicles.find((v) => !v.haPrefix && norm(v.registrationNumber) === norm(ha.plate));
          return (
            <div key={ha.prefix} className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold text-sm text-slate-800">{ha.name}</div>
                <div className="text-xs text-slate-500 font-num">
                  {[ha.plate, ha.odometerKm != null && `${ha.odometerKm.toLocaleString('pl-PL')} km`, ha.inspectionUntil && `przegląd do ${isoToPl(ha.inspectionUntil)}`, ha.insuranceUntil && `OC do ${isoToPl(ha.insuranceUntil)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {linked ? (
                <>
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[11px] font-semibold">Powiązany</span>
                  <button onClick={() => setActiveVehicle(linked)} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-white">
                    Przełącz na ten pojazd
                  </button>
                  <button onClick={() => unlink(linked.id)} disabled={busy === linked.id} className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-white inline-flex items-center gap-1.5">
                    <Unlink className="w-3.5 h-3.5" /> Odłącz
                  </button>
                </>
              ) : sameVehicle ? (
                <button onClick={() => link(ha, sameVehicle.id)} disabled={busy === ha.prefix} className="px-3 py-1.5 text-xs font-semibold bg-brand text-white rounded-lg inline-flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Powiąż z istniejącym ({sameVehicle.registrationNumber})
                </button>
              ) : (
                <button onClick={() => importNew(ha)} disabled={busy === ha.prefix} className="px-3 py-1.5 text-xs font-semibold bg-brand text-white rounded-lg inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Importuj do Flota JDG
                </button>
              )}
            </div>
          );
        })}
        {list && !list.length && <p className="text-xs text-slate-500">Nie znaleziono samochodów w Home Assistant.</p>}
      </div>
    </div>
  );
};
