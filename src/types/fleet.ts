/**
 * Definicje typów dla systemu Flota JDG
 */

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string; // 'application/pdf' | 'image/png' | 'image/jpeg' etc.
  category: 'faktura' | 'bilet' | 'serwis' | 'inny';
  description?: string;
  /** @deprecated nie zapisujemy base64 w dokumencie wpisu (limit 1 MB Firestore) */
  dataUrl?: string;
  /** liczba fragmentów pliku zapisanych w Firestore (files/{id}/chunks) */
  chunkCount?: number;
  createdAt: string;
}

/**
 * Wpis ewidencji. Źródłem prawdy jest STAN LICZNIKA PO POWROCIE (odometerEnd).
 * Pola entryNumber, odometerStart i distanceKm są wyliczane w aplikacji
 * z ciągłości licznika (poprzedni wpis → ten wpis), tak jak formuły w arkuszu Excel.
 */
export interface MileageEntry {
  id: string;
  vehicleId: string;
  monthKey: string; // format YYYY-MM np. "2023-08"
  entryNumber: number;
  date: string; // format DD.MM.RRRR
  routeDescription: string;
  purposeDescription: string;
  distanceKm: number;
  driverName: string;
  odometerStart: number;
  odometerEnd: number;
  /** Ręcznie wpisany stan licznika przy wyjeździe (gdy wpisy uzupełniane są nie po kolei i brakuje wcześniejszych) */
  odometerStartOverride?: number;
  /** Wyliczane: prawda, jeśli przed tym wpisem brakuje ciągłości licznika */
  odometerGap?: boolean;
  /** Wyliczane: stan licznika po poprzednim wpisie (gdy brakuje ciągłości) */
  prevOdometerEnd?: number;
  /** Wyliczane: prawda, jeśli wpis koliduje z późniejszym wpisem (do poprawy i wyłączony z liczenia) */
  odometerConflict?: boolean;
  /** Wyliczane: opis konfliktu licznika */
  conflictReason?: string;
  attachments?: Attachment[];
  documentReferences?: string; // e.g. "FV/2023/08/12, Bilet #921"
  /** kolejność w obrębie tego samego dnia (np. z importu: nr wpisu z arkusza) */
  seq?: number;
  /** skąd pochodzi wpis: ręcznie w aplikacji czy import z pliku xlsx */
  source?: 'manual' | 'import' | 'bulk';
  /** potwierdzenie wpisu mimo ostrzeżeń (np. nietypowe km) */
  verification?: { reason: string; warnings: string[]; at: string };
  createdAt?: string;
  updatedAt?: string;
}

/** Dane wpisu zapisywane w Firestore (bez pól wyliczanych) */
export type MileageEntryInput = Pick<
  MileageEntry,
  'date' | 'routeDescription' | 'purposeDescription' | 'driverName' | 'odometerEnd'
> & Partial<Pick<MileageEntry, 'documentReferences' | 'seq' | 'source' | 'verification' | 'odometerStartOverride'>>;

export interface LedgerHistoryItem {
  action: 'close' | 'open' | 'correction';
  at: string; // ISO
  by: string; // e-mail użytkownika
  reason?: string;
}

export interface MonthlyLedger {
  id?: string;
  vehicleId: string;
  monthKey: string; // format YYYY-MM np. "2023-08"
  monthName: string; // np. "sierpień"
  year: number;
  isClosed: boolean;
  closedAt?: string;
  startOdometer: number;
  endOdometer: number;
  totalDistanceKm: number;
  entriesCount: number;
  pageNumber: number;
  startDate?: string; // DD.MM.RRRR
  endDate?: string; // DD.MM.RRRR
  closedBy?: string;
  history?: LedgerHistoryItem[];
}

