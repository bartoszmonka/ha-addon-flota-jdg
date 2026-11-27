import React, { useEffect, useRef, useState } from 'react';
import { useFleet } from '../context/FleetContext';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Plus,
  Car,
  ChevronsUpDown,
  Check,
  Menu,
  X,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Pulpit', short: 'Pulpit', icon: LayoutDashboard },
  { id: 'mileage', label: 'Ewidencja przebiegu', short: 'Ewidencja', icon: FileSpreadsheet },
  { id: 'expenses', label: 'Raporty kosztów', short: 'Koszty', icon: Receipt },
  { id: 'insurance', label: 'Ubezpieczenie', short: 'Polisa', icon: ShieldCheck },
  { id: 'settings', label: 'Ustawienia', short: 'Ustawienia', icon: SlidersHorizontal },
];

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenConfigurator: () => void;
}

const VehicleThumb: React.FC<{ src?: string; className?: string }> = ({ src, className = '' }) =>
  src ? (
    <img src={src} alt="" className={`object-cover rounded-md ${className}`} />
  ) : (
    <div className={`rounded-md bg-white/10 flex items-center justify-center ${className}`}>
      <Car className="w-4 h-4 text-side-text" />
    </div>
  );

/** Przełącznik pojazdu z listą rozwijaną */
const VehicleSwitcher: React.FC<{ onOpenConfigurator: () => void }> = ({ onOpenConfigurator }) => {
  const { vehicles, activeVehicle, setActiveVehicle } = useFleet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-side-active hover:bg-[#22305299] text-left transition-colors"
      >
        <VehicleThumb src={activeVehicle?.photoDataUrl} className="w-11 h-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white truncate">
            {activeVehicle ? [activeVehicle.brand, activeVehicle.model].filter(Boolean).join(' ') : 'Brak pojazdu'}
          </div>
          <div className="text-[11px] font-num text-side-text">{activeVehicle?.registrationNumber || 'dodaj pierwsze auto'}</div>
        </div>
        <ChevronsUpDown className="w-4 h-4 text-side-text shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-40 bg-white rounded-xl shadow-2xl border border-line py-1.5 text-ink">
          {vehicles.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setActiveVehicle(v);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-subtle text-left"
            >
              <VehicleThumb src={v.photoDataUrl} className="w-9 h-7 shrink-0 !bg-subtle" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{[v.brand, v.model].filter(Boolean).join(' ')}</div>
                <div className="text-[11px] font-num text-ink-3">{v.registrationNumber}</div>
              </div>
              {v.id === activeVehicle?.id && <Check className="w-4 h-4 text-brand" />}
            </button>
          ))}
          <div className="border-t border-line mt-1.5 pt-1.5">
            <button
              onClick={() => {
                setOpen(false);
                onOpenConfigurator();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-brand hover:bg-brand-soft"
            >
              <Plus className="w-4 h-4" /> Dodaj pojazd
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Logo: React.FC<{ dark?: boolean }> = ({ dark = true }) => (
  <div className="flex items-center gap-2.5">
    <div className="w-9 h-9 rounded-[10px] brand-gradient flex items-center justify-center shadow-sm">
      <Car className="w-5 h-5 text-white" />
    </div>
    <div className="leading-tight">
      <div className={`font-extrabold text-[17px] tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>Flota JDG</div>
      <div className={`text-[11px] font-medium ${dark ? 'text-side-text' : 'text-ink-3'}`}>Ewidencja VAT-26</div>
    </div>
  </div>
);

const SidebarBody: React.FC<SidebarProps & { onNavigate?: () => void }> = ({ currentTab, onSelectTab, onOpenConfigurator, onNavigate }) => {
  return (
    <div className="flex flex-col h-full gap-6 px-4 py-6">
      <div className="px-2">
        <Logo />
      </div>
      <VehicleSwitcher onOpenConfigurator={onOpenConfigurator} />
      <nav className="space-y-1">
        <div className="px-3 pb-1 text-[11px] font-semibold tracking-[0.1em] text-side-text">MENU</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
                onNavigate?.();
              }}
              className={`w-full flex items-center gap-3 px-3.5 h-11 rounded-[10px] text-sm transition-colors ${
                active ? 'bg-side-active text-white font-semibold' : 'text-side-text font-medium hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

/** Menu boczne – widoczne na komputerze (lg+) */
export const Sidebar: React.FC<SidebarProps> = (props) => (
  <aside className="hidden lg:block w-64 shrink-0 bg-side sticky top-0 h-screen overflow-y-auto">
    <SidebarBody {...props} />
  </aside>
);

/** Pasek górny + dolne menu – widoczne na telefonie i tablecie */
export const MobileChrome: React.FC<SidebarProps> = (props) => {
  const { currentTab, onSelectTab } = props;
  const [drawer, setDrawer] = useState(false);
  const tabs = NAV_ITEMS.slice(0, 3);
  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 bg-canvas/90 backdrop-blur border-b border-line px-4 h-14 flex items-center justify-between">
        <Logo dark={false} />
      </header>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)] flex justify-between">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = currentTab === t.id;
          return (
            <button key={t.id} onClick={() => onSelectTab(t.id)} className={`w-20 flex flex-col items-center gap-1 text-[11px] ${active ? 'text-brand font-bold' : 'text-ink-3 font-medium'}`}>
              <Icon className="w-[22px] h-[22px]" />
              {t.short}
            </button>
          );
        })}
        <button onClick={() => setDrawer(true)} className={`w-20 flex flex-col items-center gap-1 text-[11px] ${['insurance', 'settings'].includes(currentTab) ? 'text-brand font-bold' : 'text-ink-3 font-medium'}`}>
          <Menu className="w-[22px] h-[22px]" />
          Więcej
        </button>
      </nav>

      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[85%] max-w-xs bg-side">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-3 p-2 text-side-text hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <SidebarBody {...props} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
};
