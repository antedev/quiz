/**
 * Hanterar sparade resultat, highscores och historik i webbläsarens LocalStorage.
 */

export interface Mode1Record {
  date: string;
  targetId: string;
  targetName: string;
  won: boolean;
  score: number; // 2, 4, 6, 8, 10 (eller 0 vid förlust)
  guessesCount: number;
}

export interface Mode2Record {
  date: string;
  startPersonId: string;
  startPersonName: string;
  endPersonId: string;
  endPersonName: string;
  chainLength: number;
  totalPenalty: number; // lägst vinner (golf score)
  gapsCount: number;
  perfectLinksCount: number;
}

const STORAGE_KEYS = {
  mode1History: 'livslinjen_mode1_history',
  mode2History: 'livslinjen_mode2_history',
  settings: 'livslinjen_settings',
} as const;

export interface UserSettings {
  lang: 'sv' | 'en';
  soundEnabled: boolean;
  theme: 'light' | 'dark' | 'sepia';
}

const DEFAULT_SETTINGS: UserSettings = {
  lang: 'sv',
  soundEnabled: true,
  theme: 'sepia', // historisk / pergament-känsla
};

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch {}
}

export function saveMode1Game(record: Mode1Record): void {
  try {
    const history = loadMode1History();
    history.unshift(record);
    localStorage.setItem(STORAGE_KEYS.mode1History, JSON.stringify(history.slice(0, 100)));
  } catch {}
}

export function loadMode1History(): Mode1Record[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.mode1History);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMode2Game(record: Mode2Record): void {
  try {
    const history = loadMode2History();
    history.unshift(record);
    localStorage.setItem(STORAGE_KEYS.mode2History, JSON.stringify(history.slice(0, 100)));
  } catch {}
}

export function loadMode2History(): Mode2Record[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.mode2History);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
