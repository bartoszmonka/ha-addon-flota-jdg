import React, { useState } from 'react';
import { formatRoute } from '../../lib/route';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { EditVehicleModal } from './EditVehicleModal';
import { Badge, deadlineTone } from '../ui/Badge';
import {
  Gauge,
  Wrench,
  CalendarCheck,
  ShieldCheck,
  Plus,
  FileSpreadsheet,
  Car,
  Camera,
  Pencil,
  Zap,
  ArrowRight,
  Receipt,
} from 'lucide-react';
import { getDaysRemaining, getPolishMonthName } from '../../lib/dateUtils';
import { computeTechInspection } from '../../lib/techInspection';
import { activeCovers, COVER_LABELS, getInsurance, nearestCover } from '../../lib/insurance';

interface DashboardViewProps {
  onNavigateTab: (tab: string) => void;
  onOpenConfigurator: () => void;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const fmt = (n: number) => n.toLocaleString('pl-PL');

const KpiTile: React.FC<{
  title: string;
  value: string;
  caption: string;
  icon: React.ElementType;
  iconCls: string;
  badge?: { tone: Parameters<typeof Badge>[0]['tone']; label: string } | null;
  onClick?: () => void;
}> = ({ title, value, caption, icon: Icon, iconCls, badge, onClick }) => (
  <button onClick={onClick} className="card p-4 sm:p-5 text-left flex flex-col gap-2.5 sm:gap-3.5 min-w-0 hover:shadow-md hover:border-line-strong transition-all">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className={`w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-[10px] flex items-center justify-center ${iconCls}`}>
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <span className="text-[11px] sm:text-xs font-semibold tracking-[0.06em] text-ink-2 uppercase leading-tight">{title}</span>
    </div>
    <div className="text-xl sm:text-[26px] leading-none font-bold text-ink whitespace-nowrap">{value}</div>
    <div className="text-xs sm:text-[13px] font-medium text-ink-3">{caption}</div>
    {badge && <Badge tone={badge.tone} className="self-start">{badge.label}</Badge>}
  </button>
);

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigateTab, onOpenConfigurator }) => {
  const { activeVehicle, haLive, entries, expenses, taxpayer, months, monthlyLedgers } = useFleet();
  const { currentUser } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  const firstName = (currentUser?.displayName || '').split(' ')[0];
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  if (!activeVehicle) {
    return (
      <div className="card p-10 text-center">
        <div className="w-14 h-14 rounded-2xl brand-gradient mx-auto mb-4 flex items-center justify-center">
          <Car className="w-7 h-7 text-white" />
        </div>
        <h3 className="font-bold text-ink text-lg mb-1">Dodaj pierwszy samochód</h3>
        <p className="text-sm text-ink-3 mb-5">Skonfiguruj auto albo zaimportuj dotychczasową ewidencję z Excela w Ustawieniach.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={onOpenConfigurator} className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Konfigurator pojazdu
          </button>
          <button onClick={() => onNavigateTab('settings')} className="px-4 py-2.5 bg-white border border-line hover:bg-subtle rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Import z Excela
          </button>
        </div>
      </div>
    );
  }

  const v = activeVehicle;
  const aso = deadlineTone(getDaysRemaining(v.asoInspectionDate));
  const techInfo = computeTechInspection(v);
  const tech = deadlineTone(getDaysRemaining(techInfo.due || undefined));
  const insurance = getInsurance(v);
  const covers = activeCovers(insurance);
  const nearest = nearestCover(insurance);
  const ins = nearest ? deadlineTone(nearest.days) : null;
  const ocMissing = !insurance.oc?.enabled && covers.length > 0;
  const validEntries = entries.filter((e) => !e.odometerConflict);
  const conflictCount = entries.length - validEntries.length;
  const recentEntries = validEntries.slice(-5).reverse();
  const lastMonth = validEntries.length ? validEntries[validEntries.length - 1].monthKey : null;
  const lastMonthKm = lastMonth ? monthlyLedgers[lastMonth]?.totalDistanceKm || 0 : 0;

  // ostatnie 12 miesięcy kalendarzowych kończące się na BIEŻĄCYM miesiącu (puste miesiące = 0 km)
  const mk = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const now = new Date();
  const chartMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return mk(d.getFullYear(), d.getMonth() + 1);
  });
  const kmOf = (m: string) => monthlyLedgers[m]?.totalDistanceKm || 0;
  const chartVals = chartMonths.map(kmOf);
  const chartMax = Math.max(1, ...chartVals);
  const firstMonth = validEntries.length ? validEntries[0].monthKey : null;
  const lastDataMonth = validEntries.length ? validEntries[validEntries.length - 1].monthKey : null;
  // średnia z miesięcy okna, w których ewidencja już była prowadzona (od pierwszego wpisu)
  const windowMonths = firstMonth ? chartMonths.filter((m) => m >= firstMonth) : [];
  const windowKm = chartVals.reduce((a, b) => a + b, 0);
  const avg = windowMonths.length ? Math.round(windowKm / windowMonths.length) : 0;

  // średnia miesięczna w poprzednich latach (miesiące od pierwszego do ostatniego wpisu w ewidencji)
  const yearStats =
    firstMonth && lastDataMonth
      ? Array.from(new Set(validEntries.map((e) => Number(e.monthKey.slice(0, 4)))))
          .filter((y) => y < now.getFullYear())
          .sort((a, b) => a - b)
          .map((y) => {
            const ms = Array.from({ length: 12 }, (_, i) => mk(y, i + 1)).filter((m) => m >= firstMonth && m <= lastDataMonth);
            const total = ms.reduce((a, m) => a + kmOf(m), 0);
            return { year: y, months: ms.length, total, avg: ms.length ? Math.round(total / ms.length) : 0 };
          })
      : [];

  const currentMonth = months[months.length - 1];
  const currentLedger = monthlyLedgers[currentMonth];
  const totalExpenses = expenses.reduce((s, e) => s + Math.round(e.grossAmount * 100), 0) / 100;

  return (
    <div className="space-y-6">
      {/* Powitanie */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight">Dzień dobry{firstName ? `, ${firstName}` : ''}</h1>
          <p className="text-sm font-medium text-ink-3 mt-1 first-letter:uppercase">
            {today}
            {taxpayer.companyName ? ` · ${taxpayer.companyName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {currentLedger && (
            <Badge tone={currentLedger.isClosed ? 'ok' : 'info'}>
              <span className="capitalize">{getPolishMonthName(currentMonth)}</span> {currentMonth.slice(0, 4)} · {currentLedger.isClosed ? 'zamknięty' : 'otwarty'}
            </Badge>
          )}
          <button
            onClick={() => onNavigateTab('mileage')}
            className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Dodaj wyjazd
          </button>
        </div>
      </div>

      {/* Karta pojazdu */}
      <div className="hero-gradient text-white rounded-[20px] overflow-hidden flex flex-col md:flex-row shadow-sm">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="group relative md:w-[420px] aspect-[16/9] md:aspect-auto md:min-h-[268px] shrink-0 bg-white/5 flex items-center justify-center overflow-hidden"
          title="Edytuj pojazd"
        >
          {v.photoDataUrl ? (
            <img src={v.photoDataUrl} alt={`${v.brand} ${v.model}`} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="text-center text-side-text">
              <Car className="w-14 h-14 mx-auto" />
              <span className="text-xs">Dodaj zdjęcie</span>
            </div>
          )}
          <span className="absolute left-3.5 bottom-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-xs font-semibold">
            <Camera className="w-3.5 h-3.5" /> {v.photoDataUrl ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
          </span>
        </button>

        <div className="flex-1 p-6 md:p-8 flex flex-col gap-3.5">
          <div className="text-xs font-semibold text-side-text tracking-wide">SAMOCHÓD FIRMOWY · 100% VAT</div>
          <h2 className="text-[28px] md:text-[34px] leading-tight font-extrabold tracking-tight">
            {[v.brand, v.model].filter(Boolean).join(' ') || 'Samochód firmowy'}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-md bg-white text-ink">
              <span className="w-4 h-6 rounded-[3px] bg-[#003399] text-[7px] font-bold text-white flex items-end justify-center pb-0.5">PL</span>
              <span className="font-num font-bold text-[15px] tracking-wide">{v.registrationNumber}</span>
            </span>
            {v.fuelType && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 text-[13px] font-semibold">
                {v.fuelType === 'Elektryczny' && <Zap className="w-3.5 h-3.5 text-accent" />}
                {v.fuelType}
              </span>
            )}
            {v.productionYear && <span className="px-2.5 py-1.5 rounded-lg bg-white/10 text-[13px] font-semibold">{v.productionYear}</span>}
            {v.color && <span className="px-2.5 py-1.5 rounded-lg bg-white/10 text-[13px] font-semibold capitalize">{v.color}</span>}
          </div>
          <div className="text-xs font-num text-side-text">
            {[v.vin && `VIN ${v.vin}`, v.registerStartDate && `start ewidencji ${v.registerStartDate}`, `${fmt(v.initialOdometer)} km`].filter(Boolean).join(' · ')}
          </div>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2.5">
            <button onClick={() => setEditOpen(true)} className="px-4 py-2.5 rounded-[10px] bg-side-active hover:bg-white/15 text-sm font-semibold inline-flex items-center gap-2">
              <Pencil className="w-4 h-4" /> Edytuj pojazd
            </button>
            <button onClick={onOpenConfigurator} className="px-4 py-2.5 rounded-[10px] bg-side-active hover:bg-white/15 text-sm font-semibold inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Nowy samochód
            </button>
            <button onClick={() => onNavigateTab('mileage')} className="px-4 py-2.5 rounded-[10px] bg-brand hover:bg-brand-hover text-sm font-semibold inline-flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Otwórz ewidencję VAT
            </button>
          </div>
        </div>
      </div>

      <EditVehicleModal vehicle={v} isOpen={editOpen} onClose={() => setEditOpen(false)} />

      {/* Kafelki */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          title="Aktualny przebieg"
          value={`${fmt(v.currentOdometer)} km`}
          caption={[lastMonth ? `+${fmt(lastMonthKm)} km za ${getPolishMonthName(lastMonth)} ${lastMonth.slice(0, 4)}` : 'brak wpisów', haLive?.odometerKm != null ? 'licznik z Home Assistant' : null].filter(Boolean).join(' · ')}
          icon={Gauge}
          iconCls="bg-brand-soft text-brand"
          badge={conflictCount > 0 ? { tone: 'danger', label: `${conflictCount} do poprawy` } : undefined}
          onClick={() => onNavigateTab('mileage')}
        />
        <KpiTile
          title="Przegląd ASO"
          value={v.asoInspectionDate || '—'}
          caption={v.asoInspectionKm ? `lub przy ${fmt(v.asoInspectionKm)} km` : 'ustaw w edycji pojazdu'}
          icon={Wrench}
          iconCls="bg-warn-soft text-warn"
          badge={aso}
          onClick={() => setEditOpen(true)}
        />
        <KpiTile
          title="Badanie techniczne"
          value={techInfo.due || '—'}
          caption={
            techInfo.source === 'none'
              ? 'podaj datę 1. rejestracji'
              : techInfo.source === 'estimated'
                ? 'szacunek z roku produkcji'
                : techInfo.stage === 'first'
                  ? '1. badanie (3 lata od rejestracji)'
                  : techInfo.stage === 'second'
                    ? '2. badanie (5 lat od rejestracji)'
                    : techInfo.source === 'manual'
                      ? 'termin z dowodu rejestracyjnego'
                      : 'badanie coroczne'
          }
          icon={CalendarCheck}
          iconCls="bg-ok-soft text-ok"
          badge={tech}
          onClick={() => setEditOpen(true)}
        />
        <KpiTile
          title={nearest ? `Ubezpieczenie ${COVER_LABELS[nearest.kind]}` : 'Ubezpieczenie'}
          value={nearest?.cover.to || '—'}
          caption={covers.length ? covers.map((c) => `${COVER_LABELS[c.kind]} do ${c.cover.to?.slice(0, 5) || '?'}`).join(' · ') : 'dodaj polisę OC / AC / NNW'}
          icon={ShieldCheck}
          iconCls="bg-ok-soft text-accent"
          badge={ocMissing ? { tone: 'danger', label: 'brak OC' } : ins ? { tone: ins.tone, label: ins.tone === 'ok' ? 'aktywne' : ins.label } : null}
          onClick={() => onNavigateTab('insurance')}
        />
      </div>

      {/* Wykres + ostatnie wyjazdy */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4">
        <div className="card p-4 sm:p-6 flex flex-col gap-5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[160px]">
              <h3 className="text-base font-bold">Przebieg w ewidencji</h3>
              <p className="text-[13px] font-medium text-ink-3">km miesięcznie · ostatnie 12 miesięcy</p>
            </div>
            {windowKm > 0 ? (
              <Badge tone="neutral">Śr. {fmt(avg)} km / mies.</Badge>
            ) : (
              <Badge tone="neutral">brak przebiegu w tym okresie</Badge>
            )}
          </div>
          <div className="flex items-end gap-1 sm:gap-3.5 h-[190px]">
            {chartMonths.map((m, i) => {
              const val = chartVals[i];
              const last = i === chartMonths.length - 1;
              return (
                <button
                  key={m}
                  onClick={() => onNavigateTab('mileage')}
                  className="group flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-2"
                  title={`${getPolishMonthName(m)} ${m.slice(0, 4)}: ${val ? `${fmt(val)} km` : 'brak wpisów'}`}
                >
                  <span className="text-[10px] font-num text-ink-3 opacity-0 group-hover:opacity-100">{fmt(val)}</span>
                  <div
                    className={`w-full rounded-t-md transition-colors ${last ? 'bg-brand' : 'bg-brand-soft group-hover:bg-[#D3DFFF]'}`}
                    style={{ height: `${Math.max(2, Math.round((val / chartMax) * 150))}px` }}
                  />
                  <span className={`text-[9px] sm:text-[11px] font-semibold ${last ? 'text-ink' : 'text-ink-3'}`}>{ROMAN[Number(m.slice(5)) - 1]}</span>
                </button>
              );
            })}
          </div>
          {yearStats.length > 0 && (
            <div className="border-t border-line pt-4">
              <div className="text-xs font-semibold text-ink-2 mb-2">Średni przebieg miesięczny w poprzednich latach</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {yearStats.map((y) => (
                  <div key={y.year} className="rounded-xl bg-subtle px-3 py-2" title={`${y.year}: razem ${fmt(y.total)} km w ${y.months} mies. ewidencji`}>
                    <div className="text-[11px] font-semibold text-ink-3">{y.year}</div>
                    <div className="font-num font-bold text-ink">{fmt(y.avg)} km<span className="text-xs font-normal text-ink-3"> / mies.</span></div>
                    <div className="text-[11px] text-ink-3">
                      {fmt(y.total)} km · {y.months} mies.
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-6 flex flex-col min-w-0">
          <div className="flex items-center mb-2">
            <h3 className="flex-1 text-base font-bold">Ostatnie wyjazdy</h3>
            <button onClick={() => onNavigateTab('mileage')} className="text-[13px] font-semibold text-brand inline-flex items-center gap-1">
              Zobacz wszystkie <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {conflictCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigateTab('mileage')}
              className="mb-2 text-left text-xs font-semibold text-danger bg-danger-soft rounded-xl px-3 py-2 hover:brightness-95 transition"
            >
              {conflictCount === 1
                ? '1 wpis w ewidencji ma konflikt licznika i jest wyłączony z sumy km – kliknij, aby poprawić.'
                : `${conflictCount} wpisy w ewidencji mają konflikt licznika i są wyłączone z sumy km – kliknij, aby poprawić.`}
            </button>
          )}
          {recentEntries.length === 0 ? (
            <p className="text-sm text-ink-3 py-6 text-center">Brak wyjazdów w ewidencji.</p>
          ) : (
            recentEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5 border-t border-line first-of-type:border-t-0">
                <div className="px-2.5 h-10 rounded-[10px] bg-subtle flex items-center justify-center font-num text-xs font-bold shrink-0 whitespace-nowrap">{e.date}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{e.purposeDescription}</div>
                  <div className="text-xs font-medium text-ink-3 truncate">{formatRoute(e.routeDescription)}</div>
                </div>
                <div className="text-[13px] font-num font-bold whitespace-nowrap">{fmt(e.distanceKm)} km</div>
              </div>
            ))
          )}
          {expenses.length > 0 && (
            <button onClick={() => onNavigateTab('expenses')} className="mt-auto pt-4 flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
              <Receipt className="w-4 h-4" />
              Koszty pojazdu: <span className="font-num font-bold">{totalExpenses.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
