/**
 * Lokalt profil-, poäng- och samlingssystem (Fas 1).
 *
 * Designat med en ren datamodell (PlayerProfile, SavedRoundRecord, SavedMatchRecord)
 * så att samma struktur enkelt kan synkas mot en molndatabas (t.ex. Supabase) i Fas 2.
 */

import type { Tier } from '../types/person.ts';

export const AVATAR_OPTIONS = ['🧭', '👑', '🏛️', '⚔️', '📜', '🔭', '🎭', '🏆', '🦅', '⚓'] as const;

export interface SavedRoundRecord {
  id: string;
  date: string;
  personId: string;
  personName: string;
  tier: Tier;
  score: number;
  isSolved: boolean;
  cluesUsedCount: number;
  wrongGuessesCount: number;
}

export interface SavedMatchRecord {
  id: string;
  date: string;
  totalScore: number;
  solvedCount: number;
  tierFilter: string;
  centuryFilter: string;
  swedishOnly: boolean;
  rounds: {
    personId: string;
    personName: string;
    score: number;
    isSolved: boolean;
  }[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string;
  createdAt: string;
  /** Unika Q-ID:n som spelaren har klarat (Historisk samling / "Pokédex") */
  solvedPersonIds: string[];
  currentStreak: number;
  bestStreak: number;
  roundsPlayed: number;
  roundsSolved: number;
  totalRoundPoints: number;
  roundHistory: SavedRoundRecord[];
  matchHistory: SavedMatchRecord[];
}

export interface ProfileState {
  version: 1;
  activeProfileId: string;
  profiles: PlayerProfile[];
}

const PROFILE_STORAGE_KEY = 'livslinjen_profiles_v1';
const MAX_ROUND_HISTORY = 100;
const MAX_MATCH_HISTORY = 50;

const memoryFallback = new Map<string, string>();

function getStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const testKey = '__profile_test__';
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {}
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryFallback.set(k, v);
    },
    removeItem: (k: string) => {
      memoryFallback.delete(k);
    },
  };
}

function generateId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyProfile(name = ' Äventyrare', avatar = '🧭'): PlayerProfile {
  return {
    id: generateId('prof'),
    name: name.trim() || 'Äventyrare',
    avatar,
    createdAt: new Date().toISOString(),
    solvedPersonIds: [],
    currentStreak: 0,
    bestStreak: 0,
    roundsPlayed: 0,
    roundsSolved: 0,
    totalRoundPoints: 0,
    roundHistory: [],
    matchHistory: [],
  };
}

export function loadProfileState(): ProfileState {
  try {
    const raw = getStorage().getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        const hasActive = parsed.profiles.some((p) => p.id === parsed.activeProfileId);
        return {
          ...parsed,
          activeProfileId: hasActive ? parsed.activeProfileId : parsed.profiles[0]!.id,
        };
      }
    }
  } catch {}

  const defaultProfile = createEmptyProfile('Spelare 1', '🧭');
  const initial: ProfileState = {
    version: 1,
    activeProfileId: defaultProfile.id,
    profiles: [defaultProfile],
  };
  saveProfileState(initial);
  return initial;
}

