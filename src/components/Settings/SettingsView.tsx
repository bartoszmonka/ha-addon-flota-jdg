import React, { useEffect, useState } from 'react';
import { ImportPanel } from './ImportPanel';
import { HaVehiclesPanel } from './HaVehiclesPanel';
import { BackupImportPanel } from './BackupImportPanel';
import { AddressPeriod } from '../../types/fleet';
import { EARLIEST, formatAddress, getAddressHistory, isValidPostalCode } from '../../lib/address';
import { getPolishMonthNameGenitive } from '../../lib/dateUtils';
import { Plus, Trash2, MapPin } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { Building2, User, Save, CheckCircle, ShieldCheck, Mail } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { taxpayer, updateTaxpayer } = useFleet();
  const { currentUser } = useAuth();

  const [companyName, setCompanyName] = useState(taxpayer.companyName);
  const [nip, setNip] = useState(taxpayer.nip);
  const [addresses, setAddresses] = useState<AddressPeriod[]>(() => getAddressHistory(taxpayer));
  const [defaultDriverName, setDefaultDriverName] = useState(taxpayer.defaultDriverName);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // dane z Firestore przychodzą asynchronicznie – uzupełnij formularz, dopóki użytkownik nic nie zmienił
  useEffect(() => {
    if (dirty) return;
    setCompanyName(taxpayer.companyName);
    setNip(taxpayer.nip);
    setAddresses(getAddressHistory(taxpayer));
    setDefaultDriverName(taxpayer.defaultDriverName);
  }, [taxpayer.companyName, taxpayer.nip, taxpayer.address, JSON.stringify(taxpayer.addresses || []), taxpayer.defaultDriverName]);

  const sortedView = [...addresses].sort((a, b) => (a.validFrom || '9999').localeCompare(b.validFrom || '9999'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const cleanNip = nip.replace(/[^0-9]/g, '');
    if (cleanNip && !isValidNip(cleanNip)) {
      setSaveError('NIP ma nieprawidłową sumę kontrolną – sprawdź cyfry.');
      return;
    }
    const sorted = [...addresses]
      .map((a) => ({ ...a, street: a.street.trim(), postalCode: a.postalCode.trim(), city: a.city.trim() }))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    if (!sorted.length) {
      setSaveError('Podaj adres prowadzonej działalności.');
      return;
    }
    for (const a of sorted) {
      if (!a.street || !a.city) {
        setSaveError('Każdy adres musi mieć ulicę z numerem i miasto.');
        return;
      }
      if (!isValidPostalCode(a.postalCode)) {
        setSaveError(`Kod pocztowy „${a.postalCode}” powinien mieć format 00-000.`);
        return;
      }
      if (!a.validFrom) {
        setSaveError('Przy zmianie adresu wybierz miesiąc, od którego obowiązuje.');
        return;
      }
    }
    if (new Set(sorted.map((a) => a.validFrom)).size !== sorted.length) {
      setSaveError('Dwa adresy nie mogą obowiązywać od tego samego miesiąca.');
      return;
    }
    try {
      await updateTaxpayer({
        companyName: companyName.trim(),
        nip: cleanNip,
        addresses: sorted,
        address: formatAddress(sorted[sorted.length - 1]),
        defaultDriverName: defaultDriverName.trim(),
      });
      setDirty(false);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Nie udało się zapisać.');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Karta danych firmy do ewidencji VAT */}
      <div className="card p-6 ">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-5">
          <div className="p-2 bg-blue-50 text-brand rounded-lg">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900">Dane Podatnika (Nagłówek VAT-26)</h2>
            <p className="text-xs text-slate-500">
              Te dane są automatycznie drukowane w lewym górnym rogu urzędowej ewidencji przebiegu.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} onChange={() => setDirty(true)} className="space-y-4">
          {saveError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{saveError}</div>}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pełna nazwa firmy / Imię i nazwisko podatnika *
            </label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="np. TWOJA FIRMA ON SITE"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Numer NIP podatnika *
              </label>
              <input
                type="text"
                required
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-num bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                placeholder="10 cyfr, np. 1234567890"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Domyślny kierowca (wypełniany automatycznie)
              </label>
              <input
                type="text"
                value={defaultDriverName}
                onChange={(e) => setDefaultDriverName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                placeholder="Imię i nazwisko kierowcy"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Adres prowadzonej działalności gospodarczej *
              </label>
              <button
                type="button"
                onClick={() => {
                  const last = addresses[addresses.length - 1];
                  const d = new Date();
                  const thisMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  setAddresses([
                    ...addresses,
                    {
                      id: `addr_${Date.now().toString(36)}`,
                      street: '',
                      postalCode: '',
                      city: last?.city || '',
                      validFrom: addresses.length ? thisMonth : EARLIEST,
                    },
                  ]);
                  setDirty(true);
                }}
                className="text-xs text-brand hover:text-blue-700 font-semibold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> {addresses.length ? 'Dodaj zmianę adresu' : 'Dodaj adres'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Jeśli adres się zmieniał, dodaj kolejny z miesiącem, od którego obowiązuje. Każdy miesiąc ewidencji
              (ekran, PDF, Excel) dostanie adres z właściwego okresu.
            </p>

            {sortedView.map((a, idx) => {
              const isFirst = idx === 0;
              const isCurrent = idx === sortedView.length - 1;
              const next = sortedView[idx + 1];
              const update = (patch: Partial<AddressPeriod>) => {
                setAddresses(addresses.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
                setDirty(true);
              };
              const fmtMonth = (k: string) => `${getPolishMonthNameGenitive(k)} ${k.slice(0, 4)}`;
              return (
                <div key={a.id} className={`p-3 rounded-lg border ${isCurrent ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
                    <span className="font-semibold text-slate-700">
                      {isFirst ? 'Od początku ewidencji' : `Od ${a.validFrom ? fmtMonth(a.validFrom) : '…'}`}
                      {next?.validFrom ? ` do ${fmtMonth(prevMonth(next.validFrom))}` : ''}
                      {isCurrent && <span className="ml-2 px-1.5 py-0.5 rounded bg-brand text-white">aktualny</span>}
                    </span>
                    {addresses.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAddresses(addresses.filter((x) => x.id !== a.id));
                          setDirty(true);
                        }}
                        className="text-slate-400 hover:text-red-600 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> usuń
                      </button>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] text-slate-500 mb-0.5">Ulica i numer</label>
                        <input
                          required
                          value={a.street}
                          onChange={(e) => update({ street: e.target.value })}
                          placeholder="ul. Kwiatowa 1"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-slate-500 mb-0.5">Kod pocztowy</label>
                        <input
                          required
                          value={a.postalCode}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
                            update({ postalCode: digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits });
                          }}
                          placeholder="53-530"
                          inputMode="numeric"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] text-slate-500 mb-0.5">Miasto</label>
                        <input
                          required
                          value={a.city}
                          onChange={(e) => update({ city: e.target.value })}
                          placeholder="Warszawa"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                    </div>
                    {!isFirst && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                        <label className="text-[11px] font-medium text-slate-600 whitespace-nowrap">Obowiązuje od miesiąca:</label>
                        <input
                          type="month"
                          required
                          value={a.validFrom}
                          onChange={(e) => update({ validFrom: e.target.value })}
                          className="w-full sm:w-60 px-3 py-2 border border-slate-300 rounded-lg text-sm font-num bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 flex items-center justify-between border-t border-slate-100">
            {savedSuccess ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold animate-in fade-in">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>Dane podatnika zostały zaktualizowane!</span>
              </div>
            ) : (
              <div />
            )}

            <button
              type="submit"
              className="px-5 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
            >
              <Save className="w-4 h-4" />
              <span>Zapisz dane firmy</span>
            </button>
          </div>
        </form>
      </div>

      <HaVehiclesPanel />

      <ImportPanel />

      <BackupImportPanel />

      {/* Karta konta Google Auth */}
      <div className="card p-6 ">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900">Konto Home Assistant</h2>
            <p className="text-xs text-slate-500">Dostęp przez użytkownika Home Assistant</p>
          </div>
        </div>

        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center gap-3">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt="Avatar"
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full border border-slate-300"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div>
                <div className="font-semibold text-slate-800 text-sm">
                  {currentUser?.displayName || 'Użytkownik HA'}
                </div>
                <div className="text-slate-500 font-num">
                  {'Zalogowano przez Home Assistant'}
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[11px] font-semibold">
              Konto HA
            </span>
          </div>

          <p className="text-[11px] text-slate-400">
            Dane są przypisane do Twojego użytkownika Home Assistant i trzymane na Twoim serwerze (NAS).
          </p>
        </div>
      </div>
    </div>
  );
};

/** Walidacja sumy kontrolnej NIP (wagi 6,5,7,2,3,4,5,6,7) */
export function isValidNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((s, wi, i) => s + wi * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}

function prevMonth(monthKey: string): string {
  let [y, m] = monthKey.split('-').map(Number);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
