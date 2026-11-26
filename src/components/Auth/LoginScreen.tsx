import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Car, Home, AlertCircle, CheckCircle2 } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleHaLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await login();
    } catch (err: any) {
      console.error('Błąd logowania:', err);
      setError('Nie udało się rozpocząć logowania przez Home Assistant.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white flex flex-col justify-between p-6">
      {/* Pasek górny */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-lg shadow-blue-500/20">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight">Flota JDG</h1>
            <p className="text-xs text-slate-400">System Ewidencji VAT-26 i Pojazdów</p>
          </div>
        </div>
      </header>

      {/* Główna sekcja logowania */}
      <main className="max-w-md w-full mx-auto my-12 bg-white text-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-100">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Car className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Zaloguj się do Flota JDG</h2>
          <p className="text-xs text-slate-500 mt-1">
            Logowanie kontem Home Assistant
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="leading-snug">{error}</div>
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleHaLogin}
            disabled={loading}
            className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-slate-800 border-2 border-slate-200 hover:border-slate-300 rounded-xl text-sm font-semibold flex items-center justify-center gap-3 transition-all shadow-xs disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            <Home className="w-5 h-5 shrink-0 text-sky-600" />
            <span>{loading ? 'Łączenie z Home Assistant...' : 'Zaloguj się przez Home Assistant'}</span>
          </button>
        </div>

        {/* Korzyści i specyfikacja */}
        <div className="mt-8 pt-6 border-t border-slate-100 space-y-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Pełna zgodność z deklaracją <strong>VAT-26</strong> (100% odliczenia)</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Załączanie faktur, biletów i zleceń do celów wyjazdu</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Wierny eksport do urzędowego <strong>PDF</strong> oraz <strong>Excel (.xlsx)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Licznik badań ASO, SKP oraz polis ubezpieczeniowych</span>
          </div>
        </div>
      </main>

      {/* Stopka */}
      <footer className="max-w-6xl w-full mx-auto text-center text-xs text-slate-500 py-3">
        Flota JDG &copy; {new Date().getFullYear()} · Bezpieczne zarządzanie kilometrówką i flotą jednoosobowej działalności
      </footer>
    </div>
  );
};
