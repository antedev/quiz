/**
 * Persistent spelsession.
 *
 * Mobila webbläsare kastar ofta bakgrundsflikar (skärmen släcks, appbyte) och laddar om sidan när
 * man kommer tillbaka. Utvecklingsservern (Vite) gör dessutom en full omladdning när dess websocket
 * återansluter efter att telefonen sovit. Allt spelläge som bara ligger i React-minnet går då förlorat.
 *
 * Här sparas en kompakt ögonblicksbild (endast ID:n, inga hela Person-objekt) i localStorage vid
 * varje förändring, och den läses in synkront vid montering. localStorage (inte sessionStorage)
 * används eftersom den överlever både fliknedstängning av OS:et och omstart från hemskärmen.
 */

const SESSION_KEY = 'livslinjen_session_v1';
const APP_STATE_KEY = 'livslinjen_app_state_v1';
/** Sessioner äldre än så här återställs inte (undviker att väcka en uråldrig runda). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PersistedMatchResult {
  personId: string;
  score: number;
  isSolved: boolean;
  cluesUsed: string[];
  wrongGuessesCount: number;
}

export interface PersistedGeoSession {
  version: 1;
  savedAt: number;
  // Filter (bakåtkompatibla + nya flervalsfält)
  selectedTier?: string;
  selectedTiers?: string[];
  selectedCentury?: string;
  selectedCenturies?: string[];
  lifeStatus?: string;
  lifeStatuses?: string[];
  onlySwedish?: boolean;
  selectedCountries?: string[];
  countryMatchMode?: string;
  requireBothCoords: boolean;
  showGhostPins: boolean;
  // Aktuell rond
  currentPersonId: string;
  purchasedClues: string[];
  expandedClues: string[];
  isSolved: boolean;
  isSurrendered: boolean;
  earnedRoundScore: number | null;
  deductionsAtEnd: { cluesCost: number; wrongCost: number } | null;
  wrongGuessIds: string[];
  // Match (5 ronder)
  isMatchActive: boolean;
  matchRoundIds: string[];
  currentRoundIndex: number;
  matchResults: PersistedMatchResult[];
  isMatchSummaryOpen: boolean;
  matchCentury?: string;
  matchCenturies?: string[];
  matchTier?: string;
  matchTiers?: string[];
  matchLifeStatus?: string;
  matchLifeStatuses?: string[];
  matchOnlySwedish?: boolean;
  matchCountries?: string[];
  matchCountryMatchMode?: string;
}

export interface PersistedAppState {
  lang: 'sv' | 'en';
  viewMode: 'geoguesser' | 'timeline' | 'cards';
}

// In-memory fallback if localStorage is unavailable (e.g. unit test runner, private browsing restrictions, SSR)
const memoryStore = new Map<string, string>();

function getStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Test if localStorage is actually usable (can throw in restrictive private browsing modes)
      const testKey = '__storage_test__';
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {}
  return {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => { memoryStore.set(k, v); },
    removeItem: (k: string) => { memoryStore.delete(k); },
  };
}

function safeRead<T>(key: string): T | null {
  try {
    const raw = getStorage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    getStorage().setItem(key, JSON.stringify(value));
  } catch {
    // Kvot full eller privat läge – spelet fungerar ändå, bara utan persistens.
  }
}

export function loadGeoSession(): PersistedGeoSession | null {
  const s = safeRead<PersistedGeoSession>(SESSION_KEY);
  if (!s || s.version !== 1 || typeof s.currentPersonId !== 'string') return null;
  if (typeof s.savedAt !== 'number' || Date.now() - s.savedAt > MAX_AGE_MS) return null;
  return s;
}

export function saveGeoSession(session: Omit<PersistedGeoSession, 'version' | 'savedAt'>): void {
  safeWrite(SESSION_KEY, { ...session, version: 1, savedAt: Date.now() });
}

export function clearGeoSession(): void {
  try {
    getStorage().removeItem(SESSION_KEY);
  } catch {}
}

export function loadAppState(): Partial<PersistedAppState> {
  const s = safeRead<Partial<PersistedAppState>>(APP_STATE_KEY) ?? {};
  const out: Partial<PersistedAppState> = {};
  if (s.lang === 'sv' || s.lang === 'en') out.lang = s.lang;
  if (s.viewMode === 'geoguesser' || s.viewMode === 'timeline' || s.viewMode === 'cards') out.viewMode = s.viewMode;
  return out;
}

export function saveAppState(state: PersistedAppState): void {
  safeWrite(APP_STATE_KEY, state);
}
