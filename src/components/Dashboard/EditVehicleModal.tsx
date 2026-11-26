import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Car, Camera, Trash2, Save, Wrench, Shield, CalendarCheck, AlertTriangle, Download, Loader2 } from 'lucide-react';
import { deleteField } from '../../lib/docstore';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../ui/ConfirmDialog';
import { InsuranceVehicleData, Vehicle } from '../../types/fleet';
import { ddmmyyyyToIso, isoToDDMMYYYY } from '../../lib/dateUtils';
import { photoFileToDataUrl } from '../../lib/vehiclePhoto';
import { computeTechInspection } from '../../lib/techInspection';
import { activeCovers, COVER_LABELS, getInsurance } from '../../lib/insurance';
import { parsePolicyText } from '../../lib/policyParser';
import { loadAttachmentBlob } from '../../lib/attachmentStore';
import { extractImageText, extractPdfText } from '../../lib/pdfText';

interface Props {
  vehicle: Vehicle | null;
  isOpen: boolean;
  onClose: () => void;
}

const inputCls =
  'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand';
const labelCls = 'block text-xs font-medium text-slate-700 mb-1';

/** Edycja pojazdu z pulpitu: marka, model, zdjęcie, dane identyfikacyjne i terminy */
export const EditVehicleModal: React.FC<Props> = ({ vehicle, isOpen, onClose }) => {
  const { updateVehicle, deleteVehicle, entries } = useFleet();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<Partial<Vehicle>>({});
  const [saving, setSaving] = useState(false);
  const [importingIns, setImportingIns] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && vehicle) {
      setForm({ ...vehicle });
      setError(null);
      setImportMsg(null);
      setConfirmDelete('');
    }
  }, [isOpen, vehicle?.id]);

  const cachedInsuranceData = useMemo<InsuranceVehicleData>(() => {
    if (!vehicle?.insurance) return {};
    const parsed = vehicle.insurance.policyTextPreview ? parsePolicyText(vehicle.insurance.policyTextPreview) : null;
    const saved = vehicle.insurance.vehicleData;
    const merged: InsuranceVehicleData = {
      brand: saved?.brand || parsed?.brand,
      model: saved?.model || parsed?.model,
      registrationNumber: saved?.registrationNumber || parsed?.plate,
      vin: saved?.vin || parsed?.vin,
      productionYear: saved?.productionYear || parsed?.productionYear,
      fuelType: saved?.fuelType || parsed?.fuelType,
      firstRegistrationDate: saved?.firstRegistrationDate || parsed?.firstRegistrationDate,
    };
    return merged;
  }, [vehicle]);

  if (!isOpen || !vehicle) return null;

  const set = <K extends keyof Vehicle>(k: K, v: Vehicle[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dateField = (k: 'asoInspectionDate' | 'techInspectionDate' | 'insuranceDate' | 'registerStartDate' | 'vat26Date' | 'firstRegistrationDate' | 'lastTechInspectionDate') => (
    <input
      type="date"
      value={ddmmyyyyToIso((form[k] as string) || '')}
      onChange={(e) => set(k, e.target.value ? isoToDDMMYYYY(e.target.value) : undefined)}
      className={`${inputCls} font-num`}
    />
  );

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      set('photoDataUrl', await photoFileToDataUrl(f));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const hasEntries = entries.length > 0;
  const initialChanged = form.initialOdometer !== vehicle.initialOdometer;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.registrationNumber?.trim() || !form.brand?.trim()) {
      setError('Podaj markę i numer rejestracyjny.');
      return;
    }
    if (initialChanged && hasEntries) {
      const r = await confirm({
        title: 'Zmienić stan licznika na start ewidencji?',
        message: `Z ${vehicle.initialOdometer} na ${form.initialOdometer} km – zmieni się liczba km pierwszego wpisu.`,
        tone: 'warn',
        confirmLabel: 'Zmień',
      });
      if (!r.ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const { id: _id, currentOdometer: _c, ...rest } = form as Vehicle;
      const clean: Record<string, unknown> = {
        ...rest,
        brand: rest.brand?.trim(),
        model: rest.model?.trim() || '',
        registrationNumber: rest.registrationNumber?.trim().toUpperCase(),
        vin: rest.vin?.trim().toUpperCase(),
      };
      // pola wyczyszczone w formularzu (np. usunięte zdjęcie) usuwamy z dokumentu
      (Object.keys(vehicle) as (keyof Vehicle)[]).forEach((k) => {
        if (k !== 'id' && k !== 'currentOdometer' && k !== 'model' && (clean[k] === undefined || clean[k] === '') && vehicle[k] !== undefined) {
          clean[k] = deleteField();
        }
      });
      await updateVehicle(vehicle.id, clean as Partial<Vehicle>);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać pojazdu.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteVehicle(vehicle.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć pojazdu.');
    } finally {
      setSaving(false);
    }
  };

  const handleImportFromInsurance = async () => {
    setError(null);
    setImportMsg(null);
    let data: InsuranceVehicleData = { ...cachedInsuranceData };
    const hasAnyCached = Object.values(data).some((v) => v !== undefined && v !== '');

    if (!hasAnyCached && vehicle.insurance?.policyFile && currentUser) {
      setImportingIns(true);
      try {
        const blob = await loadAttachmentBlob(currentUser.uid, vehicle.id, vehicle.insurance.policyFile);
        if (blob) {
          const f = new File([blob], vehicle.insurance.policyFile.name, { type: blob.type || vehicle.insurance.policyFile.type });
          const res =
            f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
              ? await extractPdfText(f)
              : await extractImageText(f);
          const parsed = parsePolicyText(res.text);
          data = {
            brand: parsed.brand,
            model: parsed.model,
            registrationNumber: parsed.plate,
            vin: parsed.vin,
            productionYear: parsed.productionYear,
            fuelType: parsed.fuelType,
            firstRegistrationDate: parsed.firstRegistrationDate,
          };
        }
      } catch (err) {
        setError('Nie udało się odczytać zapisanej polisy: ' + (err instanceof Error ? err.message : String(err)));
        setImportingIns(false);
        return;
      } finally {
        setImportingIns(false);
      }
    }

    const candidates: { key: keyof Vehicle; label: string; value: string | number | undefined }[] = [
      { key: 'brand', label: 'Marka', value: data.brand },
      { key: 'model', label: 'Model', value: data.model },
      { key: 'registrationNumber', label: 'Nr rejestracyjny', value: data.registrationNumber },
      { key: 'vin', label: 'VIN', value: data.vin },
      { key: 'productionYear', label: 'Rok produkcji', value: data.productionYear },
      { key: 'fuelType', label: 'Napęd', value: data.fuelType },
      { key: 'firstRegistrationDate', label: 'Data 1. rejestracji', value: data.firstRegistrationDate },
    ];
    const available = candidates.filter((c) => c.value !== undefined && String(c.value).trim() !== '');
    if (available.length === 0) {
      setImportMsg('Brak danych pojazdu do zaimportowania – wczytaj polisę PDF w zakładce „Ubezpieczenie”.');
      return;
    }

    const emptyFields = available.filter((c) => !form[c.key] || String(form[c.key]).trim() === '');
    const conflictingFields = available.filter((c) => {
      const cur = form[c.key];
      return cur !== undefined && String(cur).trim() !== '' && String(cur).trim().toUpperCase() !== String(c.value).trim().toUpperCase();
    });

    let overwriteConflicts = false;
    if (conflictingFields.length > 0) {
      const r = await confirm({
        title: 'Nadpisać istniejące dane pojazdu danymi z polisy?',
        message: 'Część pól w formularzu ma już inną wartość niż w polisie:',
        warnings: conflictingFields.map((c) => `${c.label}: „${String(form[c.key])}” → „${String(c.value)}”`),
        tone: 'warn',
        confirmLabel: 'Nadpisz z polisy',
        cancelLabel: emptyFields.length > 0 ? 'Uzupełnij tylko puste' : 'Zachowaj obecne',
      });
      overwriteConflicts = r.ok;
    }

    const applied: string[] = [];
    setForm((prev) => {
      const next = { ...prev };
      for (const c of available) {
        const cur = next[c.key];
        const isEmpty = cur === undefined || String(cur).trim() === '';
        if (isEmpty || (overwriteConflicts && String(cur).trim().toUpperCase() !== String(c.value).trim().toUpperCase())) {
          (next as Record<string, unknown>)[c.key] = c.value;
          applied.push(c.label);
        }
      }
      return next;
    });

    if (applied.length > 0) {
      setImportMsg(`Zaimportowano z ubezpieczenia: ${applied.join(', ')}. Kliknij „Zapisz pojazd”, aby zachować zmiany.`);
    } else {
      setImportMsg('Wszystkie dane odczytane z polisy pokrywają się już z formularzem.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 bg-side text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Car className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="font-bold text-base">Edytuj pojazd</h2>
              <p className="text-xs text-slate-400 font-num">{vehicle.registrationNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6 overflow-y-auto">
          {/* Zdjęcie + podstawowe dane */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
            <div className="md:col-span-2">
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                {form.photoDataUrl ? (
                  <img src={form.photoDataUrl} alt="Zdjęcie pojazdu" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-slate-400">
                    <Car className="w-12 h-12 mx-auto mb-1" />
                    <span className="text-xs">Brak zdjęcia</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Camera className="w-4 h-4" /> {form.photoDataUrl ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                </button>
                {form.photoDataUrl && (
                  <button
                    type="button"
                    onClick={() => set('photoDataUrl', undefined)}
                    className="px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Usuń zdjęcie"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              <p className="text-[11px] text-slate-400 mt-1">Zdjęcie zostanie zmniejszone automatycznie.</p>
            </div>

            <div className="md:col-span-3 grid grid-cols-2 gap-3 content-start">
              <div>
                <label className={labelCls}>Marka *</label>
                <input required value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} placeholder="np. Audi" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input value={form.model || ''} onChange={(e) => set('model', e.target.value)} placeholder="np. Q4 e-tron" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Numer rejestracyjny *</label>
                <input required value={form.registrationNumber || ''} onChange={(e) => set('registrationNumber', e.target.value)} className={`${inputCls} font-num uppercase`} />
              </div>
              <div>
                <label className={labelCls}>Rok produkcji</label>
                <input type="number" min={1950} max={2100} value={form.productionYear || ''} onChange={(e) => set('productionYear', e.target.value ? Number(e.target.value) : undefined)} className={`${inputCls} font-num`} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>VIN</label>
                <input value={form.vin || ''} maxLength={17} onChange={(e) => set('vin', e.target.value)} className={`${inputCls} font-num uppercase`} placeholder="17 znaków" />
              </div>
              <div>
                <label className={labelCls}>Napęd</label>
                <select value={form.fuelType || ''} onChange={(e) => set('fuelType', e.target.value)} className={inputCls}>
                  <option value="Elektryczny">Elektryczny (EV)</option>
                  <option value="Benzyna">Benzyna</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Hybryda">Hybryda (PHEV/HEV)</option>
                  <option value="LPG">LPG</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Kolor</label>
                <input value={form.color || ''} onChange={(e) => set('color', e.target.value)} placeholder="np. szary" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Terminy */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-line bg-subtle space-y-2">
              <div className="text-xs font-semibold text-ink flex items-center gap-1.5"><Wrench className="w-4 h-4 text-warn" /> Najbliższy przegląd ASO</div>
              {dateField('asoInspectionDate')}
              <input type="number" min={0} value={form.asoInspectionKm || ''} onChange={(e) => set('asoInspectionKm', e.target.value ? Number(e.target.value) : undefined)} placeholder="lub przy km" className={`${inputCls} font-num`} />
            </div>

            <div className="md:col-span-2 p-3 rounded-xl border border-line bg-subtle space-y-2">
              <div className="text-xs font-semibold text-ink flex items-center gap-1.5"><CalendarCheck className="w-4 h-4 text-ok" /> Badanie techniczne</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div className="min-w-0">
                  <label className="block text-[11px] font-semibold text-ink-2 mb-1 whitespace-nowrap overflow-hidden text-ellipsis" title="Data pierwszej rejestracji – pole B w dowodzie rejestracyjnym">Pierwsza rejestracja (B)</label>
                  {dateField('firstRegistrationDate')}
                </div>
                <div className="min-w-0">
                  <label className="block text-[11px] font-semibold text-ink-2 mb-1 whitespace-nowrap overflow-hidden text-ellipsis" title="Data ostatniego badania technicznego">Ostatnie badanie</label>
                  {dateField('lastTechInspectionDate')}
                </div>
                <div className="min-w-0">
                  <label className="block text-[11px] font-semibold text-ink-2 mb-1 whitespace-nowrap overflow-hidden text-ellipsis" title="Termin następnego badania wpisany w dowodzie – ma pierwszeństwo nad obliczeniem">Następne (z dowodu)</label>
                  {dateField('techInspectionDate')}
                </div>
              </div>
              {(() => {
                const t = computeTechInspection(form as Vehicle);
                return (
                  <div className="text-xs text-ink-2 space-y-0.5">
                    <div>
                      Następne badanie: <b className="font-num text-ink">{t.due || '—'}</b>
                      {t.source === 'estimated' && <span className="text-warn"> (szacunek)</span>}
                    </div>
                    <div className="text-ink-3">{t.explanation}</div>
                    {t.computedDue && <div className="text-warn">Z daty rejestracji wychodzi {t.computedDue} – sprawdź pieczątkę w dowodzie.</div>}
                    <div className="text-ink-3">Zasada: 1. badanie do 3 lat od pierwszej rejestracji, 2. do 5 lat, potem co rok. Termin z dowodu (jeśli wpiszesz) ma pierwszeństwo.</div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-subtle text-xs text-ink-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="w-4 h-4 text-brand shrink-0" />
              <span className="font-semibold text-ink">Ubezpieczenie:</span>
              {(() => {
                const list = activeCovers(getInsurance(vehicle));
                return list.length ? list.map((c) => <span key={c.kind} className="px-2 py-0.5 rounded-md bg-white border border-line font-num">{COVER_LABELS[c.kind]} do {c.cover.to || '?'}</span>) : <span>brak danych</span>;
              })()}
              {(Object.values(cachedInsuranceData).some(Boolean) || vehicle.insurance?.policyFile) && (
                <button
                  type="button"
                  disabled={importingIns}
                  onClick={handleImportFromInsurance}
                  className="ml-auto px-3 py-1.5 rounded-lg bg-white border border-line-strong hover:bg-brand-soft hover:border-brand text-brand font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {importingIns ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Importuj dane z Ubezpieczenia
                </button>
              )}
            </div>
            {importMsg && <div className="text-xs font-medium text-brand bg-brand-soft rounded-lg px-2.5 py-1.5">{importMsg}</div>}
            <div className="text-ink-3">
              OC, AC i NNW (oraz wczytanie polisy z PDF) edytujesz w zakładce „Ubezpieczenie”.
            </div>
          </div>

          {/* Ewidencja */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Dzień rozpoczęcia ewidencji</label>
              {dateField('registerStartDate')}
            </div>
            <div>
              <label className={labelCls}>Stan licznika na start (km)</label>
              <input type="number" min={0} value={form.initialOdometer ?? 0} onChange={(e) => set('initialOdometer', Number(e.target.value))} className={`${inputCls} font-num`} />
              {initialChanged && hasEntries && (
                <p className="text-[11px] text-amber-700 mt-1 flex gap-1"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> Zmieni km pierwszego wpisu.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Data złożenia VAT-26</label>
              {dateField('vat26Date')}
            </div>
          </div>

          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}

          {/* Usunięcie pojazdu */}
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-red-600">Usuń pojazd…</summary>
            <div className="mt-2 p-3 rounded-lg border border-red-200 bg-red-50 space-y-2">
              <p className="text-red-800">
                Usunięcie skasuje pojazd razem z całą ewidencją ({entries.length} wpisów), kosztami i załącznikami. Tego nie da się cofnąć.
                Wpisz numer rejestracyjny <b className="font-num">{vehicle.registrationNumber}</b>, aby potwierdzić.
              </p>
              <div className="flex gap-2">
                <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} className={`${inputCls} font-num uppercase`} />
                <button
                  type="button"
                  disabled={saving || confirmDelete.trim().toUpperCase() !== vehicle.registrationNumber.toUpperCase()}
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg font-semibold whitespace-nowrap"
                >
                  Usuń pojazd
                </button>
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>
            <button type="submit" disabled={saving} className="px-5 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <Save className="w-4 h-4" /> Zapisz pojazd
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
