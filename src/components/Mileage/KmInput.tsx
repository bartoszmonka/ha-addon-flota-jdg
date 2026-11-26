import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const fmtKm = (n: number) => Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Pole przebiegu / kilometrów (wyłącznie dodatnie liczby całkowite).
 * Nie zmienia po cichu błędnych znaków (np. `-5` → `5` lub `5,5` → `55`),
 * tylko zachowuje wpisany tekst i zgłasza błąd formatu przez `onInvalidChange`.
 */
export const KmInput: React.FC<{
  value: number | '';
  onChange: (val: number | '') => void;
  onInvalidChange?: (msg: string | null) => void;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}> = ({ value, onChange, onInvalidChange, invalid, placeholder, disabled, className }) => {
  const ref = useRef<HTMLInputElement>(null);
  const nextCaret = useRef<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const lastEmitted = useRef<number | ''>(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setDraft(null);
      onInvalidChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const formatted = value === '' || !Number.isFinite(value) ? '' : fmtKm(value);
  const displayed = draft !== null ? draft : formatted;

  useLayoutEffect(() => {
    if (draft === null && nextCaret.current !== null && ref.current && document.activeElement === ref.current) {
      const pos = Math.min(nextCaret.current, formatted.length);
      ref.current.setSelectionRange(pos, pos);
      nextCaret.current = null;
    }
  }, [draft, formatted]);

  const emitValid = (val: number | '') => {
    lastEmitted.current = val;
    onInvalidChange?.(null);
    onChange(val);
  };

  const emitInvalid = (raw: string, msg: string) => {
    setDraft(raw);
    lastEmitted.current = '';
    onInvalidChange?.(msg);
    onChange('');
  };

  const handleRaw = (raw: string, caretInRaw: number) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setDraft(null);
      nextCaret.current = 0;
      emitValid('');
      return;
    }
    if (raw.includes('-')) {
      emitInvalid(raw, 'Wpisz dodatnią liczbę całkowitą (bez znaku minus).');
      return;
    }
    if (raw.includes(',') || raw.includes('.')) {
      emitInvalid(raw, 'Wpisz pełne kilometry jako liczbę całkowitą (bez przecinka ani kropki).');
      return;
    }
    if (/[^\d\s\u00a0]/.test(raw)) {
      emitInvalid(raw, 'Wpisz wyłącznie cyfry (liczba całkowita).');
      return;
    }

    const digitsBefore = raw.slice(0, caretInRaw).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setDraft(null);
      nextCaret.current = 0;
      emitValid('');
      return;
    }
    const num = Number(digits);
    const nextFormatted = fmtKm(num);
    let seen = 0;
    let pos = nextFormatted.length;
    if (digitsBefore === 0) {
      pos = 0;
    } else {
      for (let i = 0; i < nextFormatted.length; i++) {
        if (/\d/.test(nextFormatted[i])) seen++;
        if (seen === digitsBefore) {
          pos = i + 1;
          break;
        }
      }
    }
    setDraft(null);
    nextCaret.current = pos;
    emitValid(num);
  };

  const hasError = Boolean(invalid || draft !== null);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      value={displayed}
      placeholder={placeholder}
      aria-invalid={hasError || undefined}
      className={`${className || ''} ${hasError ? '!border-danger !ring-1 !ring-danger focus:!ring-danger' : ''}`}
      onKeyDown={(e) => {
        if (draft === null && e.key === 'Backspace' && ref.current) {
          const { selectionStart, selectionEnd, value: cur } = ref.current;
          if (selectionStart !== null && selectionStart === selectionEnd && selectionStart > 1 && cur[selectionStart - 1] === ' ') {
            e.preventDefault();
            const updated = cur.slice(0, selectionStart - 2) + cur.slice(selectionStart);
            handleRaw(updated, selectionStart - 2);
          }
        }
      }}
      onChange={(e) => handleRaw(e.target.value, e.target.selectionStart ?? e.target.value.length)}
    />
  );
};
