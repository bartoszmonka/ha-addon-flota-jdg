/**
 * Stan aplikacji Flota JDG zapisany w Firestore (wcześniej: localStorage przeglądarki).
 *
 * Struktura danych (zgodna z firebase-blueprint.json):
 *   users/{uid}                                    – dane podatnika (nagłówek ewidencji)
 *   users/{uid}/vehicles/{vid}                     – pojazdy
 *   users/{uid}/vehicles/{vid}/entries/{id}        – wpisy ewidencji (źródło prawdy: stan licznika po powrocie)
 *   users/{uid}/vehicles/{vid}/months/{YYYY-MM}    – zamknięcie / otwarcie miesiąca + historia
 *   users/{uid}/vehicles/{vid}/expenses/{id}       – koszty
 *   users/{uid}/vehicles/{vid}/saved_purposes/{id} – zapamiętane cele wyjazdu
 *   users/{uid}/vehicles/{vid}/saved_routes/{id}   – zapamiętane trasy
 *   users/{uid}/vehicles/{vid}/files/{id}/chunks   – pliki załączników
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { learnCities, registerCities } from '../lib/route';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from '../lib/docstore';
import {
  Attachment,
  Expense,
  LedgerHistoryItem,
  MileageEntry,
  MileageEntryInput,
  MonthlyLedger,
  QuickPurpose,
  QuickRoute,
  TaxpayerProfile,
  Vehicle,
} from '../types/fleet';
import { useAuth } from './AuthContext';
import { db } from '../lib/docstore';
import { ddmmyyyyToIso, getMonthBounds, getMonthKeyFromDDMMYYYY, getPolishMonthName } from '../lib/dateUtils';
import {
  StoredEntry,
  addMonths,
  checkEntryAgainstChain,
  compareEntries,
  deriveEntries,
  monthRange,
  summarizeMonths,
  validateEntries,
  ValidationIssue,
  planShiftCorrection,
  ShiftOp,
} from '../lib/mileageCalc';
import { removeAttachment, uploadAttachment } from '../lib/attachmentStore';
import { getAddressForMonth } from '../lib/address';
import { routeKey } from '../lib/plausibility';
import { fetchHaVehicle, HaVehicleLive, overlayHa } from '../lib/ha';

export interface ImportOptions {
  /** miesiące, które po imporcie mają zostać zamknięte */
  closeMonths: string[];
  /** usuń istniejące wpisy pojazdu przed importem */
  replaceExisting: boolean;
  /** stan licznika na start ewidencji (gdy pojazd dopiero co utworzono, nie ma go jeszcze w stanie) */
  initialOdometer?: number;
}

export type CorrectionOp =
  | { kind: 'update'; id: string; updates: Partial<Omit<MileageEntryInput, 'odometerEnd'>>; km: number }
  | { kind: 'add'; input: Omit<MileageEntryInput, 'odometerEnd'>; km: number }
  | { kind: 'addMany'; items: { input: Omit<MileageEntryInput, 'odometerEnd'>; km: number }[] }
  | { kind: 'delete'; id: string };

interface FleetContextType {
  loading: boolean;
  vehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  /** bieżące dane aktywnego pojazdu z Home Assistant (gdy pojazd jest powiązany z HA) */
  haLive: HaVehicleLive | null;
  setActiveVehicle: (vehicle: Vehicle) => void;
  addVehicle: (vehicle: Omit<Vehicle, 'id'>) => Promise<string>;
  updateVehicle: (id: string, updates: Partial<Vehicle>) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;

  taxpayer: TaxpayerProfile;
  updateTaxpayer: (updates: Partial<TaxpayerProfile>) => Promise<void>;

  /** wpisy aktywnego pojazdu z wyliczonymi polami (nr, licznik przy wyjeździe, km) */
  entries: MileageEntry[];
  /** wszystkie miesiące ewidencji od pierwszego do bieżącego */
  months: string[];
  currentMonthKey: string;
  setCurrentMonthKey: (monthKey: string) => void;
  /** stan licznika, od którego zacznie się nowy wpis z daną datą */
  getStartOdometerForDate: (dateDDMMYYYY: string, excludeEntryId?: string) => number;
  addMileageEntry: (entry: MileageEntryInput) => Promise<void>;
  updateMileageEntry: (id: string, updates: Partial<MileageEntryInput>) => Promise<void>;
  deleteMileageEntry: (id: string) => Promise<void>;
  /**
   * Korekta jak w Excelu: zmieniasz kilometry wpisu (albo dodajesz/usuwasz wpis),
   * a stany licznika we wszystkich kolejnych wpisach – także w zamkniętych miesiącach –
   * przesuwają się o tę samą różnicę. Km pozostałych wpisów się nie zmieniają.
   * Zwraca różnicę w km.
   */
  correctWithShift: (op: CorrectionOp, reason?: string) => Promise<number>;
  /** czy po wpisie / dniu są jeszcze wpisy w późniejszych miesiącach */
  hasEntriesAfterMonth: (monthKey: string) => boolean;
  validationIssues: ValidationIssue[];

  monthlyLedgers: Record<string, MonthlyLedger>;
  closeMonth: (monthKey: string) => Promise<void>;
  reopenMonth: (monthKey: string, reason?: string) => Promise<void>;
  /** zgodność wstecz: zamyka albo otwiera miesiąc */
  toggleMonthClosed: (monthKey: string) => Promise<void>;

  importEntries: (vehicleId: string, rows: MileageEntryInput[], options: ImportOptions) => Promise<number>;

  expenses: Expense[];
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;

  savedPurposes: QuickPurpose[];
  addSavedPurpose: (title: string, category?: string) => Promise<void>;
  deleteSavedPurpose: (id: string) => Promise<void>;

