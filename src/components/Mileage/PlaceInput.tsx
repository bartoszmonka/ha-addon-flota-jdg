import React, { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { isSamePlace } from '../../lib/route';

/** Pole miejsca z podpowiedziami – najczęściej odwiedzane miejsca na górze listy */
export const PlaceInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  places: { place: string; count: number }[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  exclude?: string;
  invalid?: boolean;
  error?: string | null;
  closeSignal?: number;
}> = ({ label, value, onChange, places, placeholder, disabled, required, exclude, invalid, error, closeSignal }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);

  const list = useMemo(() => {
    const q = value.trim().toLowerCase();
    return places
      .filter((p) => (!exclude || !isSamePlace(exclude, p.place)) && (!q || (p.place.toLowerCase().includes(q) && p.place.toLowerCase() !== q)))
      .slice(0, 8);
  }, [places, value, exclude]);

  const isInvalid = Boolean(invalid || error);

  return (
    <div className="relative">
      <label className="block text-xs font-semibold text-ink-2 mb-1">
        {label}
        {required && ' *'}
      </label>
      <div className="relative">
        <MapPin className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${isInvalid ? 'text-danger' : 'text-ink-3'}`} />
        <input
          type="text"
          aria-required={required || undefined}
          aria-invalid={isInvalid || undefined}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          className={`w-full pl-9 pr-3 py-2.5 border rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 disabled:bg-subtle ${
            isInvalid ? 'border-danger ring-1 ring-danger focus:ring-danger' : 'border-line-strong focus:ring-brand'
          }`}
        />
      </div>
      {error && <div className="text-xs text-danger font-semibold mt-1">{error}</div>}
      {open && !disabled && list.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-line rounded-xl shadow-xl py-1 z-40 max-h-64 overflow-y-auto">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Najczęściej odwiedzane</div>
          {list.map((p) => (
            <button
              key={p.place}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(p.place);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-brand-soft"
            >
              <span className="flex-1 truncate">{p.place}</span>
              <span className="text-[11px] font-num text-ink-3">{p.count}×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
