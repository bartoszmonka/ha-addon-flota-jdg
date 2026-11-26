import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setSessionToken } from '../lib/docstore';

/** Zalogowany użytkownik Home Assistant (pola nazwane jak dawniej, żeby reszta aplikacji została bez zmian) */
export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
}

interface AuthContextType {
  currentUser: AppUser | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isFirebaseConnected: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // po powrocie z logowania HA sesja przychodzi we fragmencie adresu (#session=…)
    const m = window.location.hash.match(/session=([0-9a-f]+)/);
    if (m && window.opener && window.name === 'flota-login') {
      // okno logowania otwarte z ramki (HA nie pozwala logować się wewnątrz iframe) – oddaj sesję oknu, które je otworzyło
      try {
        window.opener.postMessage({ type: 'flota-session', token: m[1] }, window.location.origin);
        window.close();
        return;
      } catch {
        /* spróbuj zalogować w tym oknie */
      }
    }
    if (m) {
      setSessionToken(m[1]);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.data?.type !== 'flota-session' || !/^[0-9a-f]+$/.test(ev.data.token)) return;
      setSessionToken(ev.data.token);
      window.location.reload();
    };
    window.addEventListener('message', onMessage);
    let cancelled = false;
    const load = async () => {
      try {
        const me = await api<{ uid: string; name: string }>('/api/me');
        if (!cancelled) {
          setCurrentUser({ uid: me.uid, displayName: me.name, email: me.name, photoURL: null });
          setConnected(true);
        }
      } catch {
        if (!cancelled) setCurrentUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onUnauthorized = () => setCurrentUser(null);
    window.addEventListener('flota-unauthorized', onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener('flota-unauthorized', onUnauthorized);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const handleLogin = async () => {
    // w ramce (np. karta iframe w Home Assistant) logowanie HA działa tylko w osobnym oknie
    if (window.self !== window.top) {
      const w = window.open('auth/login', 'flota-login', 'width=520,height=720');
      if (w) return;
    }
    window.location.href = 'auth/login';
  };

  const handleLogout = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined);
    setSessionToken(null);
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ currentUser, loading, login: handleLogin, logout: handleLogout, isFirebaseConnected: connected }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