  savedRoutes: QuickRoute[];
  addSavedRoute: (route: string, typicalDistance?: number) => Promise<void>;

  getPurposeSuggestions: (query: string) => string[];
  getRouteSuggestions: (query: string) => string[];
  /** ostatnio przejechane km na tej trasie – tylko podpowiedź, licznik wpisujesz sam */
  getLastDistanceForRoute: (route: string) => number | null;

  addAttachmentToEntry: (entryId: string, attachment: Attachment, fileBlob: Blob) => Promise<void>;
  removeAttachmentFromEntry: (entryId: string, attachmentId: string) => Promise<void>;
}

export const FleetContext = createContext<FleetContextType | undefined>(undefined);

/** Cele wyjazdu najczęściej używane w dotychczasowej ewidencji (arkusz xlsx) – podpowiedzi startowe */
const DEFAULT_PURPOSES: QuickPurpose[] = [
  { id: 'd1', title: 'Przejazd do biura klienta', usageCount: 0 },
  { id: 'd2', title: 'Przejazd do stacji ładowania w celu naładowania samochodu', usageCount: 0 },
  { id: 'd3', title: 'Przejazd na myjnię ręczną', usageCount: 0 },
  { id: 'd4', title: 'Przejazd do placówki banku w celu obsługi konta firmowego', usageCount: 0 },
  { id: 'd5', title: 'Zakupy firmowe – paragon z NIP nr', usageCount: 0 },
  { id: 'd6', title: 'Złożenie dokumentów w urzędzie skarbowym', usageCount: 0 },
  { id: 'd7', title: 'Przejazd na konferencję IT', usageCount: 0 },
  { id: 'd8', title: 'Przejazd do serwisu ASO', usageCount: 0 },
];

const EMPTY_TAXPAYER: TaxpayerProfile = {
  companyName: '',
  nip: '',
  address: '',
  defaultDriverName: '',
};

const nowIso = () => new Date().toISOString();
const todayMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Stabilny identyfikator dokumentu z tekstu (np. cel wyjazdu) */
function slugId(text: string): string {
  let h = 0;
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `t_${(h >>> 0).toString(36)}`;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* tryb prywatny – pomijamy */
  }
}

