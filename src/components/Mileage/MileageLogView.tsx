import React, { useEffect, useMemo, useState } from 'react';
import { formatRoute } from '../../lib/route';
import { useFleet } from '../../context/FleetContext';
import { MileageEntry } from '../../types/fleet';
import {
  FileSpreadsheet,
  Lock,
  Unlock,
  Plus,
  Paperclip,
  Trash2,
  Pencil,
  FileDown,
  AlertTriangle,
  History,
  X,
  Check,
  CheckCircle2,
  CalendarRange,
} from 'lucide-react';
import {
  getMonthBounds,
  getPolishMonthName,
  getPolishMonthNameGenitive,
  getTodayDDMMYYYY,
  isoToDDMMYYYY,
  ddmmyyyyToIso,
  getMonthKeyFromDDMMYYYY,
} from '../../lib/dateUtils';
import { downloadVatMileagePdf, downloadFullRegisterPdf } from '../../lib/exportPdf';
import { exportMonthToExcel, exportAllMonthsToExcel } from '../../lib/exportExcel';
import { AttachmentModal } from './AttachmentModal';
import { taxpayerForMonth } from '../../lib/address';
import { PageHeader } from '../ui/PageHeader';
import { Badge } from '../ui/Badge';
import { Dropdown } from '../ui/Dropdown';
import { EntryForm } from './EntryForm';
import { BulkAddPanel } from './BulkAddPanel';
import { useConfirm } from '../ui/ConfirmDialog';
import { daysOfMonth, holidayName, weekdayName, weekdayOf } from '../../lib/calendar';
import { getAffectedClosedMonths } from '../../lib/mileageCalc';

const fmtKm = (n: number) => n.toLocaleString('pl-PL');

