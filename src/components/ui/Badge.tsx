import React from 'react';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-brand-soft text-brand',
  neutral: 'bg-subtle text-ink-2',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'neutral', children, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current" />
    {children}
  </span>
);

/** Ton i etykieta dla terminu (ASO, badanie, ubezpieczenie) */
export function deadlineTone(days: number | null): { tone: Tone; label: string } | null {
  if (days === null) return null;
  if (days < 0) return { tone: 'danger', label: `po terminie ${Math.abs(days)} dni` };
  if (days === 0) return { tone: 'danger', label: 'dzisiaj' };
  if (days <= 30) return { tone: 'warn', label: `za ${days} dni` };
  return { tone: 'ok', label: `za ${days} dni` };
}