export const FleetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || null;
  const userEmail = currentUser?.email || 'nieznany';

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);

  const [taxpayerDoc, setTaxpayerDoc] = useState<TaxpayerProfile | null>(null);
  const [vehiclesRaw, setVehiclesRaw] = useState<Vehicle[]>([]);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [entriesRaw, setEntriesRaw] = useState<StoredEntry[]>([]);
  const [ledgerDocs, setLedgerDocs] = useState<Record<string, MonthlyLedger>>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [savedPurposesRaw, setSavedPurposesRaw] = useState<QuickPurpose[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<QuickRoute[]>([]);
  const [currentMonthKey, setCurrentMonthKeyState] = useState<string>(todayMonthKey());
  const [haLive, setHaLive] = useState<HaVehicleLive | null>(null);

  // --- Subskrypcje: profil i pojazdy ---------------------------------------------------------
  useEffect(() => {
    setTaxpayerDoc(null);
    setVehiclesRaw([]);
    if (!uid) return;
    setLoadingProfile(true);
    setLoadingVehicles(true);
    setActiveVehicleId(readLocal(`flota_${uid}_activeVehicle`));

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        setTaxpayerDoc(snap.exists() ? (snap.data() as TaxpayerProfile) : null);
        setLoadingProfile(false);
      },
      (err) => {
        console.error('Profil:', err);
        setLoadingProfile(false);
      }
    );
    const unsubVehicles = onSnapshot(
      collection(db, 'users', uid, 'vehicles'),
      (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id }));
        list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        setVehiclesRaw(list);
        setLoadingVehicles(false);
      },
      (err) => {
        console.error('Pojazdy:', err);
        setLoadingVehicles(false);
      }
    );
    return () => {
      unsubProfile();
      unsubVehicles();
    };
  }, [uid]);

  const resolvedVehicleId =
    vehiclesRaw.find((v) => v.id === activeVehicleId)?.id || vehiclesRaw[0]?.id || null;

  // --- Subskrypcje danych aktywnego pojazdu -------------------------------------------------
  useEffect(() => {
    setEntriesRaw([]);
    setLedgerDocs({});
    setExpenses([]);
    setSavedPurposesRaw([]);
    setSavedRoutes([]);
    if (!uid || !resolvedVehicleId) {
      setLoadingEntries(false);
      return;
    }
    setLoadingEntries(true);
    const base = ['users', uid, 'vehicles', resolvedVehicleId] as const;
    const unsubs = [
      onSnapshot(collection(db, ...base, 'entries'), (snap) => {
        setEntriesRaw(snap.docs.map((d) => ({ ...(d.data() as StoredEntry), id: d.id })));
        setLoadingEntries(false);
      }, (err) => {
        console.error('Wpisy:', err);
        setLoadingEntries(false);
      }),
      onSnapshot(collection(db, ...base, 'months'), (snap) => {
        const out: Record<string, MonthlyLedger> = {};
        snap.docs.forEach((d) => (out[d.id] = { ...(d.data() as MonthlyLedger), monthKey: d.id }));
        setLedgerDocs(out);
      }),
      onSnapshot(collection(db, ...base, 'expenses'), (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as Expense), id: d.id }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setExpenses(list);
      }),
      onSnapshot(collection(db, ...base, 'saved_purposes'), (snap) => {
        setSavedPurposesRaw(snap.docs.map((d) => ({ ...(d.data() as QuickPurpose), id: d.id })));
      }),
      onSnapshot(collection(db, ...base, 'saved_routes'), (snap) => {
        setSavedRoutes(snap.docs.map((d) => ({ ...(d.data() as QuickRoute), id: d.id })));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid, resolvedVehicleId]);

  // --- Dane z Home Assistant (odświeżane co 5 minut) --------------------------------------------
  const haPrefix = vehiclesRaw.find((v) => v.id === resolvedVehicleId)?.haPrefix || null;
  useEffect(() => {
    setHaLive(null);
    if (!uid || !haPrefix) return;
    let cancelled = false;
    const load = () =>
      fetchHaVehicle(haPrefix)
        .then((d) => !cancelled && setHaLive(d))
        .catch((e) => console.warn('Home Assistant:', e));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [uid, haPrefix]);

  // --- Wartości wyliczane --------------------------------------------------------------------
  const vehicleRaw = vehiclesRaw.find((v) => v.id === resolvedVehicleId) || null;
  const initialOdometer = vehicleRaw?.initialOdometer ?? 0;

  const entries = useMemo(() => deriveEntries(entriesRaw, initialOdometer), [entriesRaw, initialOdometer]);

  const months = useMemo(() => {
    const keys = new Set<string>();
    entries.forEach((e) => keys.add(e.monthKey));
    Object.keys(ledgerDocs).forEach((k) => keys.add(k));
    if (vehicleRaw?.registerStartDate) keys.add(getMonthKeyFromDDMMYYYY(vehicleRaw.registerStartDate));
    keys.add(todayMonthKey());
    const sorted = Array.from(keys).filter(Boolean).sort();
    return monthRange(sorted[0], sorted[sorted.length - 1]);
  }, [entries, ledgerDocs, vehicleRaw?.registerStartDate]);

  const monthlyLedgers = useMemo(() => {
    const summaries = summarizeMonths(entries, months, initialOdometer);
    const out: Record<string, MonthlyLedger> = {};
    months.forEach((mKey, idx) => {
      const s = summaries[mKey];
      const stored = ledgerDocs[mKey];
      const bounds = getMonthBounds(mKey);
      const firstEntry = entries.find((e) => e.monthKey === mKey && !e.odometerConflict) || entries.find((e) => e.monthKey === mKey);
      const startDate =
        idx === 0 ? vehicleRaw?.registerStartDate || firstEntry?.date || bounds.start : bounds.start;
      out[mKey] = {
        vehicleId: resolvedVehicleId || '',
        monthKey: mKey,
        monthName: getPolishMonthName(mKey),
        year: Number(mKey.slice(0, 4)),
        isClosed: stored?.isClosed ?? false,
        closedAt: stored?.closedAt,
        closedBy: stored?.closedBy,
        history: stored?.history || [],
        startOdometer: s.startOdometer,
        endOdometer: s.endOdometer,
        totalDistanceKm: s.totalDistanceKm,
        entriesCount: s.entriesCount,
        pageNumber: s.pageNumber,
        startDate,
        endDate: bounds.end,
      };
    });
    return out;
  }, [entries, months, ledgerDocs, initialOdometer, resolvedVehicleId, vehicleRaw?.registerStartDate]);

  const validationIssues = useMemo(() => {
    const issues = validateEntries(entries);
    // zamknięty miesiąc, którego wartości zmieniły się po zamknięciu (np. edycja poprzedniego miesiąca)
    Object.values(ledgerDocs).forEach((stored) => {
      const live = monthlyLedgers[stored.monthKey];
      if (stored.isClosed && live && (stored.endOdometer !== live.endOdometer || stored.startOdometer !== live.startOdometer)) {
        issues.push({
          level: 'warning',
          monthKey: stored.monthKey,
          message: `Miesiąc ${stored.monthKey} był zamknięty ze stanem ${stored.startOdometer} → ${stored.endOdometer} km, a obecnie wychodzi ${live.startOdometer} → ${live.endOdometer} km.`,
        });
      }
    });
    return issues;
  }, [entries, ledgerDocs, monthlyLedgers]);

  const validEntries = entries.filter((e) => !e.odometerConflict);
  const lastEnd = validEntries.length ? validEntries[validEntries.length - 1].odometerEnd : initialOdometer;
  const vehicles = useMemo(
    () =>
      vehiclesRaw.map((v) =>
        v.id === resolvedVehicleId
          ? {
              ...v,
              currentOdometer: validEntries.length
                ? lastEnd
                : entriesRaw.length > 0
                  ? initialOdometer
                  : v.currentOdometer ?? initialOdometer,
            }
          : v
      ),
    [vehiclesRaw, resolvedVehicleId, validEntries.length, lastEnd, entriesRaw.length, initialOdometer]
  );
  const activeVehicle = useMemo(() => {
    const v = vehicles.find((x) => x.id === resolvedVehicleId);
    return v ? overlayHa(v, haLive) : null;
  }, [vehicles, resolvedVehicleId, haLive]);

  const taxpayer: TaxpayerProfile = {
    ...EMPTY_TAXPAYER,
    defaultDriverName: currentUser?.displayName || '',
    ...(taxpayerDoc || {}),
  };

  // miasta do zapisu tras „ulica nr, miasto” – z adresów firmy i z dotychczasowych wpisów
  useMemo(() => {
    registerCities([...(taxpayer.addresses || []).map((a) => a.city)]);
    learnCities(entries.map((e) => e.routeDescription));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, taxpayerDoc]);

  const setCurrentMonthKey = (k: string) => setCurrentMonthKeyState(k);

  // --- Pomocnicze ----------------------------------------------------------------------------
  const requireVehicle = () => {
    if (!uid || !resolvedVehicleId) throw new Error('Najpierw dodaj i wybierz pojazd.');
    return { uid, vid: resolvedVehicleId };
  };
  const vehCol = (name: string) => {
    const { uid: u, vid } = requireVehicle();
    return collection(db, 'users', u, 'vehicles', vid, name);
  };

  // --- Pojazdy --------------------------------------------------------------------------------
  const setActiveVehicle = (v: Vehicle) => {
    setActiveVehicleId(v.id);
    if (uid) writeLocal(`flota_${uid}_activeVehicle`, v.id);
  };

  const addVehicle = async (newVeh: Omit<Vehicle, 'id'>) => {
    if (!uid) throw new Error('Brak zalogowanego użytkownika.');
    const id = newId('veh');
    await setDoc(doc(db, 'users', uid, 'vehicles', id), { ...newVeh, id, createdAt: nowIso() });
    setActiveVehicleId(id);
    writeLocal(`flota_${uid}_activeVehicle`, id);
    return id;
  };

  const updateVehicle = async (id: string, updates: Partial<Vehicle>) => {
    if (!uid) return;
    const clean: Record<string, unknown> = { ...updates, updatedAt: nowIso() };
    delete clean.id;
    Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k]);
    // mergeFields: podane pola (np. cały obiekt `insurance`) są zastępowane w całości, reszta dokumentu zostaje
    await setDoc(doc(db, 'users', uid, 'vehicles', id), clean, { mergeFields: Object.keys(clean) });
  };

  const deleteVehicle = async (id: string) => {
    if (!uid) return;
    const base = ['users', uid, 'vehicles', id] as const;
    // najpierw miesiące (żeby reguły pozwoliły usunąć wpisy z zamkniętych miesięcy), potem reszta
    for (const name of ['months', 'entries', 'expenses', 'saved_purposes', 'saved_routes']) {
      const snap = await getDocs(collection(db, ...base, name));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    const files = await getDocs(collection(db, ...base, 'files'));
    for (const f of files.docs) {
      const chunks = await getDocs(collection(f.ref, 'chunks'));
      await Promise.all(chunks.docs.map((c) => deleteDoc(c.ref)));
      await deleteDoc(f.ref);
    }
    await deleteDoc(doc(db, ...base));
  };

  const updateTaxpayer = async (updates: Partial<TaxpayerProfile>) => {
    if (!uid) return;
    await setDoc(
      doc(db, 'users', uid),
      { ...updates, email: currentUser?.email || '', updatedAt: nowIso(), ...(taxpayerDoc ? {} : { createdAt: nowIso() }) },
      { merge: true }
    );
  };

  // --- Ewidencja ------------------------------------------------------------------------------
  const getStartOdometerForDate = (date: string, excludeEntryId?: string) => {
    const others = entriesRaw.filter((e) => e.id !== excludeEntryId);
    const derived = deriveEntries(others, initialOdometer);
    const targetIso = ddmmyyyyToIso(date);
    if (!targetIso) return initialOdometer;
    const cur = excludeEntryId ? entriesRaw.find((e) => e.id === excludeEntryId) : undefined;
    const sameDayAsCur = Boolean(cur && ddmmyyyyToIso(cur.date) === targetIso);
    let lastEndVal = initialOdometer;
    for (const e of derived) {
      if (e.odometerConflict) continue;
      if (sameDayAsCur && cur) {
        if (compareEntries(e, cur) < 0) lastEndVal = e.odometerEnd;
      } else if (ddmmyyyyToIso(e.date) <= targetIso) {
        lastEndVal = e.odometerEnd;
      }
    }
    return lastEndVal;
  };

  const learn = async (entry: MileageEntryInput) => {
    const purpose = entry.purposeDescription.trim();
    const route = entry.routeDescription.trim();
    const ops: Promise<unknown>[] = [];
    if (purpose.length >= 3) {
      ops.push(setDoc(doc(vehCol('saved_purposes'), slugId(purpose)), { title: purpose, usageCount: increment(1) }, { merge: true }));
    }
    if (route.length >= 3) {
      ops.push(setDoc(doc(vehCol('saved_routes'), slugId(route)), { route, usageCount: increment(1) }, { merge: true }));
    }
    await Promise.all(ops).catch((e) => console.warn('Nie zapisano podpowiedzi:', e));
  };

  const syncVehicleOdometer = async (vid: string, nextRaw: StoredEntry[], initOdo: number, curOdo?: number) => {
    const derivedNext = deriveEntries(nextRaw, initOdo);
    const validNext = derivedNext.filter((e) => !e.odometerConflict);
    const nextLastEnd = validNext.length ? validNext[validNext.length - 1].odometerEnd : initOdo;
    if (curOdo !== nextLastEnd) {
      await updateVehicle(vid, { currentOdometer: nextLastEnd });
    }
  };

  const addMileageEntry = async (input: MileageEntryInput) => {
    const { vid } = requireVehicle();
    const id = newId('entry');
    const candidate: StoredEntry = {
      ...input,
      id,
      vehicleId: vid,
      monthKey: getMonthKeyFromDDMMYYYY(input.date),
      odometerEnd: Number(input.odometerEnd),
      source: input.source || 'manual',
      createdAt: nowIso(),
    };
    if (candidate.odometerStartOverride === undefined) delete candidate.odometerStartOverride;
    const err = checkEntryAgainstChain(candidate, entriesRaw, initialOdometer, ledgerDocs);
    if (err) throw new Error(err);
    await setDoc(doc(vehCol('entries'), id), candidate);
    await syncVehicleOdometer(vid, [...entriesRaw, candidate], initialOdometer, vehicleRaw?.currentOdometer);
    learn(input);
  };

  const updateMileageEntry = async (id: string, updates: Partial<MileageEntryInput>) => {
    const { vid } = requireVehicle();
    const current = entriesRaw.find((e) => e.id === id);
    if (!current) throw new Error('Nie znaleziono wpisu.');
    if (ledgerDocs[current.monthKey]?.isClosed) throw new Error('Miesiąc jest zamknięty – najpierw go otwórz.');
    const candidate: StoredEntry = {
      ...current,
      ...updates,
      odometerEnd: Number(updates.odometerEnd ?? current.odometerEnd),
      updatedAt: nowIso(),
    };
    candidate.monthKey = getMonthKeyFromDDMMYYYY(candidate.date);
    const err = checkEntryAgainstChain(
      candidate,
      entriesRaw.filter((e) => e.id !== id),
      initialOdometer,
      ledgerDocs
    );
    if (err) throw new Error(err);
    const toSave = { ...candidate } as Record<string, unknown>;
    delete toSave.entryNumber;
    delete toSave.odometerStart;
    delete toSave.distanceKm;
    delete toSave.odometerGap;
    delete toSave.prevOdometerEnd;
    delete toSave.odometerConflict;
    delete toSave.conflictReason;
    if (toSave.odometerStartOverride === undefined) delete toSave.odometerStartOverride;
    await setDoc(doc(vehCol('entries'), id), toSave);
    await syncVehicleOdometer(
      vid,
      entriesRaw.map((e) => (e.id === id ? candidate : e)),
      initialOdometer,
      vehicleRaw?.currentOdometer
    );
  };

  const deleteMileageEntry = async (id: string) => {
    const idx = entries.findIndex((e) => e.id === id);
    const target = entries[idx];
    if (!target) return;
    if (ledgerDocs[target.monthKey]?.isClosed) throw new Error('Miesiąc jest zamknięty – najpierw go otwórz.');
    const next = !target.odometerConflict ? entries.slice(idx + 1).find((e) => !e.odometerConflict) : undefined;
    if (next && next.odometerStartOverride === undefined && next.monthKey !== target.monthKey && ledgerDocs[next.monthKey]?.isClosed) {
      throw new Error(`Usunięcie zmieniłoby stan licznika w zamkniętym miesiącu ${next.monthKey}.`);
    }
    const { uid: u, vid } = requireVehicle();
    for (const att of target.attachments || []) {
      await removeAttachment(u, vid, att).catch((e) => console.warn(e));
    }
    await deleteDoc(doc(vehCol('entries'), id));
    await syncVehicleOdometer(
      vid,
      entriesRaw.filter((e) => e.id !== id),
      initialOdometer,
      vehicleRaw?.currentOdometer
    );
  };

  // --- Zamykanie / otwieranie miesięcy --------------------------------------------------------
  const closeMonth = async (monthKey: string) => {
    const idx = months.indexOf(monthKey);
    const openEarlier = months
      .slice(0, Math.max(0, idx))
      .filter((m) => monthlyLedgers[m]?.entriesCount > 0 && !monthlyLedgers[m]?.isClosed);
    if (openEarlier.length) {
      throw new Error(`Najpierw zamknij wcześniejsze miesiące: ${openEarlier.join(', ')}.`);
    }
    const errors = validationIssues.filter((i) => i.level === 'error' && i.monthKey === monthKey);
    if (errors.length) throw new Error(`Popraw błędy przed zamknięciem:\n${errors.map((e) => e.message).join('\n')}`);
    if (!taxpayer.companyName || !taxpayer.nip) {
      throw new Error('Uzupełnij nazwę firmy i NIP w Ustawieniach – są wymagane w nagłówku ewidencji.');
    }
    if (!getAddressForMonth(taxpayer, monthKey)) {
      throw new Error('Uzupełnij adres prowadzonej działalności w Ustawieniach.');
    }
    const live = monthlyLedgers[monthKey];
    const item: LedgerHistoryItem = { action: 'close', at: nowIso(), by: userEmail };
    await setDoc(
      doc(vehCol('months'), monthKey),
      {
        monthKey,
        vehicleId: resolvedVehicleId,
        monthName: live.monthName,
        year: live.year,
        isClosed: true,
        closedAt: item.at,
        closedBy: userEmail,
        startOdometer: live.startOdometer,
        endOdometer: live.endOdometer,
        totalDistanceKm: live.totalDistanceKm,
        entriesCount: live.entriesCount,
        pageNumber: live.pageNumber,
        history: arrayUnion(item),
      },
      { merge: true }
    );
  };

  const reopenMonth = async (monthKey: string, reason?: string) => {
    // Każdy miesiąc można otworzyć osobno. Późniejsze zamknięte miesiące zostają zamknięte –
    // korekta kilometrów przesunie w nich tylko stany licznika (z wpisem w historii).
    const item: LedgerHistoryItem = { action: 'open', at: nowIso(), by: userEmail, reason: reason || undefined };
    await setDoc(
      doc(vehCol('months'), monthKey),
      { monthKey, isClosed: false, closedAt: null, history: arrayUnion(item) },
      { merge: true }
    );
  };

  const hasEntriesAfterMonth = (monthKey: string) => entries.some((e) => e.monthKey > monthKey);

  const correctWithShift = async (op: CorrectionOp, reason?: string): Promise<number> => {
    const { uid: u, vid } = requireVehicle();
    const stamp = nowIso();
    let shiftOp: ShiftOp;
    if (op.kind === 'update') {
      const cur = entries.find((e) => e.id === op.id);
      if (!cur) throw new Error('Nie znaleziono wpisu.');
      const newMonth = getMonthKeyFromDDMMYYYY(op.updates.date ?? cur.date);
      if (ledgerDocs[cur.monthKey]?.isClosed || ledgerDocs[newMonth]?.isClosed) throw new Error('Miesiąc jest zamknięty – najpierw go otwórz.');
      shiftOp = { kind: 'update', id: op.id, updates: { ...op.updates, updatedAt: stamp }, km: op.km };
    } else if (op.kind === 'add') {
      const m = getMonthKeyFromDDMMYYYY(op.input.date);
      if (ledgerDocs[m]?.isClosed) throw new Error('Miesiąc jest zamknięty – najpierw go otwórz.');
      shiftOp = {
        kind: 'add',
        entry: { ...op.input, id: newId('entry'), vehicleId: vid, monthKey: m, odometerEnd: 0, source: 'manual', createdAt: stamp },
        km: op.km,
      };
    } else if (op.kind === 'addMany') {
      const closed = op.items.map((it) => getMonthKeyFromDDMMYYYY(it.input.date)).filter((m) => ledgerDocs[m]?.isClosed);
      if (closed.length) throw new Error(`Miesiąc ${closed[0]} jest zamknięty – najpierw go otwórz.`);
      shiftOp = {
        kind: 'addMany',
        items: op.items.map((it) => ({
          entry: { ...it.input, id: newId('entry'), vehicleId: vid, monthKey: getMonthKeyFromDDMMYYYY(it.input.date), odometerEnd: 0, source: 'manual', createdAt: stamp },
          km: it.km,
        })),
      };
    } else {
      const cur = entries.find((e) => e.id === op.id);
      if (!cur) return 0;
      if (ledgerDocs[cur.monthKey]?.isClosed) throw new Error('Miesiąc jest zamknięty – najpierw go otwórz.');
      shiftOp = { kind: 'delete', id: op.id };
    }
    const plan = planShiftCorrection(entries, shiftOp, initialOdometer);
    const { opMonth, delta } = plan;
    const corrId = newId('corr');
    const writes: { ref: ReturnType<typeof doc>; data: Record<string, unknown>; full?: boolean }[] = [];
    plan.rows.forEach((r) => {
      if (plan.targetIds.includes(r.id)) {
        const { km: _k, ...rest } = r;
        const clean = { ...rest } as Record<string, unknown>;
        delete clean.odometerConflict;
        delete clean.conflictReason;
        if (clean.odometerStartOverride === undefined) delete clean.odometerStartOverride;
        writes.push({ ref: doc(vehCol('entries'), r.id), data: clean, full: true });
      } else if (plan.shiftedIds.includes(r.id)) {
        writes.push({ ref: doc(vehCol('entries'), r.id), data: { odometerEnd: r.odometerEnd, updatedAt: stamp, correction: corrId } });
      }
    });
    if (op.kind === 'delete') {
      const cur = entries.find((e) => e.id === op.id);
      for (const att of cur?.attachments || []) await removeAttachment(u, vid, att).catch((e) => console.warn(e));
    }
    const newDerived = deriveEntries(plan.rows.map((r, i) => ({ ...r, seq: i })), initialOdometer);
    const validNew = newDerived.filter((e) => !e.odometerConflict);
    const newLastEnd = validNew.length ? validNew[validNew.length - 1].odometerEnd : initialOdometer;

    // zapis partiami (limit 500 operacji na partię)
    const batches: ReturnType<typeof writeBatch>[] = [];
    let batch = writeBatch(db);
    let n = 0;
    const push = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
      if (n >= 400) {
        batches.push(batch);
        batch = writeBatch(db);
        n = 0;
      }
      fn(batch);
      n++;
    };
    if (op.kind === 'delete') push((b) => b.delete(doc(vehCol('entries'), op.id)));
    writes.forEach((w) => push((b) => (w.full ? b.set(w.ref, w.data) : b.update(w.ref, w.data))));

    // zamknięte miesiące po korekcie: nowe stany na początek/koniec + wpis w historii
    const sums = summarizeMonths(newDerived, months, initialOdometer);
    const at = stamp;
    Object.values(ledgerDocs)
      .filter((l) => l.isClosed && l.monthKey > opMonth)
      .forEach((l) => {
        const s2 = sums[l.monthKey];
        if (!s2 || (s2.startOdometer === l.startOdometer && s2.endOdometer === l.endOdometer)) return;
        const item: LedgerHistoryItem = {
          action: 'correction',
          at,
          by: userEmail,
          reason: `Korekta w miesiącu ${opMonth}: stany licznika ${delta >= 0 ? '+' : ''}${delta} km${reason ? ` – ${reason}` : ''}`,
        };
        push((b) =>
          b.set(
            doc(vehCol('months'), l.monthKey),
            { startOdometer: s2.startOdometer, endOdometer: s2.endOdometer, totalDistanceKm: s2.totalDistanceKm, entriesCount: s2.entriesCount, history: arrayUnion(item) },
            { merge: true }
          )
        );
      });
    batches.push(batch);
    for (const b of batches) await b.commit();

    if (vehicleRaw && vehicleRaw.currentOdometer !== newLastEnd) {
      await updateVehicle(vid, { currentOdometer: newLastEnd });
    }
    if (op.kind !== 'delete') {
      const src = plan.rows.find((r) => r.id === plan.targetIds[0]);
      if (src) learn(src);
    }
    return delta;
  };

  const toggleMonthClosed = async (monthKey: string) => {
    if (monthlyLedgers[monthKey]?.isClosed) await reopenMonth(monthKey);
    else await closeMonth(monthKey);
  };

  // --- Import z Excela ------------------------------------------------------------------------
  const importEntries = async (vehicleId: string, rows: MileageEntryInput[], options: ImportOptions) => {
    if (!uid) throw new Error('Brak zalogowanego użytkownika.');
    const base = ['users', uid, 'vehicles', vehicleId] as const;
    {
      const veh0 = vehiclesRaw.find((v) => v.id === vehicleId);
      const init0 = options.initialOdometer ?? veh0?.initialOdometer ?? 0;
      const existing = options.replaceExisting || vehicleId !== resolvedVehicleId ? [] : entriesRaw;
      const check = deriveEntries(
        [...existing, ...rows.map((r, i) => ({ ...r, id: `chk${i}`, vehicleId, monthKey: getMonthKeyFromDDMMYYYY(r.date) }))],
        init0
      );
      const bad = validateEntries(check).filter((i) => i.level === 'error');
      if (bad.length) throw new Error(`Import przerwany – dane się nie zgadzają:\n${bad.slice(0, 5).map((b) => b.message).join('\n')}`);
    }

    // Import zastępuje całą ewidencję pojazdu: stare wpisy, zamknięcia miesięcy, ich załączniki
    // i podpowiedzi tras – żeby nic się nie zdublowało ani nie nadpisało.
    if (options.replaceExisting) {
      const existing = await getDocs(collection(db, ...base, 'entries'));
      const oldIds = new Set(existing.docs.map((d) => d.id));
      // najpierw zamknięcia miesięcy (po ich usunięciu wpisy są „otwarte” i można je skasować)
      const monthsSnap = await getDocs(collection(db, ...base, 'months'));
      for (let i = 0; i < monthsSnap.docs.length; i += 400) {
        const b = writeBatch(db);
        monthsSnap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
      // wpisy kasujemy paczkami po maks. 8 miesięcy – reguły sprawdzają dokument miesiąca
      // przy każdym wpisie, a Firestore pozwala na 20 takich sprawdzeń w jednej partii
      const byMonth = new Map<string, typeof existing.docs>();
      existing.docs.forEach((d) => {
        const m = String(d.data().monthKey || '');
        byMonth.set(m, [...(byMonth.get(m) || []), d]);
      });
      let batch = writeBatch(db);
      let ops = 0;
      let monthsInBatch = 0;
      for (const docs of byMonth.values()) {
        if (monthsInBatch >= 8 || ops + docs.length > 450) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
          monthsInBatch = 0;
        }
        docs.forEach((d) => batch.delete(d.ref));
        ops += docs.length;
        monthsInBatch++;
      }
      if (ops) await batch.commit();
      // załączniki usuniętych wpisów (polisa i zdjęcie auta zostają)
      const files = await getDocs(collection(db, ...base, 'files'));
      for (const f of files.docs) {
        if (!oldIds.has(String(f.data().entryId || ''))) continue;
        const chunks = await getDocs(collection(f.ref, 'chunks'));
        const b = writeBatch(db);
        chunks.docs.forEach((c) => b.delete(c.ref));
        b.delete(f.ref);
        await b.commit();
      }
      // podpowiedzi tras z poprzedniej ewidencji
      const routes = await getDocs(collection(db, ...base, 'saved_routes'));
      for (let i = 0; i < routes.docs.length; i += 400) {
        const b = writeBatch(db);
        routes.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }

    const stamp = nowIso();
    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db);
      rows.slice(i, i + 400).forEach((r) => {
        const id = newId('imp');
        batch.set(doc(db, ...base, 'entries', id), {
          ...r,
          id,
          vehicleId,
          monthKey: getMonthKeyFromDDMMYYYY(r.date),
          source: 'import',
          createdAt: stamp,
        });
      });
      await batch.commit();
    }

    // podpowiedzi z importu
    const purposeCount: Record<string, number> = {};
    const routeCount: Record<string, number> = {};
    rows.forEach((r) => {
      purposeCount[r.purposeDescription.trim()] = (purposeCount[r.purposeDescription.trim()] || 0) + 1;
      routeCount[r.routeDescription.trim()] = (routeCount[r.routeDescription.trim()] || 0) + 1;
    });
    const batch = writeBatch(db);
    Object.entries(purposeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 150)
      .forEach(([title, n]) => batch.set(doc(db, ...base, 'saved_purposes', slugId(title)), { title, usageCount: n }, { merge: true }));
    Object.entries(routeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 300)
      .forEach(([route, n]) => batch.set(doc(db, ...base, 'saved_routes', slugId(route)), { route, usageCount: n }, { merge: true }));
    await batch.commit();

    // zamknięcie wskazanych miesięcy – liczone z danych importu
    if (options.closeMonths.length) {
      const veh = vehiclesRaw.find((v) => v.id === vehicleId);
      const init = options.initialOdometer ?? veh?.initialOdometer ?? 0;
      const derived = deriveEntries(
        rows.map((r, i) => ({ ...r, id: `r${i}`, vehicleId, monthKey: getMonthKeyFromDDMMYYYY(r.date) })),
        init
      );
      const allMonths = monthRange(derived[0].monthKey, derived[derived.length - 1].monthKey);
      const sums = summarizeMonths(derived, allMonths, init);
      const mb = writeBatch(db);
      options.closeMonths.forEach((mKey) => {
        const s = sums[mKey];
        if (!s) return;
        const item: LedgerHistoryItem = { action: 'close', at: stamp, by: userEmail, reason: 'Import z pliku Excel' };
        mb.set(doc(db, ...base, 'months', mKey), {
          monthKey: mKey,
          vehicleId,
          monthName: getPolishMonthName(mKey),
          year: Number(mKey.slice(0, 4)),
          isClosed: true,
          closedAt: stamp,
          closedBy: userEmail,
          startOdometer: s.startOdometer,
          endOdometer: s.endOdometer,
          totalDistanceKm: s.totalDistanceKm,
          entriesCount: s.entriesCount,
          pageNumber: s.pageNumber,
          history: [item],
        });
      });
      await mb.commit();
    }
    const vehAfter = vehiclesRaw.find((v) => v.id === vehicleId);
    const initAfter = options.initialOdometer ?? vehAfter?.initialOdometer ?? 0;
    const existingAfter = options.replaceExisting || vehicleId !== resolvedVehicleId ? [] : entriesRaw;
    await syncVehicleOdometer(
      vehicleId,
      [...existingAfter, ...rows.map((r, i) => ({ ...r, id: `imp_${i}`, vehicleId, monthKey: getMonthKeyFromDDMMYYYY(r.date) }))],
      initAfter,
      vehAfter?.currentOdometer
    );
    return rows.length;
  };

  // --- Koszty ---------------------------------------------------------------------------------
  const addExpense = async (newExp: Omit<Expense, 'id'>) => {
    const id = newId('exp');
    await setDoc(doc(vehCol('expenses'), id), { ...newExp, id, createdAt: nowIso() });
  };
  const deleteExpense = async (id: string) => {
    await deleteDoc(doc(vehCol('expenses'), id));
  };

  // --- Cele i trasy ---------------------------------------------------------------------------
  const savedPurposes = useMemo(() => {
    const list = [...savedPurposesRaw];
    DEFAULT_PURPOSES.forEach((d) => {
      if (!list.some((p) => p.title.toLowerCase() === d.title.toLowerCase())) list.push(d);
    });
    return list.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  }, [savedPurposesRaw]);

  const addSavedPurpose = async (title: string, category?: string) => {
    if (!title.trim()) return;
    await setDoc(doc(vehCol('saved_purposes'), slugId(title)), { title: title.trim(), category: category || null, usageCount: increment(0) }, { merge: true });
  };
  const deleteSavedPurpose = async (id: string) => {
    if (id.startsWith('d')) return; // podpowiedzi domyślne nie są zapisane w bazie
    await deleteDoc(doc(vehCol('saved_purposes'), id));
  };
  const addSavedRoute = async (route: string, typicalDistance?: number) => {
    if (!route.trim()) return;
    await setDoc(doc(vehCol('saved_routes'), slugId(route)), { route: route.trim(), typicalDistance, usageCount: increment(0) }, { merge: true });
  };

  const rankBy = (values: string[], query: string) => {
    const q = query.toLowerCase();
    const counts = new Map<string, number>();
    values.forEach((v) => {
      const t = v?.trim();
      if (t && t.toLowerCase().includes(q)) counts.set(t, (counts.get(t) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .slice(0, 8);
  };

  const getPurposeSuggestions = (query: string) => {
    if (!query || query.length < 3) return [];
    return rankBy(
      [...savedPurposes.flatMap((p) => Array(Math.max(1, p.usageCount || 1)).fill(p.title)), ...entries.map((e) => e.purposeDescription)],
      query
    );
  };
  const getRouteSuggestions = (query: string) => {
    if (!query || query.length < 3) return [];
    return rankBy([...savedRoutes.map((r) => r.route), ...entries.map((e) => e.routeDescription)], query);
  };
  const getLastDistanceForRoute = (route: string) => {
    const r = routeKey(route);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!entries[i].odometerConflict && routeKey(entries[i].routeDescription) === r) return entries[i].distanceKm;
    }
    return null;
  };

  // --- Załączniki -----------------------------------------------------------------------------
  const addAttachmentToEntry = async (entryId: string, attachment: Attachment, fileBlob: Blob) => {
    const { uid: u, vid } = requireVehicle();
    const meta = await uploadAttachment(u, vid, entryId, attachment, fileBlob);
    await updateDoc(doc(vehCol('entries'), entryId), { attachments: arrayUnion(meta), updatedAt: nowIso() });
  };

  const removeAttachmentFromEntry = async (entryId: string, attachmentId: string) => {
    const { uid: u, vid } = requireVehicle();
    const entry = entriesRaw.find((e) => e.id === entryId);
    if (!entry) return;
    if (ledgerDocs[entry.monthKey]?.isClosed) throw new Error('Miesiąc jest zamknięty – nie można usuwać dowodów.');
    const att = (entry.attachments || []).find((a) => a.id === attachmentId);
    if (att) await removeAttachment(u, vid, att);
    await updateDoc(doc(vehCol('entries'), entryId), {
      attachments: (entry.attachments || []).filter((a) => a.id !== attachmentId),
      updatedAt: nowIso(),
    });
  };

  const loading = Boolean(uid) && (loadingProfile || loadingVehicles || (Boolean(resolvedVehicleId) && loadingEntries));

  return (
    <FleetContext.Provider
      value={{
        loading,
        vehicles,
        activeVehicle,
        haLive,
        setActiveVehicle,
        addVehicle,
        updateVehicle,
        deleteVehicle,
        taxpayer,
        updateTaxpayer,
        entries,
        months,
        currentMonthKey,
        setCurrentMonthKey,
        getStartOdometerForDate,
        addMileageEntry,
        updateMileageEntry,
        deleteMileageEntry,
        correctWithShift,
        hasEntriesAfterMonth,
        validationIssues,
        monthlyLedgers,
        closeMonth,
        reopenMonth,
        toggleMonthClosed,
        importEntries,
        expenses,
        addExpense,
        deleteExpense,
        savedPurposes,
        addSavedPurpose,
        deleteSavedPurpose,
        savedRoutes,
        addSavedRoute,
        getPurposeSuggestions,
        getRouteSuggestions,
        getLastDistanceForRoute,
        addAttachmentToEntry,
        removeAttachmentFromEntry,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
};

export function useFleet() {
  const context = useContext(FleetContext);
  if (!context) {
    throw new Error('useFleet must be used within a FleetProvider');
  }
  return context;
}

export { addMonths };