export const MileageLogView: React.FC = () => {
  const {
    activeVehicle,
    taxpayer,
    entries,
    months,
    currentMonthKey,
    setCurrentMonthKey,
    updateMileageEntry,
    deleteMileageEntry,
    monthlyLedgers,
    closeMonth,
    reopenMonth,
    validationIssues,
    correctWithShift,
    haLive,
  } = useFleet();
  const confirm = useConfirm();

  const [attachmentsEntryId, setAttachmentsEntryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | undefined>(undefined);
  /** dzień bez wyjazdu, pod którym otwarto formularz dodawania („+ dodaj” w tabeli) */
  const [inlineAddDate, setInlineAddDate] = useState<string | null>(null);
  /** wpis, pod którym otwarto dodawanie kolejnego wyjazdu tego samego dnia */
  const [addAfterId, setAddAfterId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showEmptyDays, setShowEmptyDays] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // wejście w zakładkę = zawsze bieżący miesiąc
  useEffect(() => {
    const d = new Date();
    setCurrentMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEditingId(null);
    setAddDate(undefined);
    setInlineAddDate(null);
    setAddAfterId(null);
    setBulkOpen(false);
    setActionError(null);
    setReopenOpen(false);
  }, [currentMonthKey]);

  const years = useMemo(() => Array.from(new Set(months.map((m) => m.slice(0, 4)))), [months]);
  const currentYear = currentMonthKey.slice(0, 4);

  if (!activeVehicle) {
    return (
      <div className="card p-8 text-center">
        <FileSpreadsheet className="w-12 h-12 text-ink-3 mx-auto mb-3" />
        <p className="text-ink-2 font-medium">Wybierz lub dodaj pojazd, aby wyświetlić ewidencję przebiegu VAT.</p>
      </div>
    );
  }

  const currentMonthEntries = entries.filter((e) => e.monthKey === currentMonthKey);
  const validEntries = entries.filter((e) => !e.odometerConflict);
  const validMonthEntries = currentMonthEntries.filter((e) => !e.odometerConflict);
  const conflictMonthCount = currentMonthEntries.length - validMonthEntries.length;
  const monthTaxpayer = taxpayerForMonth(taxpayer, currentMonthKey);
  const ledger = monthlyLedgers[currentMonthKey];
  const isClosed = ledger?.isClosed ?? false;
  const bounds = getMonthBounds(currentMonthKey);
  const monthName = getPolishMonthName(currentMonthKey);
  const monthNameGen = getPolishMonthNameGenitive(currentMonthKey);
  const year = Number(currentMonthKey.slice(0, 4));
  const startOdometer = ledger?.startOdometer ?? activeVehicle.initialOdometer;
  const endOdometer = ledger?.endOdometer ?? startOdometer;
  const totalMonthDistance = ledger?.totalDistanceKm ?? 0;
  const monthIssues = validationIssues.filter((i) => i.monthKey === currentMonthKey);
  const lastEntry = validEntries[validEntries.length - 1];
  // km, które licznik (z Home Assistant) przejechał ponad ostatni wpis ewidencji
  const unassignedKm =
    haLive?.odometerKm != null && lastEntry ? Math.max(0, Math.round(haLive.odometerKm - lastEntry.odometerEnd)) : null;

  // wiersze tabeli: wpisy + (opcjonalnie) szare dni bez wyjazdu – tylko na ekranie, nie w eksporcie
  const todayIso = new Date().toISOString().slice(0, 10);
  const byDay = new Map<string, MileageEntry[]>();
  currentMonthEntries.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) || []), e]));
  const tableRows: ({ kind: 'entry'; entry: MileageEntry } | { kind: 'empty'; date: string })[] = [];
  for (const d of daysOfMonth(currentMonthKey)) {
    const list = byDay.get(d);
    if (list) list.forEach((entry) => tableRows.push({ kind: 'entry', entry }));
    else if (showEmptyDays && ddmmyyyyToIso(d) <= todayIso) tableRows.push({ kind: 'empty', date: d });
  }
  // wpisy z datą spoza miesiąca (błędne) – na końcu, żeby nie zginęły
  currentMonthEntries.filter((e) => !daysOfMonth(currentMonthKey).includes(e.date)).forEach((entry) => tableRows.push({ kind: 'entry', entry }));
  const emptyDaysCount = daysOfMonth(currentMonthKey).filter((d) => !byDay.has(d) && ddmmyyyyToIso(d) <= todayIso).length;

  const runAction = async (fn: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (entry: MileageEntry) => {
    const idx = validEntries.findIndex((e) => e.id === entry.id);
    const isLastOrConflict = Boolean(entry.odometerConflict) || lastEntry?.id === entry.id;
    const shiftsLater = !isLastOrConflict && idx >= 0 && validEntries[idx + 1]?.odometerStartOverride === undefined;
    const affectedClosed = shiftsLater
      ? getAffectedClosedMonths(entries, { kind: 'delete', id: entry.id }, activeVehicle.initialOdometer, monthlyLedgers, months)
      : [];
    const warnings = affectedClosed.length
      ? [
          `Usunięcie zmieni stany licznika także w zamkniętych miesiącach: ${affectedClosed
            .map((m) => `${getPolishMonthName(m)} ${m.slice(0, 4)}`)
            .join(', ')} (korekta trafi do historii tych miesięcy).`,
        ]
      : undefined;
    const r = await confirm({
      title: entry.odometerConflict ? `Usunąć błędny wpis z ${entry.date}?` : `Usunąć wpis nr ${entry.entryNumber} z ${entry.date}?`,
      message: !shiftsLater
        ? `${formatRoute(entry.routeDescription)} · ${entry.distanceKm} km`
        : `${formatRoute(entry.routeDescription)} · ${entry.distanceKm} km\n\nStany licznika we wszystkich kolejnych wpisach zmniejszą się o ${entry.distanceKm} km, a kilometry tych wpisów się nie zmienią.`,
      warnings,
      tone: 'danger',
      confirmLabel: 'Usuń wpis',
    });
    if (!r.ok) return;
    if (editingId === entry.id) setEditingId(null);
    runAction(async () => {
      if (isLastOrConflict) await deleteMileageEntry(entry.id);
      else await correctWithShift({ kind: 'delete', id: entry.id }, `usunięty wpis z ${entry.date}`);
    });
  };

  const getValidateTarget = (entry: MileageEntry) => {
    if (!entry.odometerConflict || entry.distanceKm <= 0) return null;
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx < 0) return null;
    const prevValid = [...entries.slice(0, idx)].reverse().find((e) => !e.odometerConflict);
    const prevEnd = prevValid ? prevValid.odometerEnd : activeVehicle.initialOdometer;
    const nextValid = entries.slice(idx + 1).find((e) => !e.odometerConflict);
    const newEnd = nextValid ? nextValid.odometerStart : prevEnd + entry.distanceKm;
    const newStart = nextValid ? newEnd - entry.distanceKm : prevEnd;
    if (newStart < activeVehicle.initialOdometer || newEnd <= newStart) return null;
    return {
      newStart,
      newEnd,
      odometerStartOverride: newStart !== prevEnd ? newStart : undefined,
    };
  };

  const handleValidateEntry = (entry: MileageEntry) => {
    const target = getValidateTarget(entry);
    if (!target) return;
    if (editingId === entry.id) setEditingId(null);
    runAction(async () => {
      await updateMileageEntry(entry.id, {
        odometerEnd: target.newEnd,
        odometerStartOverride: target.odometerStartOverride,
      });
    });
  };

  // Eksporty
  const monthsWithEntries = months.filter((m) => (monthlyLedgers[m]?.entriesCount || 0) > 0);
  const exportCtx = { vehicle: activeVehicle, taxpayer };
  const handleExportMonthPdf = () =>
    runAction(() => downloadVatMileagePdf({ ...exportCtx, monthKey: currentMonthKey, entries: validMonthEntries, ledger }));
  const handleExportAllPdf = () =>
    runAction(() => downloadFullRegisterPdf({ ...exportCtx, months: monthsWithEntries, entries: validEntries, ledgers: monthlyLedgers }));
  const handleExportMonthExcel = () =>
    exportMonthToExcel({ ...exportCtx, monthKey: currentMonthKey, entries: validMonthEntries, ledger });
  const handleExportAllExcel = () => {
    const byMonth: Record<string, MileageEntry[]> = {};
    monthsWithEntries.forEach((m) => (byMonth[m] = validEntries.filter((e) => e.monthKey === m)));
    exportAllMonthsToExcel(activeVehicle, taxpayer, byMonth, monthlyLedgers);
  };

  const attachmentsEntry = entries.find((e) => e.id === attachmentsEntryId) || null;

  const MONTH_SHORT = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
  const btnSecondary = 'px-3.5 py-2.5 bg-white border border-line hover:bg-subtle rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ewidencja przebiegu pojazdu"
        subtitle={`${activeVehicle.registrationNumber} · ${[activeVehicle.brand, activeVehicle.model].filter(Boolean).join(' ')} · dla celów VAT (art. 86a ustawy o VAT)`}
        actions={
          <>
            <Dropdown
              label="PDF"
              icon={<FileDown className="w-4 h-4" />}
              className={btnSecondary}
              items={[
                { label: `Miesiąc: ${monthName} ${year}`, onClick: handleExportMonthPdf, disabled: !validMonthEntries.length },
                { label: 'Cała ewidencja (jeden plik)', onClick: handleExportAllPdf, disabled: !monthsWithEntries.length },
              ]}
            />
            <Dropdown
              label="Excel"
              icon={<FileSpreadsheet className="w-4 h-4" />}
              className={btnSecondary}
              items={[
                { label: `Miesiąc: ${monthName} ${year}`, onClick: handleExportMonthExcel, disabled: !validMonthEntries.length },
                { label: 'Cała ewidencja (arkusz na miesiąc)', onClick: handleExportAllExcel, disabled: !monthsWithEntries.length },
              ]}
            />
            {isClosed ? (
              <button onClick={() => setReopenOpen(true)} disabled={busy} className="px-4 py-2.5 rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 bg-ok-soft text-ok border border-[#BFE6CC] hover:bg-[#d9f1e2]">
                <Unlock className="w-4 h-4" /> Otwórz {monthName}
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (currentMonthEntries.length === 0) {
                    const r = await confirm({
                      title: `Zamknąć ${monthName} ${year} bez wyjazdów?`,
                      message: 'W tym miesiącu nie ma żadnych wpisów. Po zamknięciu miesiąc zostanie oznaczony jako „brak wyjazdów” i nie da się w nim nic dodać, dopóki go nie otworzysz.',
                      confirmLabel: 'Zamknij pusty miesiąc',
                    });
                    if (!r.ok) return;
                  }
                  runAction(() => closeMonth(currentMonthKey));
                }}
                disabled={busy}
                className="px-4 py-2.5 rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white disabled:opacity-40 shadow-sm"
                title="Zamknięty miesiąc jest tylko do odczytu"
              >
                <Lock className="w-4 h-4" /> Zamknij {monthName} {year}
              </button>
            )}
          </>
        }
      />

      {/* Wybór roku i miesiąca */}
      <div className="card p-5 space-y-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => {
                const inYear = months.filter((m) => m.startsWith(y));
                const withData = inYear.filter((m) => (monthlyLedgers[m]?.entriesCount || 0) > 0);
                setCurrentMonthKey((withData[withData.length - 1] || inYear[inYear.length - 1]) as string);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-bold ${y === currentYear ? 'bg-ink text-white' : 'bg-subtle text-ink-2 hover:bg-line'}`}
            >
              {y}
            </button>
          ))}
          {(ledger?.history?.length || 0) > 0 && (
            <button onClick={() => setShowHistory((s) => !s)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 text-ink-2 hover:bg-subtle">
              <History className="w-3.5 h-3.5" /> Historia miesiąca ({ledger?.history?.length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
          {Array.from({ length: 12 }, (_, i) => `${currentYear}-${String(i + 1).padStart(2, '0')}`).map((mKey, i) => {
            const inRange = months.includes(mKey);
            const l = monthlyLedgers[mKey];
            const sel = mKey === currentMonthKey;
            const closed = !!l?.isClosed;
            const monthHasError = validationIssues.some((x) => x.monthKey === mKey && x.level === 'error');
            const hasIssues = validationIssues.some((x) => x.monthKey === mKey);
            const km = l?.totalDistanceKm || 0;
            return (
              <button
                key={mKey}
                disabled={!inRange}
                onClick={() => setCurrentMonthKey(mKey)}
                className={`relative rounded-[10px] py-2 flex flex-col items-center gap-0.5 transition-colors disabled:opacity-40 disabled:cursor-default ${
                  sel ? 'bg-brand text-white shadow-sm' : closed ? 'bg-ok-soft hover:bg-[#d9f1e2]' : 'bg-subtle hover:bg-line'
                }`}
                title={inRange ? `${getPolishMonthName(mKey)}: ${l?.entriesCount || 0} wpisów, ${km} km` : 'poza okresem ewidencji'}
              >
                <span className={`flex items-center gap-1 text-[13px] font-bold ${sel ? '' : km ? 'text-ink' : 'text-ink-3'}`}>
                  {MONTH_SHORT[i]}
                  {closed && <Lock className={`w-[11px] h-[11px] ${sel ? 'text-white' : 'text-ok'}`} />}
                </span>
                <span className={`text-[11px] font-num ${sel ? 'text-white/90' : 'text-ink-3'}`}>{km ? `${fmtKm(km)} km` : '—'}</span>
                {hasIssues && <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${monthHasError ? 'bg-danger' : 'bg-warn'}`} />}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="ok">zamknięty</Badge>
          <Badge tone="info">wybrany</Badge>
          <Badge tone="warn">do sprawdzenia</Badge>
        </div>

        {reopenOpen && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-warn-soft border border-[#F5D9A8] rounded-xl">
            <input
              autoFocus
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Powód otwarcia (zapisze się w historii), np. korekta km we wpisie 5"
              className="flex-1 min-w-[240px] px-3 py-2 border border-line-strong rounded-[10px] text-sm bg-white"
            />
            <button
              onClick={() =>
                runAction(async () => {
                  await reopenMonth(currentMonthKey, reopenReason.trim());
                  setReopenOpen(false);
                  setReopenReason('');
                })
              }
              className="px-4 py-2 bg-warn hover:brightness-95 text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Otwórz miesiąc
            </button>
            <button onClick={() => setReopenOpen(false)} className="p-2 text-ink-3 hover:text-ink">
              <X className="w-4 h-4" />
            </button>
            <div className="basis-full text-xs text-warn">
              Pozostałe miesiące zostaną zamknięte. Jeśli zmienisz tu kilometry, kolejne stany licznika w późniejszych miesiącach przesuną się
              automatycznie (korekta trafi do ich historii).
            </div>
          </div>
        )}

        {showHistory && ledger?.history && (
          <ul className="text-xs text-ink-2 bg-subtle rounded-xl p-3 space-y-1">
            {[...ledger.history].reverse().map((h, i) => (
              <li key={i} className="font-num">
                {new Date(h.at).toLocaleString('pl-PL')} – {h.action === 'close' ? 'zamknięto' : h.action === 'open' ? 'otwarto' : 'korekta stanów licznika'} ({h.by})
                {h.reason ? ` – ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        )}

        {actionError && <div className="text-sm text-danger bg-danger-soft rounded-xl p-3 whitespace-pre-line">{actionError}</div>}
        {monthIssues.length > 0 && (() => {
          const hasErr = monthIssues.some((i) => i.level === 'error');
          return (
            <div className={`text-sm rounded-xl p-3 space-y-1 ${hasErr ? 'text-danger bg-danger-soft' : 'text-warn bg-warn-soft'}`}>
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {hasErr ? 'Błędy do poprawy w tym miesiącu' : 'Do sprawdzenia w tym miesiącu'}
              </div>
              {monthIssues.map((i, idx) => (
                <div key={idx}>• {i.message}</div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Podsumowanie miesiąca */}
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${unassignedKm != null ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {unassignedKm != null && (
          <div className={`card px-[18px] py-3.5 ${unassignedKm > 0 ? 'border-danger' : ''}`}>
            <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide">Nieprzypisane km</div>
            <div className={`text-xl sm:text-[22px] font-num font-bold mt-0.5 ${unassignedKm > 0 ? 'text-danger' : ''}`}>
              {fmtKm(unassignedKm)} km
            </div>
            <div className={`text-xs font-semibold ${unassignedKm > 0 ? 'text-danger' : 'text-ink-3'}`}>
              {unassignedKm > 0 ? 'wymaga natychmiastowej ewidencji' : 'ewidencja zgodna z licznikiem'}
            </div>
          </div>
        )}
        {[
          ['Stan na początek', `${fmtKm(startOdometer)} km`, 'z przeniesienia'],
          [
            'Przejechano',
            `${fmtKm(totalMonthDistance)} km`,
            `${validMonthEntries.length} wpisów${conflictMonthCount > 0 ? ` (+${conflictMonthCount} do poprawy)` : ''}`,
          ],
          ['Stan na koniec', `${fmtKm(endOdometer)} km`, `na ${ledger?.endDate || bounds.end}`],
          ['Strona ewidencji', String(ledger?.pageNumber || 1), `${(ledger?.startDate || bounds.start).slice(0, 5)} – ${ledger?.endDate || bounds.end}`],
        ].map(([l, v, h]) => (
          <div key={l} className="card px-[18px] py-3.5">
            <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide">{l}</div>
            <div className="text-xl sm:text-[22px] font-num font-bold mt-0.5">{v}</div>
            <div className="text-xs font-medium text-ink-3">{h}</div>
          </div>
        ))}
      </div>

      {/* Arkusz ewidencji */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex flex-col md:flex-row md:items-start gap-3 text-xs">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="text-sm font-bold">
              {taxpayer.companyName || <span className="text-danger">Uzupełnij nazwę firmy w Ustawieniach</span>}
              {monthTaxpayer.address ? `, ${monthTaxpayer.address}` : ''}
            </div>
            <div className="text-ink-2 font-num">
              NIP {taxpayer.nip || <span className="text-danger">brak – uzupełnij w Ustawieniach</span>} · pojazd {activeVehicle.registrationNumber}
            </div>
          </div>
          <div className="text-ink-2 md:text-right space-y-0.5">
            <div>
              <span className="font-semibold uppercase tracking-wide">Ewidencja za {monthName} {year}</span> · nr strony {ledger?.pageNumber || 1}
            </div>
            <div className="font-num">
              {ledger?.startDate || bounds.start} – {ledger?.endDate || bounds.end}
              {isClosed && ledger?.closedAt && <span className="text-ok font-sans font-semibold"> · zamknięto {new Date(ledger.closedAt).toLocaleDateString('pl-PL')}</span>}
            </div>
          </div>
        </div>

        <div className="px-6 py-2.5 border-b border-line flex items-center gap-3 text-xs text-ink-2 bg-white">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showEmptyDays} onChange={(e) => setShowEmptyDays(e.target.checked)} />
            Pokaż dni bez wyjazdów ({emptyDaysCount})
          </label>
          <span className="text-ink-3">· szare wiersze są tylko podglądem – nie trafiają do PDF ani Excela</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead className="bg-subtle text-ink-2 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-center font-bold w-14">Nr</th>
                <th className="px-3 py-3 font-bold w-28">Data</th>
                <th className="px-3 py-3 font-bold min-w-[220px]">Trasa (skąd – dokąd)</th>
                <th className="px-3 py-3 font-bold min-w-[220px]">Cel wyjazdu / dowody</th>
                <th className="px-3 py-3 text-center font-bold w-20">Km</th>
                <th className="px-3 py-3 font-bold w-36">Kierowca</th>
                <th className="px-3 py-3 text-right font-bold w-28">Licznik</th>
                <th className="px-3 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-ink-3">
                    Brak wpisów w tym miesiącu. Dodaj wyjazd w formularzu poniżej albo seryjnie.
                  </td>
                </tr>
              ) : (
                tableRows.map((row) => {
                  if (row.kind === 'empty') {
                    const hol = holidayName(row.date);
                    const wd = weekdayOf(row.date);
                    const emptyRow = (
                      <tr className={`border-t border-line text-ink-3 ${inlineAddDate === row.date ? 'bg-brand-soft/60' : 'bg-subtle/80'}`}>
                        <td className="px-4 py-2 text-center">–</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="font-num">{row.date}</div>
                          <div className={`text-[11px] ${wd === 0 || wd === 6 || hol ? 'text-danger/70' : ''}`}>{weekdayName(row.date)}</div>
                        </td>
                        <td colSpan={5} className="px-3 py-2 text-xs italic">
                          brak wyjazdu{hol ? ` · ${hol}` : wd === 0 || wd === 6 ? ' · weekend' : ''}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {!isClosed && (
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setAddAfterId(null);
                                setInlineAddDate((d) => (d === row.date ? null : row.date));
                              }}
                              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-brand hover:bg-brand-soft inline-flex items-center gap-1"
                              title="Dodaj wyjazd w tym dniu"
                            >
                              <Plus className="w-3.5 h-3.5" /> dodaj
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                    return (
                      <React.Fragment key={`empty-${row.date}`}>
                        {emptyRow}
                        {inlineAddDate === row.date && (
                          <tr>
                            <td colSpan={8} className="p-0">
                              <EntryForm mode="add" inline monthKey={currentMonthKey} initialDate={row.date} onDone={() => setInlineAddDate(null)} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  }
                  const entry = row.entry;
                  const attCount = entry.attachments?.length || 0;
                  const isConflict = Boolean(entry.odometerConflict);
                  const validateTarget = isConflict ? getValidateTarget(entry) : null;
                  const hasIssue = validationIssues.some((i) => i.entryId === entry.id);
                  const editing = editingId === entry.id;
                  const wd = weekdayOf(entry.date);
                  const hol = holidayName(entry.date);
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={`border-t border-line ${
                          isConflict
                            ? 'bg-danger-soft/80 hover:bg-danger-soft'
                            : hasIssue
                              ? 'bg-warn-soft hover:bg-subtle/70'
                              : editing
                                ? 'bg-brand-soft/60'
                                : 'hover:bg-subtle/70'
                        }`}
                      >
                        <td
                          className={`px-4 py-3.5 text-center font-num font-bold ${isConflict ? 'text-danger' : 'text-ink-2'}`}
                          title={isConflict ? 'Wpis wyłączony z numeracji i sumy kilometrów – popraw licznik' : undefined}
                        >
                          {isConflict ? '!' : `${entry.entryNumber}.`}
                        </td>
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <div className={`font-num ${isConflict ? 'text-danger font-semibold' : ''}`}>{entry.date}</div>
                          <div className={`text-[11px] ${wd === 0 || wd === 6 || hol ? 'text-danger' : 'text-ink-3'}`}>
                            {weekdayName(entry.date)}
                            {hol ? ` · ${hol}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 leading-snug">{formatRoute(entry.routeDescription)}</td>
                        <td className="px-3 py-3.5 leading-snug">
                          <div className="font-semibold">{entry.purposeDescription}</div>
                          {entry.documentReferences && <div className="text-xs text-ink-3 mt-0.5">Dok: {entry.documentReferences}</div>}
                          {entry.verification && (
                            <div className="text-xs text-warn mt-0.5" title={entry.verification.warnings.join('\n')}>
                              Potwierdzone: {entry.verification.reason}
                            </div>
                          )}
                          {isConflict && (
                            <div className="text-xs text-danger font-semibold mt-0.5" title={entry.conflictReason}>
                              Do poprawy (wyłączony z liczenia): {entry.conflictReason}
                            </div>
                          )}
                          <button
                            onClick={() => setAttachmentsEntryId(entry.id)}
                            className={`mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold ${
                              attCount > 0 ? 'bg-brand-soft text-brand hover:bg-[#dbe5ff]' : 'bg-subtle text-ink-3 hover:bg-line'
                            }`}
                          >
                            <Paperclip className="w-3 h-3" />
                            {attCount > 0 ? (attCount === 1 ? entry.attachments![0].name : `${attCount} załączniki`) : 'Załącz fakturę / bilet'}
                          </button>
                        </td>
                        <td className={`px-3 py-3.5 text-center font-num font-bold text-[15px] ${isConflict || entry.distanceKm <= 0 ? 'text-danger' : ''}`}>
                          <div className={isConflict ? 'line-through decoration-danger/70' : ''}>{entry.distanceKm}</div>
                          {isConflict && <div className="text-[10px] font-sans font-semibold text-danger">wyłączony</div>}
                        </td>
                        <td className="px-3 py-3.5 text-ink-2">{entry.driverName}</td>
                        <td className="px-3 py-3 text-right font-num whitespace-nowrap">
                          <div
                            className={`text-[11px] ${isConflict ? 'text-danger font-semibold' : entry.odometerGap ? 'text-warn font-semibold' : 'text-ink-3'}`}
                            title={
                              isConflict
                                ? entry.conflictReason
                                : entry.odometerGap && entry.prevOdometerEnd !== undefined
                                  ? `Brak ciągłości licznika: poprzedni wpis kończył się na ${fmtKm(entry.prevOdometerEnd)} km`
                                  : undefined
                            }
                          >
                            {isConflict || entry.odometerGap ? '⚠ ' : ''}
                            {fmtKm(entry.odometerStart)}
                          </div>
                          <div className={`font-bold ${isConflict ? 'text-danger' : ''}`}>{fmtKm(entry.odometerEnd)}</div>
                          {isConflict && <div className="text-[10px] font-sans font-semibold text-danger">do poprawy</div>}
                        </td>
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          {validateTarget && (
                            <button
                              onClick={() => handleValidateEntry(entry)}
                              disabled={isClosed || busy}
                              className="p-1.5 rounded-lg bg-ok-soft text-ok hover:bg-[#d9f1e2] disabled:opacity-30 disabled:cursor-not-allowed mr-0.5"
                              title={
                                isClosed
                                  ? 'Miesiąc jest zamknięty'
                                  : `Waliduj i popraw liczniki na ${fmtKm(validateTarget.newStart)} – ${fmtKm(validateTarget.newEnd)} (${entry.distanceKm} km)`
                              }
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setInlineAddDate(null);
                              setEditingId(null);
                              setAddAfterId((id) => (id === entry.id ? null : entry.id));
                            }}
                            disabled={isClosed}
                            className={`p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${addAfterId === entry.id ? 'text-brand bg-brand-soft' : 'text-ink-2 hover:text-brand hover:bg-brand-soft'}`}
                            title={isClosed ? 'Miesiąc jest zamknięty' : `Dodaj kolejny wyjazd ${entry.date}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setInlineAddDate(null);
                              setAddAfterId(null);
                              setEditingId(editing ? null : entry.id);
                            }}
                            disabled={isClosed}
                            className={`p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed ${editing ? 'text-brand bg-brand-soft' : 'text-ink-2 hover:text-brand hover:bg-brand-soft'}`}
                            title={isClosed ? 'Miesiąc jest zamknięty' : 'Edytuj wpis'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(entry)}
                            disabled={isClosed}
                            className="p-1.5 text-ink-3 hover:text-danger hover:bg-danger-soft rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                            title={isClosed ? 'Miesiąc jest zamknięty' : 'Usuń wpis'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      {editing && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <EntryForm mode="edit" inline monthKey={currentMonthKey} entry={entry} onDone={() => setEditingId(null)} />
                          </td>
                        </tr>
                      )}
                      {addAfterId === entry.id && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <EntryForm mode="add" inline monthKey={currentMonthKey} initialDate={entry.date} onDone={() => setAddAfterId(null)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-subtle border-t border-line flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 text-[13px] text-ink-2">
            Stan licznika <span className="font-num font-bold text-ink">{fmtKm(endOdometer)}</span> na koniec miesiąca {monthNameGen} {year}
            <span className="text-ink-3"> · Podpis podatnika ……………………</span>
          </div>
          <div className="flex items-end gap-6">
            {[
              ['Podsumowanie strony', fmtKm(totalMonthDistance), false],
              ['Z przeniesienia', fmtKm(startOdometer), false],
              ['Razem', fmtKm(endOdometer), true],
            ].map(([l, v, strong]) => (
              <div key={l as string} className="text-right">
                <div className="text-[11px] font-semibold text-ink-3">{l}</div>
                <div className={`font-num font-bold ${strong ? 'text-lg text-brand' : 'text-[15px]'}`}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Nowy wyjazd / dodawanie seryjne */}
      {bulkOpen && !isClosed ? (
        <BulkAddPanel monthKey={currentMonthKey} onClose={() => setBulkOpen(false)} />
      ) : (
        <div id="entry-form" className="card p-6">
          <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-line mb-5">
            <Plus className="w-5 h-5 text-brand" />
            <h3 className="flex-1 font-bold text-base">
              Nowy wyjazd – {monthName} {year}
            </h3>
            {isClosed ? (
              <span className="text-xs text-warn bg-warn-soft px-3 py-1 rounded-full font-semibold inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Miesiąc jest zamknięty – otwórz go, aby dodać wyjazd
              </span>
            ) : (
              <button onClick={() => setBulkOpen(true)} className="px-3.5 py-2 bg-white border border-line hover:bg-subtle rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
                <CalendarRange className="w-4 h-4 text-brand" /> Dodaj seryjnie
              </button>
            )}
          </div>
          <EntryForm mode="add" monthKey={currentMonthKey} initialDate={addDate} disabled={isClosed} onDone={() => setAddDate(undefined)} />
        </div>
      )}

      <AttachmentModal
        entry={attachmentsEntry}
        isOpen={Boolean(attachmentsEntry)}
        isLocked={isClosed}
        onClose={() => setAttachmentsEntryId(null)}
      />


    </div>
  );
};
