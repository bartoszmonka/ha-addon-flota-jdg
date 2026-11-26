import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const Dropdown: React.FC<{
  label: string;
  icon?: React.ReactNode;
  className?: string;
  items: { label: string; onClick: () => void; disabled?: boolean }[];
}> = ({ label, icon, className = '', items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={className}>
        {icon}
        {label}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 min-w-[240px] bg-white border border-line rounded-xl shadow-xl py-1.5">
          {items.map((it) => (
            <button
              key={it.label}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="w-full text-left px-3.5 py-2 text-sm font-medium text-ink hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
