import React, { useEffect, useState } from 'react';
import { redactSensitive, sniffMime, UNSUPPORTED_FILE_MSG } from '../../lib/fileSafety';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { Shield, ShieldCheck, Upload, Loader2, FileText, Save, Plus, X, Check, Download, Sparkles, AlertTriangle } from 'lucide-react';
import { CoverKind, InsuranceCover, InsuranceSet } from '../../types/fleet';
import { ddmmyyyyToIso, getDaysRemaining, isoToDDMMYYYY } from '../../lib/dateUtils';
import { COVER_DESCRIPTIONS, COVER_LABELS, getInsurance, nearestCover } from '../../lib/insurance';
import { ParsedPolicy, parsePolicyText, sameId } from '../../lib/policyParser';
import { extractImageText, extractPdfText } from '../../lib/pdfText';
import { loadAttachmentBlob, uploadAttachment } from '../../lib/attachmentStore';
import { Badge, deadlineTone } from '../ui/Badge';

const KINDS: CoverKind[] = ['oc', 'ac', 'nnw'];
const inputCls = 'w-full px-3 py-2.5 border border-line-strong rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-subtle disabled:text-ink-3';
const rInput = 'w-full min-w-0 px-2.5 py-1.5 border border-line-strong rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand';

const RField: React.FC<{ label: string; small?: boolean; children: React.ReactNode }> = ({ label, small, children }) => (
  <div className={small ? '' : 'rounded-xl bg-subtle p-3'}>
    <div className={`${small ? 'text-[11px]' : 'text-[11px] uppercase'} font-semibold text-ink-3 mb-1`}>{label}</div>
    {children}
  </div>
);

