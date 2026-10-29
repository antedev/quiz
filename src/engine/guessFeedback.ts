import { loc, QUIZ_CATEGORIES, type Lang, type Person, type QuizCategory } from '../types/person.ts';

export interface GuessBadge {
  icon: string;
  label: string;
  kind: 'place' | 'occupation' | 'category' | 'country' | 'gender' | 'year';
}

export interface GuessFeedback {
  guessed: Person;
  name: string;
  lifespanText: string;
  eraText: string;
  isContemporary: boolean;
  overlapYears: number;
  birthYearDelta: number;
  birthDistanceKm: number | null;
  sameBirthPlace: boolean;
  sameDeathPlace: boolean;
  sharedCategories: QuizCategory[];
  sharedOccupations: string[];
  sharedCitizenships: string[];
  sameGender: boolean;
  matchedGenderLabel: string | null;
  positiveBadges: GuessBadge[];
}

export function haversineKm(coord1: [number, number], coord2: [number, number]): number {
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Jämför en felaktig gissning mot målpersonen enligt principen "Positive Echoes Only":
 * - Visar alltid gissningens levnadsår, avstånd/epok-skillnad och om de var samtida ("tidskompisar").
 * - Lyfter bara fram positiva egenskaps-träffar (delat yrke, delad kategori, samma land, samma ort, samt kön vid nära gissning)
 *   så att en blind gissning inte avslöjar målpersonens hemliga attribut gratis.
 */
export function compareGuess(guessed: Person, target: Person, lang: Lang = 'sv'): GuessFeedback {
  const isSv = lang === 'sv';
  const currentYear = new Date().getFullYear();

  const name = loc(guessed.name, lang, isSv ? 'Okänd' : 'Unknown');
  const gBirth = guessed.birthDate.year;
  const gDeath = guessed.deathDate?.year ?? currentYear;
  const tBirth = target.birthDate.year;
  const tDeath = target.deathDate?.year ?? currentYear;

  const formatYear = (y: number) => (y < 0 ? `${Math.abs(y)} ${isSv ? 'f.Kr.' : 'BC'}` : `${y}`);
  const lifespanText = `${formatYear(gBirth)}–${guessed.deathDate ? formatYear(gDeath) : isSv ? 'nu' : 'now'}`;

  const overlapStart = Math.max(gBirth, tBirth);
  const overlapEnd = Math.min(gDeath, tDeath);
  const overlapYears = overlapEnd - overlapStart;
  const isContemporary = overlapYears >= 10;
  const birthYearDelta = gBirth - tBirth;

  let eraText = '';
  if (isContemporary) {
    eraText = isSv
      ? `🤝 Samtida (${overlapYears} års överlapp)`
      : `🤝 Contemporary (${overlapYears} yrs overlap)`;
  } else if (birthYearDelta < 0) {
    eraText = isSv
      ? `⏳ Född ${Math.abs(birthYearDelta)} år tidigare`
      : `⏳ Born ${Math.abs(birthYearDelta)} yrs earlier`;
  } else if (birthYearDelta > 0) {
    eraText = isSv
      ? `⏳ Född ${birthYearDelta} år senare`
      : `⏳ Born ${birthYearDelta} yrs later`;
  } else {
    eraText = isSv ? '🎂 Samma födelseår!' : '🎂 Same birth year!';
  }

  // Geografisk jämförelse
  const gBirthCoord = guessed.birthPlace?.coord;
  const tBirthCoord = target.birthPlace?.coord;
  const birthDistanceKm = gBirthCoord && tBirthCoord ? haversineKm(gBirthCoord, tBirthCoord) : null;

  const sameBirthPlace = Boolean(
    (guessed.birthPlace?.id && guessed.birthPlace.id === target.birthPlace?.id) ||
      (birthDistanceKm !== null && birthDistanceKm < 15)
  );

  const gDeathCoord = guessed.deathPlace?.coord;
  const tDeathCoord = target.deathPlace?.coord;
  const deathDistanceKm = gDeathCoord && tDeathCoord ? haversineKm(gDeathCoord, tDeathCoord) : null;

  const sameDeathPlace = Boolean(
    (guessed.deathPlace?.id && guessed.deathPlace.id === target.deathPlace?.id) ||
      (deathDistanceKm !== null && deathDistanceKm < 15)
  );

  // Delade kategorier
  const gCats = guessed.categories ?? [];
  const tCats = new Set(target.categories ?? []);
  const sharedCategories = gCats.filter((c) => c !== 'other' && tCats.has(c));

  // Delade yrken
  const tOccIds = new Set(target.occupations.map((o) => o.id));
  const tOccNames = new Set(
    target.occupations.map((o) => loc(o.name, lang).toLowerCase()).filter(Boolean)
  );
  const sharedOccupations = [
    ...new Set(
      guessed.occupations
        .filter((o) => {
          const label = loc(o.name, lang).toLowerCase();
          return tOccIds.has(o.id) || (label && tOccNames.has(label));
        })
        .map((o) => loc(o.name, lang))
        .filter(Boolean)
    ),
  ];

  // Delade medborgarskap / länder
  const tCitIds = new Set(target.citizenship.map((c) => c.id));
  const sharedCitizenships = [
    ...new Set(
      guessed.citizenship
        .filter((c) => tCitIds.has(c.id))
        .map((c) => loc(c.name, lang))
        .filter(Boolean)
    ),
  ];
  if (sharedCitizenships.length === 0 && guessed.swedish && target.swedish) {
    sharedCitizenships.push(isSv ? 'Sverige' : 'Sweden');
  }

  // Kön: visas bara som positiv bekräftelse om det matchar OCH gissningen redan har minst en annan koppling (nära gissning)
  const sameGender = Boolean(guessed.gender && target.gender && guessed.gender === target.gender);
  const hasNearMissContext =
    isContemporary ||
    sharedCategories.length > 0 ||
    sharedOccupations.length > 0 ||
    sharedCitizenships.length > 0 ||
    sameBirthPlace ||
    sameDeathPlace;

  let matchedGenderLabel: string | null = null;
  if (sameGender && hasNearMissContext) {
    matchedGenderLabel =
      target.gender === 'female'
        ? isSv
          ? 'Kvinna ♀'
          : 'Female ♀'
        : target.gender === 'male'
        ? isSv
          ? 'Man ♂'
          : 'Male ♂'
        : isSv
        ? 'Icke-binär'
        : 'Non-binary';
  }

  const positiveBadges: GuessBadge[] = [];

  if (sameBirthPlace) {
    const placeName = loc(target.birthPlace?.name, lang, isSv ? 'Samma födelseort' : 'Same birthplace');
    positiveBadges.push({
      icon: '📍',
      label: isSv ? `Född i ${placeName}` : `Born in ${placeName}`,
      kind: 'place',
    });
  }

  if (sameDeathPlace) {
    const placeName = loc(target.deathPlace?.name, lang, isSv ? 'Samma dödsort' : 'Same deathplace');
    positiveBadges.push({
      icon: '🪦',
      label: isSv ? `Dog i ${placeName}` : `Died in ${placeName}`,
      kind: 'place',
    });
  }

  for (const occ of sharedOccupations.slice(0, 2)) {
    positiveBadges.push({
      icon: '🎯',
      label: occ.charAt(0).toUpperCase() + occ.slice(1),
      kind: 'occupation',
    });
  }

  for (const cat of sharedCategories.slice(0, 2)) {
    const info = QUIZ_CATEGORIES[cat] || QUIZ_CATEGORIES.other;
    positiveBadges.push({
      icon: info.icon,
      label: info[lang] || info.sv,
      kind: 'category',
    });
  }

  for (const cit of sharedCitizenships.slice(0, 2)) {
    positiveBadges.push({
      icon: '🌍',
      label: cit,
      kind: 'country',
    });
  }

  if (matchedGenderLabel) {
    positiveBadges.push({
      icon: '✅',
      label: matchedGenderLabel,
      kind: 'gender',
    });
  }

  if (birthYearDelta === 0) {
    positiveBadges.push({
      icon: '🎂',
      label: `${tBirth}`,
      kind: 'year',
    });
  }

  return {
    guessed,
    name,
    lifespanText,
    eraText,
    isContemporary,
    overlapYears,
    birthYearDelta,
    birthDistanceKm,
    sameBirthPlace,
    sameDeathPlace,
    sharedCategories,
    sharedOccupations,
    sharedCitizenships,
    sameGender,
    matchedGenderLabel,
    positiveBadges,
  };
}