export interface Vehicle {
  id: string;
  registrationNumber: string; // np. "WX12345"
  brand: string;
  model: string;
  vin?: string;
  productionYear?: number;
  fuelType?: string; // Elektryczny, Benzyna, Diesel, Hybryda
  initialOdometer: number;
  currentOdometer: number;
  asoInspectionDate?: string; // DD.MM.RRRR
  asoInspectionKm?: number;
  /** termin NASTĘPNEGO badania technicznego (np. z pieczątki w dowodzie) – nadpisuje wyliczenie */
  techInspectionDate?: string; // DD.MM.RRRR
  /** data pierwszej rejestracji (pole B w dowodzie rejestracyjnym) – od niej liczymy badania */
  firstRegistrationDate?: string; // DD.MM.RRRR
  /** data ostatniego wykonanego badania technicznego */
  lastTechInspectionDate?: string; // DD.MM.RRRR
  /** ubezpieczenia osobno: OC, AC, NNW (każde opcjonalne) */
  insurance?: InsuranceSet;
  insuranceDate?: string; // DD.MM.RRRR
  insurancePolicyNumber?: string;
  insuranceProvider?: string;
  insuranceType?: string; // OC + AC + NNW + Assistance
  insurancePremium?: number; // składka roczna brutto PLN
  /** zdjęcie pojazdu (JPEG, zmniejszone do max 1200 px, data URL) */
  photoDataUrl?: string;
  color?: string;
  /** data rozpoczęcia prowadzenia ewidencji (DD.MM.RRRR) */
  registerStartDate?: string;
  /** data złożenia VAT-26 (DD.MM.RRRR) */
  vat26Date?: string;
  /** prefiks pojazdu w Home Assistant (np. „audi”) – dane (przebieg, terminy) są pobierane na żywo z HA */
  haPrefix?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CoverKind = 'oc' | 'ac' | 'nnw';

export interface InsuranceCover {
  enabled: boolean;
  provider?: string;
  policyNumber?: string;
  from?: string; // DD.MM.RRRR
  to?: string; // DD.MM.RRRR
  premium?: number; // składka PLN
  sumInsured?: number; // suma ubezpieczenia (AC / NNW)
  notes?: string;
}

export interface InsuranceVehicleData {
  brand?: string;
  model?: string;
  registrationNumber?: string;
  vin?: string;
  productionYear?: number;
  fuelType?: string;
  firstRegistrationDate?: string; // DD.MM.RRRR
}

export interface InsuranceSet {
  oc?: InsuranceCover;
  ac?: InsuranceCover;
  nnw?: InsuranceCover;
  /** dodatkowe ochrony i warunki (Assistance, szyby, udział własny, wariant…) */
  extras?: string[];
  /** plik polisy zapisany w files/{id} */
  policyFile?: Attachment;
  /** tekst polisy odczytany z PDF (do wglądu) */
  policyTextPreview?: string;
  /** dane pojazdu odczytane z polisy (do importu przy edycji pojazdu) */
  vehicleData?: InsuranceVehicleData;
  updatedAt?: string;
}

export interface Expense {
  id: string;
  vehicleId: string;
  date: string; // DD.MM.RRRR
  category: 'Paliwo / Ładowanie' | 'Serwis / ASO' | 'Ubezpieczenie' | 'Myjnia' | 'Opłaty drogowe' | 'Części i akcesoria' | 'Rata / Leasing' | 'Inne';
  grossAmount: number;
  netAmount?: number;
  vatAmount?: number;
  invoiceNumber: string;
  sellerName?: string;
  odometerReading?: number;
  notes?: string;
  attachmentName?: string;
  createdAt?: string;
}

/** Adres działalności obowiązujący od danego miesiąca */
export interface AddressPeriod {
  id: string;
  street: string; // ulica i numer, np. "ul. Kwiatowa 1"
  postalCode: string; // NN-NNN
  city: string;
  validFrom: string; // YYYY-MM – od którego miesiąca ewidencji obowiązuje
}

export interface TaxpayerProfile {
  companyName: string;
  nip: string;
  /** aktualny adres jako tekst (zgodność wstecz; wyliczany z `addresses`) */
  address: string;
  /** historia adresów – w ewidencji każdy miesiąc ma adres z tego okresu */
  addresses?: AddressPeriod[];
  defaultDriverName: string;
  phone?: string;
  email?: string;
}

export interface QuickPurpose {
  id: string;
  title: string;
  category?: string;
  usageCount: number;
}

export interface QuickRoute {
  id: string;
  route: string;
  typicalDistance?: number;
  usageCount: number;
}
