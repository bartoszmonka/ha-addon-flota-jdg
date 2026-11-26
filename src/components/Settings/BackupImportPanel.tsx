import React, { useState } from 'react';
import { DatabaseBackup, Loader2, CheckCircle, AlertTriangle, Upload, Download } from 'lucide-react';
import { api, db, getDoc, getDocs, collection, doc } from '../../lib/docstore';
import { useAuth } from '../../context/AuthContext';

interface BackupDoc {
  path: string;
  data: Record<string, unknown>;
}

/** Import kopii JSON z poprzedniej wersji (AI Studio / Firebase) oraz eksport kopii z tej wersji */
export const BackupImportPanel: React.FC = () => {
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const parsed = JSON.parse(await f.text());
      const docs: BackupDoc[] = Array.isArray(parsed) ? parsed : parsed.docs;
      if (!Array.isArray(docs) || !docs.every((d) => typeof d?.path === 'string' && d.data && typeof d.data === 'object')) {
        throw new Error('To nie wygląda na kopię Flota JDG (oczekiwana lista dokumentów {path, data}).');
      }
      // wysyłamy partiami po ok. 6 MB
      let batch: BackupDoc[] = [];
      let size = 0;
      let written = 0;
      const flush = async () => {
        if (!batch.length) return;
        const r = await api<{ written: number }>('/api/import', { method: 'POST', body: JSON.stringify({ docs: batch }) });
        written += r.written;
        batch = [];
        size = 0;
      };
      for (const d of docs) {
        const len = JSON.stringify(d).length;
        if (size + len > 6_000_000) await flush();
        batch.push(d);
        size += len;
      }
      await flush();
      setMsg({ ok: true, text: `Zaimportowano ${written} dokumentów (wpisy, miesiące, koszty, załączniki). Odśwież stronę, jeśli czegoś brakuje.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  /** Eksport wszystkiego z tej wersji do pliku JSON (kopia zapasowa) */
  const exportAll = async () => {
    if (!currentUser) return;
    setBusy(true);
    setMsg(null);
    try {
      const out: BackupDoc[] = [];
      const base = `users/${currentUser.uid}`;
      const profile = await getDoc(doc(db, base));
      if (profile.exists()) out.push({ path: base, data: profile.data() });
      const vehicles = await getDocs(collection(db, base, 'vehicles'));
      for (const v of vehicles.docs) {
        out.push({ path: v.ref.path, data: v.data() });
        for (const sub of ['entries', 'months', 'expenses', 'saved_purposes', 'saved_routes', 'files']) {
          const snap = await getDocs(collection(db, v.ref.path, sub));
          for (const d of snap.docs) {
            out.push({ path: d.ref.path, data: d.data() });
            if (sub === 'files') {
              const chunks = await getDocs(collection(db, d.ref.path, 'chunks'));
              chunks.docs.forEach((c) => out.push({ path: c.ref.path, data: c.data() }));
            }
          }
        }
      }
      const blob = new Blob([JSON.stringify({ app: 'flota-jdg', exportedAt: new Date().toISOString(), docs: out })], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `flota-jdg-kopia-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ ok: true, text: `Zapisano kopię (${out.length} dokumentów).` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
          <DatabaseBackup className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-base text-slate-900">Kopia zapasowa i import z AI Studio</h2>
          <p className="text-xs text-slate-500">Wczytaj plik JSON wyeksportowany ze starej wersji albo pobierz kopię tej wersji.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5 items-center">
        <label className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Importuj kopię (JSON)
          <input type="file" accept="application/json,.json" className="hidden" onChange={handleFile} disabled={busy} />
        </label>
        <button onClick={exportAll} disabled={busy} className="px-4 py-2.5 bg-white border border-line hover:bg-subtle rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
          <Download className="w-4 h-4" /> Pobierz kopię (JSON)
        </button>
      </div>
      {msg && (
        <div className={`mt-4 p-3 rounded-lg text-xs flex gap-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {msg.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-400">Import dopisuje i nadpisuje dokumenty o tych samych identyfikatorach; istniejące inne dane zostają.</p>
    </div>
  );
};
