import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FleetProvider, useFleet } from './context/FleetContext';
import { Sidebar, MobileChrome } from './components/Sidebar';
import { PageHeader } from './components/ui/PageHeader';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { DashboardView } from './components/Dashboard/DashboardView';
import { MileageLogView } from './components/Mileage/MileageLogView';
import { ExpensesView } from './components/Expenses/ExpensesView';
import { InsuranceView } from './components/Insurance/InsuranceView';
import { SettingsView } from './components/Settings/SettingsView';
import { VehicleConfiguratorModal } from './components/Dashboard/VehicleConfiguratorModal';
import { LoginScreen } from './components/Auth/LoginScreen';
import { Car } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();
  const { loading: fleetLoading } = useFleet();
  const loading = authLoading || (Boolean(currentUser) && fleetLoading);
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-side flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl brand-gradient flex items-center justify-center animate-pulse">
            <Car className="w-5 h-5 text-white" />
          </div>
          <span className="text-sm font-medium text-slate-300">Ładowanie Flota JDG...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen />;
  }

  const chromeProps = {
    currentTab,
    onSelectTab: (tab: string) => {
      setCurrentTab(tab);
      window.scrollTo({ top: 0 });
    },
    onOpenConfigurator: () => setIsConfiguratorOpen(true),
  };

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <Sidebar {...chromeProps} />

      <div className="flex-1 flex flex-col min-w-0">
        <MobileChrome {...chromeProps} />

        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 pt-6 lg:pt-8 pb-28 lg:pb-10">
          {currentTab === 'dashboard' && (
            <DashboardView
              onNavigateTab={(tab) => setCurrentTab(tab)}
              onOpenConfigurator={() => setIsConfiguratorOpen(true)}
            />
          )}

          {currentTab === 'mileage' && <MileageLogView />}

          {currentTab === 'expenses' && (
            <>
              <PageHeader title="Raporty kosztów" subtitle="Ładowanie, serwis, myjnia i inne koszty pojazdu" />
              <ExpensesView />
            </>
          )}

          {currentTab === 'insurance' && (
            <>
              <PageHeader title="Ubezpieczenie" subtitle="Polisa OC/AC i termin odnowienia" />
              <InsuranceView />
            </>
          )}

          {currentTab === 'settings' && (
            <>
              <PageHeader title="Ustawienia" subtitle="Dane podatnika do nagłówka ewidencji, import z Excela, konto Home Assistant" />
              <SettingsView />
            </>
          )}
        </main>
      </div>

      {/* Modal konfiguratora nowego pojazdu */}
      <VehicleConfiguratorModal
        isOpen={isConfiguratorOpen}
        onClose={() => setIsConfiguratorOpen(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <FleetProvider>
        <ConfirmProvider>
          <MainAppContent />
        </ConfirmProvider>
      </FleetProvider>
    </AuthProvider>
  );
}
