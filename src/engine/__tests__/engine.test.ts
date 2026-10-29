import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHistDate, bestDate } from '../../../pipeline/lib/dates.ts';
import { loc, type PeopleDataset, type Person } from '../../types/person.ts';
import { evaluateTransition, draftCards, pickStartPerson } from '../chain.ts';
import { classifyCategories, determineTier } from '../classification.ts';
import { findContemporaries, formatDate, getSafePlaceName } from '../clues.ts';
import { levenshtein, normalizePhonetic, searchPeopleForgiving } from '../fuzzySearch.ts';
import { compareGuess } from '../guessFeedback.ts';
import { extractPersonMaskNames, sanitizeWikipediaClue } from '../wikipedia.ts';

function makeMockPerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    name: { sv: 'Testperson', en: 'Test Person' },
    description: { sv: 'svensk författare', en: 'Swedish writer' },
    wiki: { sv: 'Testperson', en: 'Test_Person' },
    sitelinks: 50,
    tier: 'medium',
    swedish: true,
    gender: 'male',
    birthDate: { iso: '1850-01-01', year: 1850, precision: 'day', calendar: 'gregorian' },
    deathDate: { iso: '1920-01-01', year: 1920, precision: 'day', calendar: 'gregorian' },
    birthPlace: null,
    deathPlace: null,
    occupations: [],
    citizenship: [],
    causeOfDeath: [],
    mannerOfDeath: [],
    notableWorks: [],
    categories: ['literature'],
    image: null,
    ...overrides,
  };
}

describe('loc() localization helper', () => {
  it('prefers the requested language and falls back cleanly', () => {
    expect(loc({ sv: 'Sverige', en: 'Sweden' }, 'sv')).toBe('Sverige');
    expect(loc({ sv: 'Sverige', en: 'Sweden' }, 'en')).toBe('Sweden');
    expect(loc({ sv: 'Bara svenska' }, 'en')).toBe('Bara svenska');
    expect(loc({ en: 'Only English' }, 'sv')).toBe('Only English');
    expect(loc(null, 'sv', 'Fallback')).toBe('Fallback');
  });
});

describe('fuzzySearch (US-04)', () => {
  const samplePool: Person[] = [
    makeMockPerson({
      id: 'Q1043',
      name: { sv: 'Carl von Linné', en: 'Carl Linnaeus' },
      sitelinks: 180,
    }),
    makeMockPerson({
      id: 'Q52938',
      name: { sv: 'Gustav II Adolf', en: 'Gustavus Adolphus' },
      sitelinks: 120,
    }),
    makeMockPerson({
      id: 'Q6527',
      name: { sv: 'Jean-Jacques Rousseau', en: 'Jean-Jacques Rousseau' },
      sitelinks: 190,
    }),
    makeMockPerson({
      id: 'Q7327',
      name: { sv: 'Pjotr Tjajkovskij', en: 'Pyotr Ilyich Tchaikovsky' },
      sitelinks: 170,
    }),
    makeMockPerson({
      id: 'Q6512',
      name: { sv: 'Søren Kierkegaard', en: 'Søren Kierkegaard' },
      sitelinks: 150,
    }),
    makeMockPerson({
      id: 'Q41580',
      name: { sv: 'Wilhelm Röntgen', en: 'Wilhelm Röntgen' },
      sitelinks: 140,
    }),
  ];

  it('folds Nordic/European special characters before stripping non-letters', () => {
    expect(normalizePhonetic('Søren Kierkegaard')).toContain('soren');
    expect(normalizePhonetic('Wilhelm Röntgen')).toContain('rontgen');
    expect(normalizePhonetic('Stanisław Lem')).toContain('stanislav');
    expect(normalizePhonetic('Carl-Johan')).toBe('karljohan');
  });

  it('keeps ch intact so Tchaikovsky / Tjajkovskij map to the same phonetic form', () => {
    const svForm = normalizePhonetic('Tjajkovskij');
    const enForm = normalizePhonetic('Tchaikovsky');
    expect(svForm).toBe(enForm);
  });

  it('matches multi-word queries when middle particles or Roman numerals are omitted', () => {
    const linneResults = searchPeopleForgiving('Carl Linne', samplePool);
    expect(linneResults[0]?.id).toBe('Q1043');

    const gustavResults = searchPeopleForgiving('Gustav Adolf', samplePool);
    expect(gustavResults[0]?.id).toBe('Q52938');
  });

  it('matches queries without Nordic special characters (Soren Kierkegaard, Rontgen)', () => {
    expect(searchPeopleForgiving('Soren Kierkegaard', samplePool)[0]?.id).toBe('Q6512');
    expect(searchPeopleForgiving('Rontgen', samplePool)[0]?.id).toBe('Q41580');
  });

  it('computes Levenshtein distance accurately', () => {
    expect(levenshtein('katt', 'hatt')).toBe(1);
    expect(levenshtein('linne', 'linne')).toBe(0);
  });
});

