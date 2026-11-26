/**
 * Okno potwierdzenia w aplikacji (zamiast window.confirm).
 *
 * window.confirm w podglądzie AI Studio (iframe) bywa zablokowane i od razu zwraca „Anuluj” –
 * przez to np. „Zapisz zmiany” w trybie przesuwania licznika nic nie robiło.
 * Użycie:  const confirm = useConfirm();  const r = await confirm({ title, message });  if (!r.ok) return;
 */

import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  /** lista ostrzeżeń (np. podejrzane km) */
  warnings?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'warn' | 'danger';
  /** wymagaj wpisania powodu (zapisywany przy wpisie) */
  requireReason?: boolean;
  reasonPlaceholder?: string;
}

export interface ConfirmResult {
  ok: boolean;
  reason?: string;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<ConfirmResult>;
const Ctx = createContext<ConfirmFn | null>(null);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState('');

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setReason('');
        setState({ ...o, resolve });
      }),
    []
  );

  const close = (r: ConfirmResult) => {
    state?.resolve(r);
    setState(null);
  };

  const tone = state?.tone || 'default';
  const reasonOk = !state?.requireReason || reason.trim().length >= 3;
  const Icon = tone === 'danger' ? Trash2 : tone === 'warn' ? AlertTriangle : HelpCircle;

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4" onKeyDown={(e) => e.key === 'Escape' && close({ ok: false })}>
          <div role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 flex gap-4">
              <div
                className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${
                  tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <h2 className="text-base font-bold text-ink">{state.title}</h2>
                {state.message && <div className="text-sm text-ink-2 whitespace-pre-line">{state.message}</div>}
                {state.warnings && state.warnings.length > 0 && (
                  <ul className="text-sm text-warn bg-warn-soft rounded-xl p-3 space-y-1">
                    {state.warnings.map((w) => (
                      <li key={w}>• {w}</li>
                    ))}
                  </ul>
                )}
                {state.requireReason && (
                  <div>
                    <label className="block text-xs font-semibold text-ink-2 mb-1">Powód (zapisze się przy wpisie) *</label>
                    <textarea
                      autoFocus
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={state.reasonPlaceholder || 'np. objazd z powodu remontu A4, dodatkowy klient po drodze'}
                      className="w-full px-3 py-2 border border-line-strong rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-subtle flex justify-end gap-2">
              <button onClick={() => close({ ok: false })} className="px-4 py-2.5 rounded-[10px] text-sm font-semibold text-ink-2 hover:bg-line">
                {state.cancelLabel || 'Anuluj'}
              </button>
              <button
                autoFocus={!state.requireReason}
                disabled={!reasonOk}
                onClick={() => close({ ok: true, reason: reason.trim() || undefined })}
                className={`px-4 py-2.5 rounded-[10px] text-sm font-semibold text-white disabled:opacity-40 ${
                  tone === 'danger' ? 'bg-danger hover:brightness-95' : tone === 'warn' ? 'bg-warn hover:brightness-95' : 'bg-brand hover:bg-brand-hover'
                }`}
              >
                {state.confirmLabel || 'Potwierdź'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
};

export function useConfirm(): ConfirmFn {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConfirm must be used within ConfirmProvider');
  return c;
}
