import type { Person } from '../types/person.ts';

export interface TransitionResult {
  current: Person;
  next: Person;
  overlapYears: number; // positivt = överlapp i år, negativt = glapp i år
  isGap: boolean;
  penaltyPoints: number;
  messageSv: string;
  messageEn: string;
}

export interface ChainState {
  chain: Person[];
  transitions: TransitionResult[];
  totalPenalty: number;
  isComplete: boolean;
  startPerson: Person;
  currentPerson: Person;
}

/** Beräknar överlapp/glapp och straffpoäng mellan två personer. */
export function evaluateTransition(current: Person, next: Person): TransitionResult {
  const currentDeath = current.deathDate?.year ?? new Date().getFullYear();
  const nextBirth = next.birthDate.year;
  const nextDeath = next.deathDate?.year ?? new Date().getFullYear();

  const overlap = currentDeath - nextBirth;
  const isGap = overlap < 0;

  let penalty = 0;
  let messageSv = '';
  let messageEn = '';

  if (!isGap) {
    // Godkänd länk: 1 straffpoäng per överlappsår
    penalty = overlap * 1;
    if (overlap === 0) {
      messageSv = `Perfekt stafettväxling! Föddes samma år som ${current.name.sv || current.name.en} dog. (0 straffpoäng)`;
      messageEn = `Perfect handover! Born the exact same year ${current.name.en || current.name.sv} died. (0 penalty)`;
    } else {
      messageSv = `Godkänd länk! Överlappade med ${overlap} år. (+${penalty} straffpoäng)`;
      messageEn = `Valid link! Overlapped by ${overlap} years. (+${penalty} penalty)`;
    }
  } else {
    // Glapp (trasig länk): 3 straffpoäng per år + 25 fast avgift
    const gapYears = Math.abs(overlap);
    penalty = gapYears * 3 + 25;
    messageSv = `Tidsglapp! ${next.name.sv || next.name.en} föddes ${gapYears} år efter att ${current.name.sv || current.name.en} dog. (+${penalty} straffpoäng)`;
    messageEn = `Time gap! ${next.name.en || next.name.sv} was born ${gapYears} years after ${current.name.en || current.name.sv} died. (+${penalty} penalty)`;
  }

  return {
    current,
    next,
    overlapYears: overlap,
    isGap,
    penaltyPoints: penalty,
    messageSv,
    messageEn,
  };
}

/**
 * Smart kortgenerering för 4 valkort i Tidskedjan.
 * Siktar på:
 * 1) Drömkort (litet överlapp 0–15 år)
 * 2) Säkert kort (större överlapp 16–50 år)
 * 3) Fällkort / Glapp (född 1–35 år efter dödsfall)
 * 4) Wildcard (antingen ytterligare säkert, glapp eller nutidsmål)
 */
export function draftCards(
  current: Person,
  pool: Person[],
  alreadyUsedIds: Set<string>,
  targetYear = 2025
): Person[] {
  const currentDeath = current.deathDate?.year ?? new Date().getFullYear();
  const available = pool.filter((p) => !alreadyUsedIds.has(p.id) && p.id !== current.id);

  // Om vi närmar oss nutid (t.ex. efter 1950), inkludera nu levande
  const isNearEnd = currentDeath >= 1950;

  const pickRandom = (list: Person[]): Person | null => {
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)] ?? null;
  };

  const chosen: Person[] = [];
  const chosenIds = new Set<string>();

  const add = (p: Person | null) => {
    if (p && !chosenIds.has(p.id)) {
      chosen.push(p);
      chosenIds.add(p.id);
      return true;
    }
    return false;
  };

  // Om vi är nära slutet, ge chans på levande personer
  if (isNearEnd) {
    const living = available.filter((p) => p.deathDate === null && p.birthDate.year <= currentDeath);
    add(pickRandom(living));
  }

  // 1. Drömkort: född 0–15 år före dödsfall och överlever nuvarande person
  const dream = available.filter((p) => {
    const b = p.birthDate.year;
    const d = p.deathDate?.year ?? targetYear;
    return b >= currentDeath - 15 && b <= currentDeath && d > currentDeath;
  });
  add(pickRandom(dream));

  // 2. Säkert kort: född 16–50 år före dödsfall och överlever nuvarande person
  const safe = available.filter((p) => {
    const b = p.birthDate.year;
    const d = p.deathDate?.year ?? targetYear;
    return b >= currentDeath - 50 && b < currentDeath - 15 && d > currentDeath;
  });
  add(pickRandom(safe));

  // 3. Fällkort / Glapp: född 1–35 år efter nuvarande persons död
  const gap = available.filter((p) => {
    const b = p.birthDate.year;
    return b > currentDeath && b <= currentDeath + 35;
  });
  add(pickRandom(gap));

  // 4. Wildcard: fyll upp till 4 kort med rimliga framåtriktade personer
  const forward = available.filter((p) => {
    const d = p.deathDate?.year ?? targetYear;
    return d > currentDeath && !chosenIds.has(p.id);
  });
  forward.sort(() => Math.random() - 0.5);

  for (const p of forward) {
    if (chosen.length >= 4) break;
    add(p);
  }

  // Om poolen är tom (extremfall), fyll med vad som helst tillgängligt
  if (chosen.length < 4) {
    for (const p of available) {
      if (chosen.length >= 4) break;
      add(p);
    }
  }

  // Blanda de 4 korten så att inte drömkortet alltid hamnar på samma position
  return chosen.sort(() => Math.random() - 0.5);
}

/** Väljer en bra historisk startperson (t.ex. född mellan 1350 och 1600 med känd dödsdag). */
export function pickStartPerson(pool: Person[]): Person {
  const starters = pool.filter((p) => {
    return (p.tier === 'standard' || p.tier === 'hard') &&
      p.birthDate.year >= 1350 &&
      p.birthDate.year <= 1650 &&
      p.deathDate !== null;
  });
  if (!starters.length) return pool[0]!;
  return starters[Math.floor(Math.random() * starters.length)]!;
}