describe('wikipedia sanitization (US-02)', () => {
  it('rewrites living person introductions with "är" to "Personen är..."', () => {
    const person = makeMockPerson({
      id: 'Q52927',
      name: { sv: 'Carl XVI Gustaf', en: 'Carl XVI Gustaf' },
      deathDate: null,
    });
    const raw =
      'Carl XVI Gustaf, Carl Gustaf Folke Hubertus, född 30 april 1946 på Haga slott i Solna, är Sveriges kung sedan 15 september 1973.';
    const sanitized = sanitizeWikipediaClue(raw, person, 'sv');
    expect(sanitized).toMatch(/^Personen är Sveriges kung/);
    expect(sanitized).not.toContain('Carl');
    expect(sanitized).not.toContain('1946');
  });

  it('does not split sentences prematurely on initials (S., J.P.) or abbreviations (eg., bl.a.)', () => {
    const person = makeMockPerson({
      id: 'Q123',
      name: { sv: 'Johan Petter Johansson', en: 'Johan Petter Johansson' },
    });
    const raw =
      'Johan Petter (J.P.) Johansson, född 12 december 1853 i Vårgårda, död 25 augusti 1943, var en svensk uppfinnare och industriman. Han uppfann bl.a. skiftnyckeln och rörtången.';
    const sanitized = sanitizeWikipediaClue(raw, person, 'sv');
    expect(sanitized).toMatch(/^Personen var en svensk uppfinnare/);
    expect(sanitized).toContain('skiftnyckeln');
    expect(sanitized).not.toContain('Johansson');
  });

  it('strips Wikipedia hatnotes before extracting sentences', () => {
    const person = makeMockPerson({
      id: 'Q456',
      name: { sv: 'Erik Axel Karlfeldt', en: 'Erik Axel Karlfeldt' },
    });
    const raw =
      'För andra betydelser, se Karlfeldt (olika betydelser). Erik Axel Karlfeldt, född 20 juli 1864, död 8 april 1931, var en svensk poet och ledamot av Svenska Akademien.';
    const sanitized = sanitizeWikipediaClue(raw, person, 'sv');
    expect(sanitized).toMatch(/^Personen var en svensk poet/);
    expect(sanitized).not.toContain('För andra betydelser');
    expect(sanitized).not.toContain('Karlfeldt');
  });

  it('masks genitive -s forms without corrupting Swedish stopwords like "den" or "store"', () => {
    const charlemagne = makeMockPerson({
      id: 'Q3044',
      name: { sv: 'Karl den store', en: 'Charlemagne' },
    });
    const maskNames = extractPersonMaskNames(charlemagne);
    expect(maskNames).toContain('Karl den store');
    expect(maskNames).toContain('Karl');
    expect(maskNames).not.toContain('den');
    expect(maskNames).not.toContain('store');

    const raw =
      'Karl den store, född 742, död 814, var frankernas kung och den första kejsaren. Karls rike var den store förebilden i Europa.';
    const sanitized = sanitizeWikipediaClue(raw, charlemagne, 'sv');
    expect(sanitized).toContain('den första kejsaren');
    expect(sanitized).toContain('den store förebilden');
    expect(sanitized).not.toContain('Karl');
  });

  it('sanitizes English Wikipedia summaries cleanly', () => {
    const person = makeMockPerson({
      id: 'Q7186',
      name: { sv: 'Marie Curie', en: 'Marie Curie' },
      wiki: { sv: 'Marie_Curie', en: 'Marie_Curie' },
    });
    const raw =
      'Maria Salomea Skłodowska-Curie (born 7 November 1867 – 4 July 1934), known simply as Marie Curie, was a Polish and naturalized-French physicist and chemist who conducted pioneering research on radioactivity.';
    const sanitized = sanitizeWikipediaClue(raw, person, 'en');
    expect(sanitized).toMatch(/^The person was a Polish and naturalized-French physicist/);
    expect(sanitized).not.toContain('Curie');
  });
});

