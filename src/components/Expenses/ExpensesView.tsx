import React, { useState } from 'react';
import { useFleet } from '../../context/FleetContext';
import { Expense } from '../../types/fleet';
import { useConfirm } from '../ui/ConfirmDialog';
import {
  Receipt,
  Plus,
  Trash2,
} from 'lucide-react';
import { getTodayDDMMYYYY, isoToDDMMYYYY, ddmmyyyyToIso } from '../../lib/dateUtils';

const toCents = (v: number) => Math.round(v * 100);
const fromCents = (c: number) => c / 100;
const fmtPln = (v: number) => v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ExpensesView: React.FC = () => {
  const { activeVehicle, expenses, addExpense, deleteExpense, entries } = useFleet();
  const confirm = useConfirm();

  const [date, setDate] = useState(getTodayDDMMYYYY());
  const [category, setCategory] = useState<Expense['category']>('Paliwo / Ładowanie');
  const [grossAmount, setGrossAmount] = useState<number | ''>('');
  const [netAmount, setNetAmount] = useState<number | ''>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [notes, setNotes] = useState('');
  const [odometerReading, setOdometerReading] = useState<number | ''>(activeVehicle?.currentOdometer || '');
  const [formError, setFormError] = useState<string | null>(null);

  if (!activeVehicle) {
    return (
      <div className="p-8 text-center card">
        <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Wybierz pojazd, aby zarządzać kosztami.</p>
      </div>
    );
  }

  const vehicleExpenses = expenses.filter((e) => e.vehicleId === activeVehicle.id);
  const totalGross = fromCents(vehicleExpenses.reduce((s, e) => s + toCents(e.grossAmount), 0));
  const totalVat = fromCents(vehicleExpenses.reduce((s, e) => s + toCents(e.vatAmount || 0), 0));

  const totalKm = entries
    .filter((e) => e.vehicleId === activeVehicle.id && !e.odometerConflict)
    .reduce((s, e) => s + e.distanceKm, 0);

  const costPerKm = totalKm > 0 ? (totalGross / totalKm).toFixed(2) : '0.00';

  const calcVatFromGross = (gross: number) => {
    const grossCents = toCents(gross);
    const vatCents = Math.round((grossCents * 23) / 123);
    return { grossCents, vatCents, netCents: grossCents - vatCents };
  };

  const handleGrossChange = (val: number | '') => {
    setFormError(null);
    setGrossAmount(val);
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      const { netCents } = calcVatFromGross(val);
      setNetAmount(fromCents(netCents));
    } else {
      setNetAmount('');
    }
  };

  const handleNetChange = (val: number | '') => {
    setFormError(null);
    setNetAmount(val);
    if (grossAmount === '' && typeof val === 'number' && Number.isFinite(val) && val > 0) {
      const netCents = toCents(val);
      const vatCents = Math.round((netCents * 23) / 100);
      setGrossAmount(fromCents(netCents + vatCents));
    }
  };

  const previewAmounts = (() => {
    if (typeof grossAmount !== 'number' || !Number.isFinite(grossAmount) || grossAmount <= 0) return null;
    const grossCents = toCents(grossAmount);
    const netCents = typeof netAmount === 'number' && Number.isFinite(netAmount) ? toCents(netAmount) : calcVatFromGross(grossAmount).netCents;
    const vatCents = grossCents - netCents;
    return { gross: fromCents(grossCents), net: fromCents(netCents), vat: fromCents(vatCents), valid: netCents >= 0 && netCents <= grossCents };
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (typeof grossAmount !== 'number' || !Number.isFinite(grossAmount) || grossAmount <= 0 || !invoiceNumber.trim()) return;

    const grossCents = toCents(grossAmount);
    const netCents =
      netAmount !== '' && typeof netAmount === 'number' && Number.isFinite(netAmount)
        ? toCents(netAmount)
        : calcVatFromGross(grossAmount).netCents;
    if (netCents < 0 || netCents > grossCents) {
      setFormError('Kwota netto musi mieścić się między 0 a kwotą brutto.');
      return;
    }
    const vatCents = grossCents - netCents;

    addExpense({
      vehicleId: activeVehicle.id,
      date,
      category,
      grossAmount: fromCents(grossCents),
      netAmount: fromCents(netCents),
      vatAmount: fromCents(vatCents),
      invoiceNumber: invoiceNumber.trim(),
      sellerName: sellerName.trim() || undefined,
      odometerReading: odometerReading ? Number(odometerReading) : undefined,
      notes: notes.trim() || undefined,
    });

    setGrossAmount('');
    setNetAmount('');
    setInvoiceNumber('');
    setSellerName('');
    setNotes('');
  };

  const handleDeleteExpense = async (exp: Expense) => {
    const r = await confirm({
      title: `Usunąć fakturę ${exp.invoiceNumber}?`,
      message: `${exp.date} · ${exp.category}${exp.sellerName ? ` · ${exp.sellerName}` : ''} · ${fmtPln(exp.grossAmount)} zł brutto`,
      tone: 'danger',
      confirmLabel: 'Usuń fakturę',
    });
    if (!r.ok) return;
    await deleteExpense(exp.id);
  };

  return (
    <div className="space-y-6">
      {/* Karty podsumowania kosztów */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-1">
            Wydatki łączne (brutto)
          </div>
          <div className="text-2xl font-bold font-num text-slate-900">
            {fmtPln(totalGross)} zł
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Liczba faktur: <span className="font-num font-semibold">{vehicleExpenses.length}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-1">
            Średni koszt na 1 km
          </div>
          <div className="text-2xl font-bold font-num text-brand">
            {costPerKm} <span className="text-sm font-normal text-slate-500">zł / km</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Na bazie <span className="font-num font-semibold">{totalKm} km</span> w ewidencji
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-1">
            Odliczony VAT 100%
          </div>
          <div className="text-2xl font-bold font-num text-emerald-600">
            {fmtPln(totalVat)} zł
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Oszczędność podatkowa dzięki VAT-26
          </div>
        </div>
      </div>

      {/* Formularz dodania wydatku */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 mb-4">
          <Plus className="w-4 h-4 text-brand" />
          <h3 className="font-bold text-sm text-slate-800">Zarejestruj fakturę kosztową pojazdu</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data faktury (DD.MM.RRRR) *</label>
              <input
                type="date"
                required
                value={ddmmyyyyToIso(date)}
                onChange={(e) => setDate(isoToDDMMYYYY(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-num"
              />
              <div className="text-[11px] text-slate-400 mt-0.5 font-num">{date}</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kategoria kosztu *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="Paliwo / Ładowanie">Paliwo / Ładowanie</option>
                <option value="Serwis / ASO">Serwis / Naprawa / ASO</option>
                <option value="Ubezpieczenie">Ubezpieczenie (OC/AC/NNW)</option>
                <option value="Myjnia">Myjnia / Kosmetyka</option>
                <option value="Opłaty drogowe">Opłaty drogowe / Parkingi</option>
                <option value="Części i akcesoria">Części i akcesoria / Opony</option>
                <option value="Rata / Leasing">Rata / Leasing / Wynajem</option>
                <option value="Inne">Inne</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kwota brutto (zł) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={grossAmount}
                onChange={(e) => handleGrossChange(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-num font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kwota netto (zł)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Auto (23% VAT)"
                value={netAmount}
                onChange={(e) => handleNetChange(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-num"
              />
              {previewAmounts && (
                <div className={`text-[11px] mt-0.5 font-num ${previewAmounts.valid ? 'text-emerald-700' : 'text-danger'}`}>
                  VAT: {fmtPln(previewAmounts.vat)} zł
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Numer faktury / paragonu *</label>
              <input
                type="text"
                required
                placeholder="np. FV/2023/08/123"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-num"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sprzedawca / Stacja / Serwis</label>
              <input
                type="text"
                placeholder="np. Orlen, GreenWay, ASO BMW"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Stan licznika przy tankowaniu/naprawie (km)</label>
              <input
                type="number"
                placeholder="np. 4806"
                value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-num"
              />
            </div>
          </div>

          {formError && <div className="text-xs text-danger bg-danger-soft rounded-lg px-3 py-2">{formError}</div>}

          <div className="flex items-center justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Zapisz fakturę kosztową</span>
            </button>
          </div>
        </form>
      </div>

      {/* Tabela wydatków */}
      <div className="card overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-200 font-bold text-sm text-slate-800">
          Zarejestrowane faktury i koszty eksploatacji
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[10px]">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Kategoria</th>
                <th className="px-4 py-3">Nr faktury</th>
                <th className="px-4 py-3">Sprzedawca</th>
                <th className="px-4 py-3 text-right">Netto</th>
                <th className="px-4 py-3 text-right">VAT</th>
                <th className="px-4 py-3 text-right">Brutto</th>
                <th className="px-4 py-3 text-center">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicleExpenses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Brak zapisanych kosztów dla tego pojazdu.
                  </td>
                </tr>
              ) : (
                vehicleExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-num font-medium text-slate-800">{exp.date}</td>
                    <td className="px-4 py-3 text-slate-700">{exp.category}</td>
                    <td className="px-4 py-3 font-num text-slate-700">{exp.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{exp.sellerName || '-'}</td>
                    <td className="px-4 py-3 text-right font-num text-slate-600">
                      {exp.netAmount !== undefined ? `${fmtPln(exp.netAmount)} zł` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-num text-emerald-600">
                      {exp.vatAmount !== undefined ? `${fmtPln(exp.vatAmount)} zł` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-num font-bold text-slate-900">
                      {fmtPln(exp.grossAmount)} zł
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteExpense(exp)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                        title="Usuń fakturę"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