export function saveProfileState(state: ProfileState): void {
  try {
    getStorage().setItem(PROFILE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function clearProfileStorage(): void {
  try {
    getStorage().removeItem(PROFILE_STORAGE_KEY);
  } catch {}
}

export function getActiveProfile(state: ProfileState): PlayerProfile {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0]!;
}

export function createProfile(state: ProfileState, name: string, avatar = '🧭'): ProfileState {
  const newProf = createEmptyProfile(name, avatar);
  const next: ProfileState = {
    ...state,
    activeProfileId: newProf.id,
    profiles: [...state.profiles, newProf],
  };
  saveProfileState(next);
  return next;
}

export function updateActiveProfile(
  state: ProfileState,
  updates: { name?: string; avatar?: string }
): ProfileState {
  const next: ProfileState = {
    ...state,
    profiles: state.profiles.map((p) => {
      if (p.id !== state.activeProfileId) return p;
      return {
        ...p,
        name: updates.name !== undefined ? updates.name.trim() || p.name : p.name,
        avatar: updates.avatar ?? p.avatar,
      };
    }),
  };
  saveProfileState(next);
  return next;
}

export function switchProfile(state: ProfileState, profileId: string): ProfileState {
  if (!state.profiles.some((p) => p.id === profileId)) return state;
  const next: ProfileState = {
    ...state,
    activeProfileId: profileId,
  };
  saveProfileState(next);
  return next;
}

export function deleteProfile(state: ProfileState, profileId: string): ProfileState {
  if (state.profiles.length <= 1) return state;
  const remaining = state.profiles.filter((p) => p.id !== profileId);
  if (remaining.length === 0) return state;
  const nextActive =
    state.activeProfileId === profileId ? remaining[0]!.id : state.activeProfileId;
  const next: ProfileState = {
    ...state,
    activeProfileId: nextActive,
    profiles: remaining,
  };
  saveProfileState(next);
  return next;
}

export function recordRoundInState(
  state: ProfileState,
  round: Omit<SavedRoundRecord, 'id' | 'date'>
): ProfileState {
  const record: SavedRoundRecord = {
    ...round,
    id: generateId('rnd'),
    date: new Date().toISOString(),
  };

  const next: ProfileState = {
    ...state,
    profiles: state.profiles.map((p) => {
      if (p.id !== state.activeProfileId) return p;

      const solvedSet = new Set(p.solvedPersonIds);
      if (round.isSolved) {
        solvedSet.add(round.personId);
      }

      const newStreak = round.isSolved ? p.currentStreak + 1 : 0;
      const newBestStreak = Math.max(p.bestStreak, newStreak);

      return {
        ...p,
        solvedPersonIds: Array.from(solvedSet),
        currentStreak: newStreak,
        bestStreak: newBestStreak,
        roundsPlayed: p.roundsPlayed + 1,
        roundsSolved: p.roundsSolved + (round.isSolved ? 1 : 0),
        totalRoundPoints: p.totalRoundPoints + round.score,
        roundHistory: [record, ...p.roundHistory].slice(0, MAX_ROUND_HISTORY),
      };
    }),
  };

  saveProfileState(next);
  return next;
}

export function recordMatchInState(
  state: ProfileState,
  match: Omit<SavedMatchRecord, 'id' | 'date'>
): ProfileState {
  const record: SavedMatchRecord = {
    ...match,
    id: generateId('mtc'),
    date: new Date().toISOString(),
  };

  const next: ProfileState = {
    ...state,
    profiles: state.profiles.map((p) => {
      if (p.id !== state.activeProfileId) return p;
      return {
        ...p,
        matchHistory: [record, ...p.matchHistory].slice(0, MAX_MATCH_HISTORY),
      };
    }),
  };

  saveProfileState(next);
  return next;
}

export function exportProfileData(profile: PlayerProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfileData(state: ProfileState, jsonStr: string): ProfileState | null {
  try {
    const parsed = JSON.parse(jsonStr) as Partial<PlayerProfile>;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.solvedPersonIds)) {
      return null;
    }

    const imported: PlayerProfile = {
      id: typeof parsed.id === 'string' ? parsed.id : generateId('prof'),
      name: parsed.name.trim() || 'Importerad profil',
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '🧭',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      solvedPersonIds: parsed.solvedPersonIds.filter((id): id is string => typeof id === 'string'),
      currentStreak: typeof parsed.currentStreak === 'number' ? parsed.currentStreak : 0,
      bestStreak: typeof parsed.bestStreak === 'number' ? parsed.bestStreak : 0,
      roundsPlayed: typeof parsed.roundsPlayed === 'number' ? parsed.roundsPlayed : 0,
      roundsSolved: typeof parsed.roundsSolved === 'number' ? parsed.roundsSolved : 0,
      totalRoundPoints: typeof parsed.totalRoundPoints === 'number' ? parsed.totalRoundPoints : 0,
      roundHistory: Array.isArray(parsed.roundHistory) ? parsed.roundHistory.slice(0, MAX_ROUND_HISTORY) : [],
      matchHistory: Array.isArray(parsed.matchHistory) ? parsed.matchHistory.slice(0, MAX_MATCH_HISTORY) : [],
    };

    const existingIdx = state.profiles.findIndex((p) => p.id === imported.id);
    let nextProfiles: PlayerProfile[];
    if (existingIdx >= 0) {
      // Merge solvedPersonIds if importing same profile ID
      const existing = state.profiles[existingIdx]!;
      const mergedSolved = Array.from(new Set([...existing.solvedPersonIds, ...imported.solvedPersonIds]));
      nextProfiles = state.profiles.map((p, idx) =>
        idx === existingIdx
          ? {
              ...imported,
              solvedPersonIds: mergedSolved,
              bestStreak: Math.max(existing.bestStreak, imported.bestStreak),
            }
          : p
      );
    } else {
      nextProfiles = [...state.profiles, imported];
    }

    const next: ProfileState = {
      ...state,
      activeProfileId: imported.id,
      profiles: nextProfiles,
    };
    saveProfileState(next);
    return next;
  } catch {
    return null;
  }
}