describe('classification (US-03)', () => {
  it('does not false-positive match "dj" inside "tredje" or "Ateljé" or "khan" inside "Folkhögskola"', () => {
    const p1 = classifyCategories({
      occupations: [{ id: 'Q1', name: { sv: 'målare', en: 'painter' } }],
      description: { sv: 'svensk konstnär under tredje riket, verksam i sin ateljé på folkhögskola' },
    });
    expect(p1).toContain('art');
    expect(p1).not.toContain('music');
    expect(p1).not.toContain('royalty');
  });

  it('strips relative clauses ("son till en präst") from descriptions before fallback matching', () => {
    const p2 = classifyCategories({
      occupations: [],
      description: { sv: 'svensk fysiker, son till en präst och gift med en skådespelare' },
    });
    expect(p2).toEqual(['science']);
  });

  it('classifies English-only occupation labels accurately', () => {
    const p3 = classifyCategories({
      occupations: [{ id: 'Q2', name: { en: 'playwright' } }],
      description: { en: 'English dramatist' },
    });
    expect(p3).toContain('literature');
  });

  it('assigns tier based on sitelinks and Swedish connection', () => {
    expect(determineTier({ sitelinks: 150, swedish: false })).toBe('easy');
    expect(determineTier({ sitelinks: 70, swedish: true })).toBe('easy');
    expect(determineTier({ sitelinks: 90, swedish: false })).toBe('medium');
    expect(determineTier({ sitelinks: 40, swedish: true })).toBe('medium');
    expect(determineTier({ sitelinks: 25, swedish: false })).toBe('hard');
  });
});

