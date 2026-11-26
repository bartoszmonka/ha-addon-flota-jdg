import React, { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { ImportPreview, checkBeforeImport, parseRegisterXlsx, toEntryInputs } from '../../lib/importXlsx';
import { ddmmyyyyToIso, isoToDDMMYYYY, getPolishMonthName } from '../../lib/dateUtils';
import { EARLIEST, formatAddress } from '../../lib/address';
import { useConfirm } from '../ui/ConfirmDialog';

/**
 * Import dotychczasowej ewidencji z pliku Excel (arkusz na każdy miesiąc).
 * Pokazuje podgląd z wykrytymi problemami – nic nie jest zapisywane przed kliknięciem „Importuj”.
 */
export const ImportPanel: React.FC = () => {
  const { vehicles, activeVehicle, addVehicle, setActiveVehicle, importEntries, taxpayer, updateTaxpayer, entries } = useFleet();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [targetVehicleId, setTargetVehicleId] = useState<string>('__new__');
  const [closeImported, setCloseImported] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [useFileAddresses, setUseFileAddresses] = useState(true);
  const [, force] = useState(0);
  const confirm = useConfirm();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const p = await parseRegisterXlsx(f);
      if (!p.rows.length) throw new Error('Nie znaleziono wpisów – czy to plik ewidencji w formacie „arkusz na miesiąc”?');
      setPreview(p);
      setFileName(f.name);
      const match = vehicles.find((v) => p.plate && v.registrationNumber.toUpperCase() === p.plate);
      setTargetVehicleId(match?.id || '__new__');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const included = preview?.rows.filter((r) => r.include) || [];
  const missingDates = included.filter((r) => r.needsDate && !r.date);
  const withIssues = preview?.rows.filter((r) => r.issues.length) || [];
  const importMonths = useMemo(
    () => Array.from(new Set(included.filter((r) => r.date).map((r) => `${r.date.slice(6)}-${r.date.slice(3, 5)}`))).sort(),
    [preview, included.length, missingDates.length]
  );
  const targetHasEntries = targetVehicleId !== '__new__' && activeVehicle?.id === targetVehicleId && entries.length > 0;

  const handleImport = async () => {
    if (!preview) return;
    if (missingDates.length) {
      setError('Uzupełnij brakujące daty albo odznacz te wiersze.');
      return;
    }
    const init0 = targetVehicleId === '__new__'
      ? preview.initialOdometer ?? 0
      : vehicles.find((v) => v.id === targetVehicleId)?.initialOdometer ?? 0;
    const problems = checkBeforeImport(preview, init0);
    if (problems.length) {
      setError(`Nie importuję – popraw najpierw:\n${problems.join('\n')}`);
      return;
    }
    if (targetVehicleId !== '__new__') {
      const plate = vehicles.find((v) => v.id === targetVehicleId)?.registrationNumber || '';
      const r = await confirm({
        title: `Zastąpić ewidencję pojazdu ${plate}?`,
        message: (
          <>
            Wszystkie dotychczasowe wpisy{targetHasEntries ? ` (${entries.length})` : ''}, zamknięcia miesięcy i załączniki do wpisów zostaną <b>usunięte</b>, a w ich
            miejsce trafi {included.length} wpisów z pliku. Tego nie da się cofnąć – jeśli chcesz kopię, anuluj i pobierz najpierw eksport do Excela.
          </>
        ),
        confirmLabel: 'Usuń stare i importuj',
        tone: 'danger',
      });
      if (!r.ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      let vid = targetVehicleId;
      let init = vehicles.find((v) => v.id === vid)?.initialOdometer;
      if (vid === '__new__') {
        init = preview.initialOdometer ?? 0;
        vid = await addVehicle({
          registrationNumber: preview.plate || 'BEZ-NUMERU',
          brand: 'Samochód firmowy',
          model: '',
          initialOdometer: preview.initialOdometer ?? 0,
          currentOdometer: included[included.length - 1]?.odometerEnd ?? preview.initialOdometer ?? 0,
          registerStartDate: preview.firstDate || undefined,
        });
      }
      const rows = toEntryInputs(preview, taxpayer.defaultDriverName);
      // ostatni miesiąc zostaje otwarty – zwykle jest jeszcze uzupełniany
      const toClose = closeImported ? importMonths.slice(0, -1) : [];
      const n = await importEntries(vid, rows, { closeMonths: toClose, replaceExisting: true, initialOdometer: init });
      const profileUpdate: Parameters<typeof updateTaxpayer>[0] = {};
      if (!taxpayer.companyName && preview.companyName) profileUpdate.companyName = preview.companyName;
      if (useFileAddresses && preview.addressHistory.length) {
        profileUpdate.addresses = preview.addressHistory;
        profileUpdate.address = formatAddress(preview.addressHistory[preview.addressHistory.length - 1]);
      }
      if (Object.keys(profileUpdate).length) await updateTaxpayer(profileUpdate);
      const v = vehicles.find((x) => x.id === vid);
      if (v) setActiveVehicle(v);
      setDone(`Zaimportowano ${n} wpisów z ${importMonths.length} miesięcy${toClose.length ? `, zamknięto ${toClose.length}` : ''}.`);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6 ">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-5">
        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-base text-slate-900">Import ewidencji z Excela</h2>
          <p className="text-xs text-slate-500">
            Wczytaj dotychczasowy plik (arkusz na każdy miesiąc). Zobaczysz podgląd z wykrytymi błędami, zanim cokolwiek zapiszemy.
          </p>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        <span>Wybierz plik .xlsx</span>
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={busy} />
      </label>

      {error && <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-line">{error}</div>}
      {done && (
        <div className="mt-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> {done}
        </div>
      )}

      {preview && (
        <div className="mt-5 space-y-4 text-xs">
          <div className="grid sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div><span className="text-slate-500">Plik:</span> <b>{fileName}</b></div>
            <div><span className="text-slate-500">Pojazd w pliku:</span> <b className="font-num">{preview.plate || '—'}</b></div>
            <div><span className="text-slate-500">Podatnik:</span> {preview.taxpayerLine || '—'}</div>
            <div>
              <span className="text-slate-500">Start:</span> <b className="font-num">{preview.firstDate}</b>, licznik <b className="font-num">{preview.initialOdometer} km</b>
            </div>
            <div><span className="text-slate-500">Wpisy do importu:</span> <b>{included.length}</b> z {preview.rows.length}</div>
            <div><span className="text-slate-500">Miesiące:</span> <b>{importMonths.length}</b></div>
          </div>

          {preview.warnings.map((w) => (
            <div key={w} className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {w}
            </div>
          ))}

          {withIssues.length > 0 && (
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-amber-50 font-semibold text-amber-900 flex items-center justify-between">
                <span>Do sprawdzenia: {withIssues.length} wierszy</span>
                {withIssues.length > 8 && (
                  <button onClick={() => setShowAll((s) => !s)} className="text-amber-700 underline">
                    {showAll ? 'zwiń' : 'pokaż wszystkie'}
                  </button>
                )}
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-amber-100">
                  {(showAll ? withIssues : withIssues.slice(0, 8)).map((r) => (
                    <tr key={r.key} className={r.include ? '' : 'opacity-60'}>
                      <td className="p-2 align-top">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => {
                            r.include = e.target.checked;
                            force((n) => n + 1);
                          }}
                          title="Importuj ten wiersz"
                        />
                      </td>
                      <td className="p-2 align-top whitespace-nowrap">{r.sheet} · nr {r.lp}</td>
                      <td className="p-2 align-top">
                        <div className="text-slate-800">{r.route}</div>
                        {r.issues.map((i) => (
                          <div key={i} className="text-amber-800">• {i}</div>
                        ))}
                        {r.needsDate && r.include && (
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="date"
                              value={ddmmyyyyToIso(r.date)}
                              min={r.dateMin ? ddmmyyyyToIso(r.dateMin) : undefined}
                              max={r.dateMax ? ddmmyyyyToIso(r.dateMax) : undefined}
                              onChange={(e) => {
                                r.date = isoToDDMMYYYY(e.target.value);
                                force((n) => n + 1);
                              }}
                              className="px-2 py-1 border border-amber-300 rounded font-num"
                            />
                            {r.dateMin && r.dateMax && <span className="text-slate-500">dozwolone: {r.dateMin} – {r.dateMax}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">Importuj do pojazdu</label>
            <select
              value={targetVehicleId}
              onChange={(e) => setTargetVehicleId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option value="__new__">Nowy pojazd {preview.plate || ''} (z danych pliku)</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} – {v.brand} {v.model}
                </option>
              ))}
            </select>
            {preview.addressHistory.length > 0 && (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                <label className="flex items-center gap-2 font-semibold text-slate-700">
                  <input type="checkbox" checked={useFileAddresses} onChange={(e) => setUseFileAddresses(e.target.checked)} />
                  Ustaw adresy działalności z pliku ({preview.addressHistory.length})
                  {(taxpayer.addresses?.length || 0) > 0 && <span className="font-normal text-amber-700">– zastąpi adresy w Ustawieniach</span>}
                </label>
                <ul className="mt-1 ml-6 text-slate-600 space-y-0.5">
                  {preview.addressHistory.map((a) => (
                    <li key={a.id}>
                      {a.validFrom === EARLIEST ? 'od początku' : `od ${getPolishMonthName(a.validFrom)} ${a.validFrom.slice(0, 4)}`}: {formatAddress(a)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={closeImported} onChange={(e) => setCloseImported(e.target.checked)} />
              Zamknij zaimportowane miesiące (oprócz ostatniego)
            </label>
            {targetVehicleId !== '__new__' && (
              <div className="flex items-start gap-2 text-red-700 bg-red-50 rounded-lg p-2.5">
                <span>⚠</span>
                <span>
                  Import <b>zastąpi całą ewidencję</b> tego pojazdu: usunie obecne wpisy{targetHasEntries ? ` (${entries.length})` : ''}, zamknięcia miesięcy i załączniki do wpisów.
                  Jeśli chcesz zachować kopię, najpierw pobierz eksport do Excela.
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              disabled={busy || included.length === 0 || missingDates.length > 0}
              className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-lg font-semibold"
            >
              Importuj {included.length} wpisów
            </button>
            <button onClick={() => setPreview(null)} className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg">
              Anuluj
            </button>
            {missingDates.length > 0 && <span className="text-amber-700">Uzupełnij {missingDates.length} brakujących dat.</span>}
          </div>
        </div>
      )}
    </div>
  );
};