/** kwota w zł – przyjmuje „1 649,00”, „1649.5” */
const MoneyInput: React.FC<{ value?: number; onChange: (v?: number) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => {
  const [txt, setTxt] = React.useState(value === undefined ? '' : String(value).replace('.', ','));
  React.useEffect(() => {
    const cur = txt.trim() ? Number(txt.replace(/\s/g, '').replace(',', '.')) : undefined;
    // nadpisujemy tekst tylko gdy wartość zmieniła się z zewnątrz (nie podczas pisania)
    if (cur !== undefined && Number.isFinite(cur) ? cur !== value : value !== undefined) setTxt(value === undefined ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      inputMode="decimal"
      className={rInput}
      value={txt}
      placeholder={placeholder}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = Number(e.target.value.replace(/\s/g, '').replace(',', '.'));
        onChange(e.target.value.trim() && Number.isFinite(n) ? n : undefined);
      }}
    />
  );
};

/** lista pozycji do poprawienia: edycja, usuwanie, dodawanie */
const EditableList: React.FC<{ title: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string; multiline?: boolean }> = ({
  title,
  items,
  onChange,
  placeholder,
  multiline,
}) => (
  <div>
    <div className="text-xs font-semibold text-ink-2 mb-1.5">{title}</div>
    <div className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 items-start">
          {multiline ? (
            <textarea rows={2} className={`${rInput} text-xs leading-snug resize-y [field-sizing:content] min-h-[2.5rem]`} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          ) : (
            <input className={rInput} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          )}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-1.5 text-ink-3 hover:text-danger" title="Usuń">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      {items.length === 0 && <div className="text-xs text-ink-3">brak</div>}
    </div>
    <button onClick={() => onChange([...items, ''])} className="mt-2 text-xs font-semibold text-brand inline-flex items-center gap-1" title={placeholder}>
      <Plus className="w-3.5 h-3.5" /> Dodaj
    </button>
  </div>
);

const money = (n?: number) => (n === undefined ? '' : n.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' zł');

const DateInput: React.FC<{ value?: string; onChange: (v?: string) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <input type="date" disabled={disabled} value={ddmmyyyyToIso(value || '')} onChange={(e) => onChange(e.target.value ? isoToDDMMYYYY(e.target.value) : undefined)} className={`${inputCls} font-num`} />
);

export const InsuranceView: React.FC = () => {
  const { activeVehicle, updateVehicle } = useFleet();
  const { currentUser } = useAuth();
  const [ins, setIns] = useState<InsuranceSet>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // analiza PDF
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [parsed, setParsed] = useState<ParsedPolicy | null>(null);
  const [parsedText, setParsedText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showText, setShowText] = useState(false);
  const [newExtra, setNewExtra] = useState('');

  useEffect(() => {
    if (activeVehicle && !dirty) setIns(getInsurance(activeVehicle));
  }, [activeVehicle?.id, JSON.stringify(activeVehicle?.insurance || null)]);

  if (!activeVehicle) {
    return (
      <div className="card p-8 text-center">
        <Shield className="w-12 h-12 text-ink-3 mx-auto mb-3" />
        <p className="text-ink-2 font-medium">Wybierz pojazd, aby zarządzać ubezpieczeniem.</p>
      </div>
    );
  }

  const setCover = (k: CoverKind, patch: Partial<InsuranceCover>) => {
    setIns((s) => ({ ...s, [k]: { enabled: false, ...(s[k] || {}), ...patch } }));
    setDirty(true);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setParsed(null);
    setPct(0);
    setAnalyzing('Wczytuję plik…');
    try {
      const real = await sniffMime(f);
      if (!real) throw new Error(UNSUPPORTED_FILE_MSG);
      f = new File([f], f.name, { type: real });
      const progress = (m: string, p?: number) => {
        setAnalyzing(m);
        if (p !== undefined) setPct(p);
      };
      const res = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') ? await extractPdfText(f, progress) : await extractImageText(f, progress);
      const p = parsePolicyText(res.text);
      if (res.ocrPages) p.warnings.unshift(`Tekst odczytany przez OCR (${res.ocrPages} str.) – sprawdź szczególnie daty i kwoty.`);
      if (p.vin && activeVehicle.vin && !sameId(p.vin, activeVehicle.vin)) p.warnings.unshift(`VIN na polisie (${p.vin}) różni się od VIN pojazdu (${activeVehicle.vin}).`);
      // OCR myli O z 0 – jeśli po tej poprawce numer się zgadza, bierzemy numer z pojazdu
      if (p.plate && sameId(p.plate, activeVehicle.registrationNumber)) p.plate = activeVehicle.registrationNumber.replace(/\s/g, '');
      if (p.vin && sameId(p.vin, activeVehicle.vin)) p.vin = activeVehicle.vin;
      if (p.plate && !sameId(p.plate, activeVehicle.registrationNumber)) p.warnings.unshift(`Numer rejestracyjny na polisie (${p.plate}) różni się od pojazdu (${activeVehicle.registrationNumber}).`);
      setParsed(p);
      setParsedText(res.text);
      setPendingFile(f);
    } catch (err) {
      console.error(err);
      setError('Nie udało się odczytać pliku. ' + (err instanceof Error ? err.message : ''));
    } finally {
      setAnalyzing(null);
    }
  };

  const updParsed = (patch: Partial<ParsedPolicy>) => setParsed((p) => (p ? { ...p, ...patch } : p));
  const updCover = (k: CoverKind, patch: Partial<ParsedPolicy['covers'][CoverKind]>) =>
    setParsed((p) => (p ? { ...p, covers: { ...p.covers, [k]: { ...p.covers[k], ...patch } } } : p));
  /** zmiana okresu polisy przenosi się na ochrony, które miały ten sam okres */
  const setPolicyPeriod = (field: 'from' | 'to', iso: string) =>
    setParsed((p) => {
      if (!p) return p;
      const v = isoToDDMMYYYY(iso) || undefined;
      const covers = { ...p.covers };
      KINDS.forEach((k) => {
        if (covers[k].found && covers[k][field] === p[field]) covers[k] = { ...covers[k], [field]: v };
      });
      return { ...p, [field]: v, covers };
    });

  const applyParsed = () => {
    if (!parsed) return;
    // uwagi do każdej ochrony: wariant, rodzaj sumy, sumy gwarancyjne OC, warunki AC / NNW
    const coverNotes = (k: CoverKind) => {
      const c = parsed.covers[k];
      const parts: string[] = [];
      if (c.variant) parts.push(`Wariant: ${c.variant.toLowerCase()}`);
      if (c.sumNote) parts.push(`Suma: ${c.sumNote}`);
      if (k === 'oc') {
        const sums = parsed.info.find((i) => i.label === 'Sumy gwarancyjne OC');
        if (sums) parts.push(`Sumy gwarancyjne: ${sums.value}`);
      }
      const tag = k === 'ac' ? /\bAC\b|autocasco|kradzie|warto[śs][ćc] rynkow|udzia[łl] w[łl]asn|amortyzac/i : k === 'nnw' ? /\bNNW\b/ : null;
      if (tag) parts.push(...parsed.conditions.filter((x) => x.trim() && tag.test(x)));
      return parts.join('; ').slice(0, 900);
    };
    const next: InsuranceSet = { ...ins };
    KINDS.forEach((k) => {
      const c = parsed.covers[k];
      next[k] = c.found
        ? {
            ...(ins[k] || {}),
            enabled: true,
            provider: parsed.insurer || ins[k]?.provider,
            policyNumber: parsed.policyNumber || ins[k]?.policyNumber,
            from: c.from || parsed.from,
            to: c.to || parsed.to,
            premium: c.premium ?? ins[k]?.premium,
            sumInsured: c.sumInsured ?? ins[k]?.sumInsured,
            notes: ins[k]?.notes || coverNotes(k) || undefined,
          }
        : { ...(ins[k] || {}), enabled: false };
    });
    next.extras = Array.from(new Set([...(ins.extras || []), ...parsed.extras.map((x) => x.trim()).filter(Boolean)]));
    const infoLines = parsed.info.filter((i) => i.value.trim()).map((i) => (i.label.trim() ? `${i.label.trim()}: ${i.value.trim()}` : i.value.trim()));
    next.extras = Array.from(new Set([...(next.extras || []), ...infoLines.filter((l) => !/^sumy gwarancyjne oc/i.test(l))]));
    next.policyTextPreview = redactSensitive(parsedText).slice(0, 20000);
    const vd = {
      brand: parsed.brand,
      model: parsed.model,
      registrationNumber: parsed.plate,
      vin: parsed.vin,
      productionYear: parsed.productionYear,
      fuelType: parsed.fuelType,
      firstRegistrationDate: parsed.firstRegistrationDate,
    };
    if (Object.values(vd).some(Boolean)) {
      next.vehicleData = Object.fromEntries(Object.entries(vd).filter(([, v]) => v !== undefined));
    }
    setIns(next);
    setDirty(true);
    setParsed(null);
    setMsg('Dane z polisy wpisane do formularza – sprawdź je i kliknij „Zapisz ubezpieczenie”.');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const toSave: InsuranceSet = { ...ins, updatedAt: new Date().toISOString() };
      if (pendingFile && currentUser) {
        const att = await uploadAttachment(currentUser.uid, activeVehicle.id, `policy_${activeVehicle.id}`, {
          id: `att_policy_${Date.now().toString(36)}`,
          name: pendingFile.name,
          size: pendingFile.size,
          type: pendingFile.type || 'application/pdf',
          category: 'inny',
          description: 'Polisa ubezpieczeniowa',
          createdAt: new Date().toISOString(),
        }, pendingFile);
        toSave.policyFile = att;
      }
      const near = nearestCover(toSave);
      await updateVehicle(activeVehicle.id, {
        insurance: toSave,
        // pola zgodności wstecz (pulpit starszej wersji, eksporty)
        insuranceDate: toSave.oc?.enabled ? toSave.oc.to : near?.cover.to,
        insuranceProvider: toSave.oc?.provider || near?.cover.provider,
        insurancePolicyNumber: toSave.oc?.policyNumber || near?.cover.policyNumber,
        insuranceType: KINDS.filter((k) => toSave[k]?.enabled).map((k) => COVER_LABELS[k]).concat(toSave.extras || []).join(' + '),
      });
      setPendingFile(null);
      setDirty(false);
      setMsg('Zapisano.');
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać.');
    } finally {
      setSaving(false);
    }
  };

  const downloadPolicy = async () => {
    if (!ins.policyFile || !currentUser) return;
    const blob = await loadAttachmentBlob(currentUser.uid, activeVehicle.id, ins.policyFile);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (blob.type === 'application/pdf' || blob.type.startsWith('image/')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = ins.policyFile.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const copyFromOc = (k: CoverKind) => {
    const oc = ins.oc;
    if (!oc) return;
    setCover(k, { provider: oc.provider, policyNumber: oc.policyNumber, from: oc.from, to: oc.to });
  };

  return (
    <div className="space-y-5">
      {/* Wczytanie polisy */}
      <div className="card p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-base">Wczytaj polisę z PDF</h2>
            <p className="text-sm text-ink-3">
              PDF z tekstem albo skan / zdjęcie (OCR). Odczytamy ubezpieczyciela, numer, okres, OC / AC / NNW, składki, sumy i dodatkowe warunki – przed zapisem
              wszystko sprawdzisz.
            </p>
          </div>
          <label className={`px-4 py-2.5 rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer ${analyzing ? 'bg-subtle text-ink-3' : 'bg-brand hover:bg-brand-hover text-white'}`}>
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Wybierz plik
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFile} disabled={!!analyzing} />
          </label>
        </div>
        {analyzing && (
          <div className="mt-4">
            <div className="text-xs text-ink-2 mb-1">{analyzing}</div>
            <div className="h-1.5 bg-subtle rounded-full overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(5, pct)}%` }} />
            </div>
          </div>
        )}
        {ins.policyFile && !parsed && (
          <button onClick={downloadPolicy} className="mt-4 inline-flex items-center gap-2 text-sm text-brand font-semibold">
            <FileText className="w-4 h-4" /> Zapisana polisa: {ins.policyFile.name} <Download className="w-3.5 h-3.5" />
          </button>
        )}

        {parsed && (
          <div className="mt-5 space-y-4 border-t border-line pt-5">
            <p className="text-xs text-ink-3">Wszystkie pola możesz poprawić – do formularza trafi to, co tu widzisz.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <RField label="Ubezpieczyciel">
                <input className={rInput} value={parsed.insurer || ''} onChange={(e) => updParsed({ insurer: e.target.value || undefined })} placeholder="nie znaleziono" />
              </RField>
              <RField label="Numer polisy">
                <input className={rInput} value={parsed.policyNumber || ''} onChange={(e) => updParsed({ policyNumber: e.target.value || undefined })} placeholder="nie znaleziono" />
              </RField>
              <RField label="Okres polisy">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <input type="date" className={rInput} value={ddmmyyyyToIso(parsed.from || '')} onChange={(e) => setPolicyPeriod('from', e.target.value)} />
                  <input type="date" className={rInput} value={ddmmyyyyToIso(parsed.to || '')} onChange={(e) => setPolicyPeriod('to', e.target.value)} />
                </div>
              </RField>
              <RField label="Składka łączna [zł]">
                <MoneyInput value={parsed.premiumTotal} onChange={(v) => updParsed({ premiumTotal: v })} />
              </RField>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-stretch">
              {KINDS.map((k) => {
                const c = parsed.covers[k];
                return (
                  <div key={k} className={`rounded-xl border p-3 text-sm space-y-2 flex flex-col ${c.found ? 'border-[#BFE6CC] bg-ok-soft' : 'border-line bg-white'}`}>
                    <label className="font-bold flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-brand" checked={c.found} onChange={(e) => updCover(k, { found: e.target.checked })} />
                      {COVER_LABELS[k]}
                      <span className="text-xs font-normal text-ink-3">{c.found ? 'jest w polisie' : 'brak w polisie'}</span>
                    </label>
                    {c.found && (
                      <div className="space-y-2 text-xs flex-1">
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(138px,1fr))] gap-1.5">
                          <input type="date" className={rInput} value={ddmmyyyyToIso(c.from || '')} onChange={(e) => updCover(k, { from: isoToDDMMYYYY(e.target.value) || undefined })} />
                          <input type="date" className={rInput} value={ddmmyyyyToIso(c.to || '')} onChange={(e) => updCover(k, { to: isoToDDMMYYYY(e.target.value) || undefined })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <RField label="Składka [zł]" small>
                            <MoneyInput value={c.premium} onChange={(v) => updCover(k, { premium: v })} />
                          </RField>
                          <RField label="Suma ubezp. [zł]" small>
                            <MoneyInput value={c.sumInsured} onChange={(v) => updCover(k, { sumInsured: v })} placeholder={k === 'oc' ? 'ustawowa' : ''} />
                          </RField>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <RField label="Rodzaj sumy" small>
                            <input className={rInput} value={c.sumNote || ''} onChange={(e) => updCover(k, { sumNote: e.target.value || undefined })} placeholder="np. netto" />
                          </RField>
                          <RField label="Wariant" small>
                            <input className={rInput} value={c.variant || ''} onChange={(e) => updCover(k, { variant: e.target.value || undefined })} placeholder={k === 'ac' ? 'np. serwisowy' : ''} />
                          </RField>
                        </div>
                        {c.snippet && <div className="text-ink-3 italic break-words">z polisy: „{c.snippet}”</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <EditableList title="Dodatkowe ochrony" items={parsed.extras} onChange={(extras) => updParsed({ extras })} placeholder="np. Assistance – składka 926 zł" multiline />
              <EditableList title="Warunki znalezione w treści" items={parsed.conditions} onChange={(conditions) => updParsed({ conditions })} placeholder="np. udział własny 500 zł" multiline />
            </div>
            <div>
              <div className="text-xs font-semibold text-ink-2 mb-1.5">Pozostałe informacje</div>
              <div className="space-y-2">
                {parsed.info.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5 items-center">
                    <input className={rInput} placeholder="Nazwa" value={it.label} onChange={(e) => updParsed({ info: parsed.info.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)) })} />
                    <input className={rInput} placeholder="Wartość" value={it.value} onChange={(e) => updParsed({ info: parsed.info.map((x, j) => (j === idx ? { ...x, value: e.target.value } : x)) })} />
                    <button onClick={() => updParsed({ info: parsed.info.filter((_, j) => j !== idx) })} className="p-1.5 text-ink-3 hover:text-danger" title="Usuń">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => updParsed({ info: [...parsed.info, { label: '', value: '' }] })} className="mt-2 text-xs font-semibold text-brand inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Dodaj informację
              </button>
            </div>
            {parsed.warnings.length > 0 && (
              <ul className="text-sm text-warn bg-warn-soft rounded-xl p-3 space-y-1">
                {parsed.warnings.map((w) => (
                  <li key={w} className="flex gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {w}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={applyParsed} className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
                <Check className="w-4 h-4" /> Wpisz do formularza
              </button>
              <button onClick={() => setParsed(null)} className="px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-subtle rounded-[10px]">
                Odrzuć
              </button>
              <button onClick={() => setShowText((s) => !s)} className="ml-auto text-xs text-ink-3 hover:text-ink">
                {showText ? 'Ukryj' : 'Pokaż'} odczytany tekst
              </button>
            </div>
            {showText && <pre className="text-[11px] bg-subtle rounded-xl p-3 max-h-72 overflow-auto whitespace-pre-wrap">{parsedText}</pre>}
          </div>
        )}
        {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-xl p-3">{error}</div>}
      </div>

      {/* OC / AC / NNW */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        {KINDS.map((k) => {
          const c = ins[k];
          const on = !!c?.enabled;
          const tone = on ? deadlineTone(getDaysRemaining(c?.to)) : null;
          return (
            <div key={k} className={`card p-5 flex flex-col gap-3 h-full ${on ? '' : 'opacity-90'}`}>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-ok-soft text-ok' : 'bg-subtle text-ink-3'}`}>
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-lg leading-tight flex-1 min-w-0">{COVER_LABELS[k]}</div>
                  {tone && <Badge tone={tone.tone}>{tone.tone === 'ok' ? `do ${c?.to}` : tone.label}</Badge>}
                </div>
                <p className="text-xs text-ink-3 leading-relaxed min-h-[2.5rem]">{COVER_DESCRIPTIONS[k]}</p>
              </div>

              <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                <input type="checkbox" checked={on} onChange={(e) => setCover(k, { enabled: e.target.checked })} />
                {on ? `Mam ${COVER_LABELS[k]}` : `Brak ${COVER_LABELS[k]}`}
              </label>

              {on && (
                <div className="flex flex-col flex-1 gap-3">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
                    <div className="col-span-full">
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Ubezpieczyciel</label>
                      <input value={c?.provider || ''} onChange={(e) => setCover(k, { provider: e.target.value })} className={inputCls} placeholder="np. PZU, Warta" />
                    </div>
                    <div className="col-span-full">
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Numer polisy</label>
                      <input value={c?.policyNumber || ''} onChange={(e) => setCover(k, { policyNumber: e.target.value })} className={`${inputCls} font-num`} />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Od</label>
                      <DateInput value={c?.from} onChange={(v) => setCover(k, { from: v })} />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Do *</label>
                      <DateInput value={c?.to} onChange={(v) => setCover(k, { to: v })} />
                    </div>
                    <div className={k === 'oc' ? 'col-span-full' : 'min-w-0'}>
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Składka (zł)</label>
                      <input type="number" min={0} step="0.01" value={c?.premium ?? ''} onChange={(e) => setCover(k, { premium: e.target.value === '' ? undefined : Number(e.target.value) })} className={`${inputCls} font-num`} />
                    </div>
                    {k !== 'oc' && (
                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold text-ink-2 mb-1">Suma ubezp. (zł)</label>
                        <input type="number" min={0} value={c?.sumInsured ?? ''} onChange={(e) => setCover(k, { sumInsured: e.target.value === '' ? undefined : Number(e.target.value) })} className={`${inputCls} font-num`} />
                      </div>
                    )}
                    <div className="col-span-full">
                      <label className="block text-[11px] font-semibold text-ink-2 mb-1">Uwagi</label>
                      <input value={c?.notes || ''} onChange={(e) => setCover(k, { notes: e.target.value })} className={inputCls} placeholder={k === 'ac' ? 'np. wariant serwisowy, udział własny 500 zł' : ''} />
                    </div>
                  </div>
                  {k !== 'oc' && ins.oc?.enabled && (
                    <button type="button" onClick={() => copyFromOc(k)} className="mt-auto pt-1 text-left text-xs font-semibold text-brand hover:underline">
                      Skopiuj ubezpieczyciela, numer i okres z OC
                    </button>
                  )}
                </div>
              )}
              {!on && k === 'oc' && <div className="mt-auto text-xs text-danger">OC jest obowiązkowe – bez niego auto nie może poruszać się po drogach.</div>}
            </div>
          );
        })}
      </div>

      {/* Dodatkowe ochrony + zapis */}
      <div className="card p-5 space-y-3">
        <div className="text-sm font-bold">Dodatkowe ochrony i warunki</div>
        <div className="flex flex-wrap gap-2">
          {(ins.extras || []).map((x) => (
            <span key={x} className="inline-flex items-start gap-1.5 px-3 py-1 rounded-xl bg-brand-soft text-brand text-xs font-semibold max-w-full break-words">
              <span className="break-words">{x}</span>
              <button
                type="button"
                className="shrink-0 mt-0.5"
                onClick={() => {
                  setIns((s) => ({ ...s, extras: (s.extras || []).filter((y) => y !== x) }));
                  setDirty(true);
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newExtra.trim()) return;
              setIns((s) => ({ ...s, extras: Array.from(new Set([...(s.extras || []), newExtra.trim()])) }));
              setNewExtra('');
              setDirty(true);
            }}
            className="inline-flex items-center gap-1"
          >
            <input value={newExtra} onChange={(e) => setNewExtra(e.target.value)} placeholder="np. Assistance, szyby" className="px-2.5 py-1 border border-line-strong rounded-full text-xs w-44" />
            <button className="p-1 rounded-full text-brand hover:bg-brand-soft">
              <Plus className="w-4 h-4" />
            </button>
          </form>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-line">
          <div className="flex-1 text-sm text-ok">{msg}</div>
          {pendingFile && <span className="text-xs text-ink-3">Plik polisy zapisze się razem z danymi</span>}
          <button onClick={save} disabled={saving || !dirty} className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-[10px] text-sm font-semibold inline-flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Zapisz ubezpieczenie
          </button>
        </div>
      </div>
    </div>
  );
};
