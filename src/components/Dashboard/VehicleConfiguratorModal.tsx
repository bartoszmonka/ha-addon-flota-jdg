import React, { useState } from 'react';
import { useFleet } from '../../context/FleetContext';
import { X, Car, Shield, Wrench, Calendar, Check, AlertCircle } from 'lucide-react';
import { getTodayDDMMYYYY, isoToDDMMYYYY, ddmmyyyyToIso } from '../../lib/dateUtils';

interface VehicleConfiguratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VehicleConfiguratorModal: React.FC<VehicleConfiguratorModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { addVehicle } = useFleet();

  const [step, setStep] = useState<1 | 2>(1);

  // Krok 1: Dane identyfikacyjne pojazdu
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vin, setVin] = useState('');
  const [productionYear, setProductionYear] = useState<number>(new Date().getFullYear());
  const [fuelType, setFuelType] = useState('Elektryczny');
  const [initialOdometer, setInitialOdometer] = useState<number>(0);
  const [currentOdometer, setCurrentOdometer] = useState<number>(0);

  // Krok 2: Terminy ASO, SKP i Ubezpieczenia
  const [asoInspectionDate, setAsoInspectionDate] = useState('');
  const [asoInspectionKm, setAsoInspectionKm] = useState<number>(30000);
  const [techInspectionDate, setTechInspectionDate] = useState('');
  const [firstRegistrationDate, setFirstRegistrationDate] = useState('');
  const [covers, setCovers] = useState({ oc: true, ac: false, nnw: false });
  const [insuranceDate, setInsuranceDate] = useState('');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('');
  const [insuranceType, setInsuranceType] = useState('OC + AC + NNW + Assistance');

  const [registerStartDate, setRegisterStartDate] = useState(getTodayDDMMYYYY());
  const [vat26Date, setVat26Date] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleNext = () => {
    if (!brand.trim() || !model.trim() || !registrationNumber.trim()) {
      setError('Wprowadź markę, model oraz numer rejestracyjny pojazdu.');
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationNumber.trim()) {
      setError('Numer rejestracyjny jest wymagany.');
      return;
    }
    setSaving(true);
    try {
    await addVehicle({
      brand: brand.trim(),
      model: model.trim(),
      registrationNumber: registrationNumber.trim().toUpperCase(),
      vin: vin.trim(),
      productionYear: Number(productionYear),
      fuelType,
      initialOdometer: Number(initialOdometer) || 0,
      currentOdometer: Number(currentOdometer) || Number(initialOdometer) || 0,
      asoInspectionKm: Number(asoInspectionKm) || undefined,
      techInspectionDate: techInspectionDate || undefined,
      firstRegistrationDate: firstRegistrationDate || undefined,
      asoInspectionDate: asoInspectionDate || undefined,
      insurance: insuranceDate || insuranceProvider
        ? {
            oc: { enabled: covers.oc, provider: insuranceProvider || undefined, policyNumber: insurancePolicyNumber || undefined, to: insuranceDate || undefined },
            ac: { enabled: covers.ac, provider: insuranceProvider || undefined, policyNumber: insurancePolicyNumber || undefined, to: insuranceDate || undefined },
            nnw: { enabled: covers.nnw, provider: insuranceProvider || undefined, policyNumber: insurancePolicyNumber || undefined, to: insuranceDate || undefined },
          }
        : undefined,
      insuranceDate: insuranceDate || undefined,
      insuranceProvider,
      insurancePolicyNumber,
      insuranceType,
      registerStartDate,
      vat26Date: vat26Date || undefined,
    });
    onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać pojazdu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Pasek nagłówka */}
        <div className="px-6 py-4 bg-side text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Car className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="font-bold text-base">Konfigurator Nowego Pojazdu</h2>
              <p className="text-xs text-slate-400">Dodaj samochód do floty JDG dla ewidencji VAT</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Kroki formularza */}
        <div className="px-6 pt-4 pb-2 border-b border-slate-100 flex items-center gap-4 text-xs font-semibold">
          <div className={`flex items-center gap-1.5 ${step === 1 ? 'text-brand' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 1 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'}`}>1</span>
            <span>Dane pojazdu</span>
          </div>
          <span className="text-slate-300">/</span>
          <div className={`flex items-center gap-1.5 ${step === 2 ? 'text-brand' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 2 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'}`}>2</span>
            <span>Przeglądy i Ubezpieczenie</span>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Marka pojazdu *</label>
                  <input
                    type="text"
                    required
                    placeholder="np. BMW, Tesla, Toyota"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Model *</label>
                  <input
                    type="text"
                    required
                    placeholder="np. i4, Model 3, RAV4"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Numer rejestracyjny *</label>
                  <input
                    type="text"
                    required
                    placeholder="np. WX12345"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rodzaj napędu / paliwa</label>
                  <select
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                  >
                    <option value="Elektryczny">Elektryczny (EV)</option>
                    <option value="Benzyna">Benzyna</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Hybryda">Hybryda (PHEV/HEV)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Numer VIN</label>
                  <input
                    type="text"
                    placeholder="17 znaków VIN"
                    value={vin}
                    onChange={(e) => setVin(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num uppercase focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rok produkcji</label>
                  <input
                    type="number"
                    min={1990}
                    max={2030}
                    value={productionYear}
                    onChange={(e) => setProductionYear(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Stan licznika początkowy (km) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={initialOdometer}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setInitialOdometer(val);
                      if (currentOdometer < val) setCurrentOdometer(val);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-[11px] text-slate-400">Początek ewidencji VAT</span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Aktualny stan licznika (km)
                  </label>
                  <input
                    type="number"
                    min={initialOdometer}
                    value={currentOdometer}
                    onChange={(e) => setCurrentOdometer(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-[11px] text-slate-400">Bieżący drogomierz</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Dzień rozpoczęcia ewidencji *</label>
                  <input
                    type="date"
                    required
                    value={ddmmyyyyToIso(registerStartDate)}
                    onChange={(e) => setRegisterStartDate(isoToDDMMYYYY(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-[11px] text-slate-400">Dzień, od którego liczy się stan początkowy</span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Data złożenia VAT-26</label>
                  <input
                    type="date"
                    value={ddmmyyyyToIso(vat26Date)}
                    onChange={(e) => setVat26Date(isoToDDMMYYYY(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-num focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <span className="text-[11px] text-slate-400">Informacja o pojeździe dla US</span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {/* Sekcja ASO */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2 font-semibold text-xs text-slate-800">
                  <Wrench className="w-4 h-4 text-brand" />
                  <span>Najbliższy przegląd ASO</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Data przeglądu (DD.MM.RRRR)</label>
                    <input
                      type="date"
                      onChange={(e) => setAsoInspectionDate(isoToDDMMYYYY(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <div className="text-[11px] text-slate-500 font-num mt-1">Ustawiono: {asoInspectionDate}</div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Limit kilometrów ASO</label>
                    <input
                      type="number"
                      step={1000}
                      value={asoInspectionKm}
                      onChange={(e) => setAsoInspectionKm(Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-num bg-white focus:outline-none focus:ring-1 focus:ring-brand"
                      placeholder="np. 30000"
                    />
                  </div>
                </div>
              </div>

              {/* Badanie techniczne */}
              <div className="p-3 bg-subtle border border-line rounded-lg space-y-2">
                <div className="flex items-center gap-2 font-semibold text-xs text-ink">
                  <Calendar className="w-4 h-4 text-ok" />
                  <span>Badanie techniczne</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">Data pierwszej rejestracji (pole B)</label>
                    <input type="date" value={ddmmyyyyToIso(firstRegistrationDate)} onChange={(e) => setFirstRegistrationDate(isoToDDMMYYYY(e.target.value))} className="w-full px-3 py-1.5 border border-line-strong rounded text-xs bg-white font-num" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">Termin następnego badania z dowodu (opcjonalnie)</label>
                    <input type="date" value={ddmmyyyyToIso(techInspectionDate)} onChange={(e) => setTechInspectionDate(isoToDDMMYYYY(e.target.value))} className="w-full px-3 py-1.5 border border-line-strong rounded text-xs bg-white font-num" />
                  </div>
                </div>
                <p className="text-[11px] text-ink-3">1. badanie do 3 lat od pierwszej rejestracji, 2. do 5 lat, potem co rok – wyliczymy to automatycznie.</p>
              </div>

              {/* Ubezpieczenie */}
              <div className="p-3 bg-subtle border border-line rounded-lg space-y-2">
                <div className="flex items-center gap-2 font-semibold text-xs text-ink">
                  <Shield className="w-4 h-4 text-brand" />
                  <span>Ubezpieczenie</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs font-semibold">
                  {(['oc', 'ac', 'nnw'] as const).map((k) => (
                    <label key={k} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={covers[k]} onChange={(e) => setCovers((c) => ({ ...c, [k]: e.target.checked }))} /> {k.toUpperCase()}
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">Ważne do</label>
                    <input type="date" value={ddmmyyyyToIso(insuranceDate)} onChange={(e) => setInsuranceDate(isoToDDMMYYYY(e.target.value))} className="w-full px-3 py-1.5 border border-line-strong rounded text-xs bg-white font-num" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">Ubezpieczyciel</label>
                    <input type="text" value={insuranceProvider} onChange={(e) => setInsuranceProvider(e.target.value)} className="w-full px-3 py-1.5 border border-line-strong rounded text-xs bg-white" placeholder="np. PZU, Warta" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">Numer polisy</label>
                    <input type="text" value={insurancePolicyNumber} onChange={(e) => setInsurancePolicyNumber(e.target.value)} className="w-full px-3 py-1.5 border border-line-strong rounded text-xs font-num bg-white" />
                  </div>
                </div>
                <p className="text-[11px] text-ink-3">Osobne daty OC / AC / NNW i wczytanie polisy z PDF – później w zakładce „Ubezpieczenie”.</p>
              </div>
            </div>
          )}

          {/* Przyciski nawigacji kroków */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            {step === 2 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
              >
                Wstecz
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 text-xs font-medium transition-colors"
              >
                Anuluj
              </button>

              {step === 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-5 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Dalej: Terminy
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving}
                  className="disabled:opacity-50 px-5 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Check className="w-4 h-4" />
                  <span>Zapisz i dodaj pojazd</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