describe('clues & chain engines', () => {
  const pA = makeMockPerson({
    id: 'QA',
    name: { sv: 'Gustav Vasa', en: 'Gustav Vasa' },
    birthDate: { iso: '1496-05-12', year: 1496, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1560-09-29', year: 1560, precision: 'day', calendar: 'julian' },
    sitelinks: 100,
  });
  const pB = makeMockPerson({
    id: 'QB',
    name: { sv: 'Erik XIV', en: 'Eric XIV' },
    birthDate: { iso: '1533-12-13', year: 1533, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1577-02-26', year: 1577, precision: 'day', calendar: 'julian' },
    sitelinks: 90,
  });
  const pC = makeMockPerson({
    id: 'QC',
    name: { sv: 'Gustav II Adolf', en: 'Gustavus Adolphus' },
    birthDate: { iso: '1594-12-09', year: 1594, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1632-11-06', year: 1632, precision: 'day', calendar: 'julian' },
    sitelinks: 120,
  });

  it('finds contemporaries with >= 15 years overlap and formats localized text', () => {
    const matchesSv = findContemporaries(pA, [pA, pB, pC], 2, 'sv');
    expect(matchesSv).toHaveLength(1);
    expect(matchesSv[0]?.person.id).toBe('QB');
    expect(matchesSv[0]?.relationship).toContain('Erik XIV');

    const matchesEn = findContemporaries(pA, [pA, pB, pC], 2, 'en');
    expect(matchesEn[0]?.relationship).toContain('Eric XIV');
  });

  it('evaluates chain transitions for overlaps and gaps accurately', () => {
    const overlapRes = evaluateTransition(pA, pB);
    expect(overlapRes.isGap).toBe(false);
    expect(overlapRes.overlapYears).toBe(27);
    expect(overlapRes.penaltyPoints).toBe(27);

    const gapRes = evaluateTransition(pB, pC);
    expect(gapRes.isGap).toBe(true);
    expect(gapRes.overlapYears).toBe(-17);
    expect(gapRes.penaltyPoints).toBe(17 * 3 + 25);
  });

  it('parses Wikidata raw dates via toHistDate & bestDate', () => {
    const hd = toHistDate({ time: '+1707-05-23T00:00:00Z', precision: 11, calendar: 'Q1985727', rank: 'preferred' });
    expect(hd).toEqual({ iso: '1707-05-23', year: 1707, precision: 'day', calendar: 'gregorian' });

    const bce = toHistDate({ time: '-0044-03-15T00:00:00Z', precision: 11, calendar: 'Q1985786', rank: 'normal' });
    expect(bce?.year).toBe(-44);
    expect(bce?.calendar).toBe('julian');
    expect(bestDate([{ time: '+1707-05-23T00:00:00Z', precision: 11, calendar: 'Q1985727', rank: 'preferred' }])).toEqual(hd);

    expect(formatDate(bce, 'sv')).toBeTruthy();
  });

  it('drafts cards and picks start person without throwing', () => {
    const starter = pickStartPerson([pA, pB, pC]);
    expect(starter).toBeDefined();
    const drafted = draftCards(pA, [pA, pB, pC], new Set(['QA']));
    expect(drafted.length).toBeGreaterThan(0);
  });
});

describe('Dataset integrity (public/data/people.json & wiki_summaries.json)', () => {
  const datasetPath = join(process.cwd(), 'public', 'data', 'people.json');
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as PeopleDataset;

  it('contains valid easy, medium, and hard tiers and non-empty categories', () => {
    expect(dataset.people.length).toBeGreaterThan(3500);
    const tiers = new Set(dataset.people.map((p) => p.tier));
    expect(tiers.has('easy')).toBe(true);
    expect(tiers.has('medium')).toBe(true);
    expect(tiers.has('hard')).toBe(true);

    for (const p of dataset.people) {
      expect((p.categories ?? []).length).toBeGreaterThan(0);
      expect(typeof p.birthDate.year).toBe('number');
    }
  });

  it('has clean city birthplaces for Richard Nixon and Matsuo Basho without their names in the label', () => {
    const nixon = dataset.people.find((p) => p.id === 'Q9588');
    expect(nixon?.birthPlace?.name.sv).toBe('Yorba Linda, Kalifornien');
    expect(nixon?.birthPlace?.name.en).toBe('Yorba Linda, California');

    const basho = dataset.people.find((p) => p.id === 'Q5676');
    expect(basho?.birthPlace?.name.sv).toBe('Iga (Ueno)');
    expect(basho?.birthPlace?.name.en).toBe('Iga (Ueno)');
  });

  it('masks toponymic place names during active guessing via getSafePlaceName and reveals them after', () => {
    const erasmus = makeMockPerson({
      id: 'Q43499',
      name: { sv: 'Erasmus av Rotterdam', en: 'Erasmus of Rotterdam' },
      birthPlace: { id: 'Q34370', name: { sv: 'Rotterdam', en: 'Rotterdam' }, coord: [51.9225, 4.4792] },
      citizenship: [{ id: 'Q55', name: { sv: 'Nederländerna', en: 'Netherlands' } }],
    });
    expect(getSafePlaceName(erasmus.birthPlace, erasmus, 'sv', false, 'Födelseort')).toBe('Ort i Nederländerna');
    expect(getSafePlaceName(erasmus.birthPlace, erasmus, 'sv', true, 'Födelseort')).toBe('Rotterdam');
  });
});

describe('compareGuess (Spårjakten wrong-guess feedback)', () => {
  const target = makeMockPerson({
    id: 'Q_NOBEL',
    name: { sv: 'Alfred Nobel', en: 'Alfred Nobel' },
    gender: 'male',
    birthDate: { iso: '1833-10-21', year: 1833, precision: 'day', calendar: 'gregorian' },
    deathDate: { iso: '1896-12-10', year: 1896, precision: 'day', calendar: 'gregorian' },
    birthPlace: { id: 'Q1754', name: { sv: 'Stockholm', en: 'Stockholm' }, coord: [59.3293, 18.0686] },
    deathPlace: { id: 'Q34156', name: { sv: 'Sanremo', en: 'Sanremo' }, coord: [43.816, 7.776] },
    categories: ['science'],
    occupations: [{ id: 'Q593644', name: { sv: 'kemist', en: 'chemist' } }],
    citizenship: [{ id: 'Q34', name: { sv: 'Sverige', en: 'Sweden' } }],
  });

  it('returns positive trait echoes and gender when a guess is a near-miss', () => {
    const nearMiss = makeMockPerson({
      id: 'Q_BERZELIUS',
      name: { sv: 'Jöns Jacob Berzelius', en: 'Jöns Jacob Berzelius' },
      gender: 'male',
      birthDate: { iso: '1779-08-20', year: 1779, precision: 'day', calendar: 'gregorian' },
      deathDate: { iso: '1848-08-07', year: 1848, precision: 'day', calendar: 'gregorian' },
      birthPlace: { id: 'Q10713334', name: { sv: 'Väversunda', en: 'Väversunda' }, coord: [58.348, 14.71] },
      deathPlace: { id: 'Q1754', name: { sv: 'Stockholm', en: 'Stockholm' }, coord: [59.3293, 18.0686] },
      categories: ['science'],
      occupations: [{ id: 'Q593644', name: { sv: 'kemist', en: 'chemist' } }],
      citizenship: [{ id: 'Q34', name: { sv: 'Sverige', en: 'Sweden' } }],
    });

    const fb = compareGuess(nearMiss, target, 'sv');
    expect(fb.isContemporary).toBe(true);
    expect(fb.overlapYears).toBe(15);
    expect(fb.sharedCategories).toEqual(['science']);
    expect(fb.sharedOccupations).toEqual(['kemist']);
    expect(fb.sharedCitizenships).toEqual(['Sverige']);
    expect(fb.matchedGenderLabel).toBe('Man ♂');
    expect(fb.positiveBadges.some((b) => b.kind === 'occupation')).toBe(true);
    expect(fb.positiveBadges.some((b) => b.kind === 'category')).toBe(true);
    expect(fb.positiveBadges.some((b) => b.kind === 'gender')).toBe(true);
  });

  it('does NOT leak binary gender on a blind miss with no era/trait/geographic proximity', () => {
    const blindMiss = makeMockPerson({
      id: 'Q_CAESAR',
      name: { sv: 'Julius Caesar', en: 'Julius Caesar' },
      swedish: false,
      gender: 'male',
      birthDate: { iso: '-0100-07-12', year: -100, precision: 'day', calendar: 'julian' },
      deathDate: { iso: '-0044-03-15', year: -44, precision: 'day', calendar: 'julian' },
      birthPlace: { id: 'Q220', name: { sv: 'Rom', en: 'Rome' }, coord: [41.9028, 12.4964] },
      deathPlace: { id: 'Q220', name: { sv: 'Rom', en: 'Rome' }, coord: [41.9028, 12.4964] },
      categories: ['politics'],
      occupations: [{ id: 'Q82955', name: { sv: 'politiker', en: 'politician' } }],
      citizenship: [{ id: 'Q1747689', name: { sv: 'Romerska republiken', en: 'Roman Republic' } }],
    });

    const fb = compareGuess(blindMiss, target, 'sv');
    expect(fb.isContemporary).toBe(false);
    expect(fb.matchedGenderLabel).toBeNull();
    expect(fb.positiveBadges).toHaveLength(0);
  });
});

import {
  saveGeoSession,
  loadGeoSession,
  clearGeoSession,
  saveAppState,
  loadAppState,
} from '../sessionPersistence.ts';

describe('sessionPersistence', () => {
  it('saves and restores GeoGuesser session state accurately', () => {
    clearGeoSession();
    expect(loadGeoSession()).toBeNull();

    saveGeoSession({
      selectedTier: 'medium',
      selectedCentury: '1800',
      onlySwedish: true,
      requireBothCoords: false,
      showGhostPins: true,
      currentPersonId: 'Q1043',
      purchasedClues: ['occupation', 'wikiSummary'],
      expandedClues: ['occupation', 'profile'],
      isSolved: false,
      isSurrendered: false,
      earnedRoundScore: null,
      deductionsAtEnd: null,
      wrongGuessIds: ['Q52938'],
      isMatchActive: true,
      matchRoundIds: ['Q1043', 'Q52938', 'Q615', 'Q11571', 'Q76'],
      currentRoundIndex: 2,
      matchResults: [
        {
          personId: 'Q1043',
          score: 850,
          isSolved: true,
          cluesUsed: ['occupation'],
          wrongGuessesCount: 1,
        },
      ],
      isMatchSummaryOpen: false,
      matchCentury: 'all',
      matchTier: 'easy',
      matchOnlySwedish: false,
    });

    const restored = loadGeoSession();
    expect(restored).not.toBeNull();
    expect(restored?.currentPersonId).toBe('Q1043');
    expect(restored?.selectedTier).toBe('medium');
    expect(restored?.selectedCentury).toBe('1800');
    expect(restored?.onlySwedish).toBe(true);
    expect(restored?.purchasedClues).toEqual(['occupation', 'wikiSummary']);
    expect(restored?.wrongGuessIds).toEqual(['Q52938']);
    expect(restored?.isMatchActive).toBe(true);
    expect(restored?.currentRoundIndex).toBe(2);
    expect(restored?.matchResults).toHaveLength(1);
    expect(restored?.matchResults[0]?.score).toBe(850);

    clearGeoSession();
    expect(loadGeoSession()).toBeNull();
  });

  it('persists and restores app state (viewMode and lang)', () => {
    saveAppState({ lang: 'en', viewMode: 'timeline' });
    const appState = loadAppState();
    expect(appState.lang).toBe('en');
    expect(appState.viewMode).toBe('timeline');

    saveAppState({ lang: 'sv', viewMode: 'geoguesser' });
    const appState2 = loadAppState();
    expect(appState2.lang).toBe('sv');
    expect(appState2.viewMode).toBe('geoguesser');
  });
});

import {
  clearProfileStorage,
  loadProfileState,
  getActiveProfile,
  createProfile,
  updateActiveProfile,
  switchProfile,
  deleteProfile,
  recordRoundInState,
  recordMatchInState,
  exportProfileData,
  importProfileData,
} from '../profileStore.ts';

describe('profileStore (Phase 1 player profile, scores & collection)', () => {
  it('creates default profile, records rounds/streaks/collection, and records 5-round matches', () => {
    clearProfileStorage();
    let state = loadProfileState();
    expect(state.profiles).toHaveLength(1);
    let active = getActiveProfile(state);
    expect(active.name).toBe('Spelare 1');
    expect(active.solvedPersonIds).toEqual([]);

    // Solve round 1
    state = recordRoundInState(state, {
      personId: 'Q1043',
      personName: 'Carl von Linné',
      tier: 'easy',
      score: 925,
      isSolved: true,
      cluesUsedCount: 1,
      wrongGuessesCount: 0,
    });
    active = getActiveProfile(state);
    expect(active.roundsPlayed).toBe(1);
    expect(active.roundsSolved).toBe(1);
    expect(active.currentStreak).toBe(1);
    expect(active.bestStreak).toBe(1);
    expect(active.totalRoundPoints).toBe(925);
    expect(active.solvedPersonIds).toEqual(['Q1043']);

    // Surrender round 2 -> streak resets, solvedPersonIds unchanged
    state = recordRoundInState(state, {
      personId: 'Q762',
      personName: 'Leonardo da Vinci',
      tier: 'easy',
      score: 0,
      isSolved: false,
      cluesUsedCount: 3,
      wrongGuessesCount: 2,
    });
    active = getActiveProfile(state);
    expect(active.roundsPlayed).toBe(2);
    expect(active.roundsSolved).toBe(1);
    expect(active.currentStreak).toBe(0);
    expect(active.bestStreak).toBe(1);
    expect(active.solvedPersonIds).toEqual(['Q1043']);

    // Record a 5-round match
    state = recordMatchInState(state, {
      totalScore: 4200,
      solvedCount: 4,
      tierFilter: 'easy',
      centuryFilter: 'all',
      swedishOnly: false,
      rounds: [
        { personId: 'Q1043', personName: 'Carl von Linné', score: 925, isSolved: true },
        { personId: 'Q762', personName: 'Leonardo da Vinci', score: 0, isSolved: false },
      ],
    });
    active = getActiveProfile(state);
    expect(active.matchHistory).toHaveLength(1);
    expect(active.matchHistory[0]?.totalScore).toBe(4200);
  });

  it('supports multiple profiles, editing, and JSON export/import', () => {
    clearProfileStorage();
    let state = loadProfileState();
    const firstId = state.activeProfileId;

    state = updateActiveProfile(state, { name: 'Historikern', avatar: '👑' });
    expect(getActiveProfile(state).name).toBe('Historikern');
    expect(getActiveProfile(state).avatar).toBe('👑');

    state = createProfile(state, 'Gäst', '🔭');
    expect(state.profiles).toHaveLength(2);
    expect(getActiveProfile(state).name).toBe('Gäst');

    // Switch back to first profile and export
    state = switchProfile(state, firstId);
    state = recordRoundInState(state, {
      personId: 'Q52938',
      personName: 'August Strindberg',
      tier: 'easy',
      score: 1000,
      isSolved: true,
      cluesUsedCount: 0,
      wrongGuessesCount: 0,
    });

    const exportedJson = exportProfileData(getActiveProfile(state));
    expect(exportedJson).toContain('Historikern');
    expect(exportedJson).toContain('Q52938');

    // Delete second profile
    const guestId = state.profiles.find((p) => p.id !== firstId)!.id;
    state = deleteProfile(state, guestId);
    expect(state.profiles).toHaveLength(1);

    // Import into clean state
    clearProfileStorage();
    const freshState = loadProfileState();
    const importedState = importProfileData(freshState, exportedJson);
    expect(importedState).not.toBeNull();
    expect(getActiveProfile(importedState!).name).toBe('Historikern');
    expect(getActiveProfile(importedState!).solvedPersonIds).toContain('Q52938');
  });
});



