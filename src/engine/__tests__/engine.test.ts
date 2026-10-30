import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHistDate, bestDate } from '../../../pipeline/lib/dates.ts';
import { loc, type PeopleDataset, type Person } from '../../types/person.ts';
import { evaluateTransition, draftCards, pickStartPerson } from '../chain.ts';
import { classifyCategories, computeKandisScore, determineTier, LOCALE_PRESETS } from '../classification.ts';
import { computeSpikeResistantViews } from '../../../pipeline/03b-pageviews.ts';
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
    tier: 'hard',
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
    expect(determineTier({ sitelinks: 150, swedish: false })).toBe('standard');
    expect(determineTier({ sitelinks: 70, swedish: true })).toBe('standard');
    expect(determineTier({ sitelinks: 90, swedish: false })).toBe('hard');
    expect(determineTier({ sitelinks: 40, swedish: true })).toBe('hard');
    expect(determineTier({ sitelinks: 25, swedish: false })).toBe('very_hard');
  });

  it('computes spike-resistant 30-day pageviews by trimming short news spikes while preserving low-traffic resolution', () => {
    // 26 steady days of 10 views + 4 news-spike days of 5000 views -> trimmed to 10/day * 30 = 300
    const dailyWithSpike: Record<string, number> = {};
    for (let i = 1; i <= 26; i++) dailyWithSpike[`2026-09-${String(i).padStart(2, '0')}`] = 10;
    for (let i = 27; i <= 30; i++) dailyWithSpike[`2026-09-${i}`] = 5000;
    expect(computeSpikeResistantViews(dailyWithSpike)).toBe(300);

    // Low-traffic article (mostly 0s and 1s) retains non-zero resolution
    const lowTraffic: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) lowTraffic[`2026-09-${String(i).padStart(2, '0')}`] = 0;
    for (let i = 21; i <= 30; i++) lowTraffic[`2026-09-${i}`] = 1;
    expect(computeSpikeResistantViews(lowTraffic)).toBeGreaterThan(0);
  });

  it('generalizes difficulty across languages and shared-language countries (SE, US, GB, AU, DE) without a 2.2x hack', () => {
    // 1. High-sitelink global stub with tiny local readership (e.g. Guillermo Lasso: 161 sitelinks, 8 sv views) -> very_hard in SE
    const globalStub = {
      sitelinks: 161,
      swedish: false,
      birthDate: { year: 1955 },
      deathDate: null,
      pageviews: { sv: 8, en: 2368 },
    };
    expect(determineTier(globalStub, LOCALE_PRESETS.SE)).toBe('very_hard');

    // 2. Famous Swedish figure with moderate sitelinks but high sv.wikipedia readership (e.g. Gustav III: 61 sitelinks, 5864 sv views)
    const gustavIII = {
      sitelinks: 61,
      swedish: true,
      citizenship: [{ id: 'Q34', name: { sv: 'Sverige' } }],
      birthDate: { year: 1746 },
      deathDate: { year: 1792 },
      pageviews: { sv: 5864, en: 10783 },
    };
    expect(determineTier(gustavIII, LOCALE_PRESETS.SE)).toBe('standard');
    expect(determineTier(gustavIII, LOCALE_PRESETS.US)).toBe('hard');

    // 3. Shared English Wikipedia (US vs GB vs AU): an Australian figure (Q408) is compensated for AU's ~3.5% share of en.wikipedia
    const australianIcon = {
      sitelinks: 95,
      swedish: false,
      citizenship: [{ id: 'Q408', name: { en: 'Australia' } }],
      birthDate: { year: 1957 },
      deathDate: null,
      pageviews: { sv: 85, en: 42000 },
    };
    expect(computeKandisScore(australianIcon, LOCALE_PRESETS.AU)).toBeGreaterThan(
      computeKandisScore(australianIcon, LOCALE_PRESETS.US)
    );
    expect(determineTier(australianIcon, LOCALE_PRESETS.AU)).toBe('standard');
    expect(determineTier(australianIcon, LOCALE_PRESETS.US)).toBe('hard');

    // 4. Historical British figure (Kingdom of England Q179876 -> Q145) scores higher for GB than US on en.wikipedia
    const britishHistorical = {
      sitelinks: 98,
      swedish: false,
      citizenship: [{ id: 'Q179876', name: { en: 'Kingdom of England' } }],
      birthDate: { year: 1630 },
      deathDate: { year: 1685 },
      pageviews: { sv: 550, en: 65000 },
    };
    expect(computeKandisScore(britishHistorical, LOCALE_PRESETS.GB)).toBeGreaterThan(
      computeKandisScore(britishHistorical, LOCALE_PRESETS.US)
    );
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

  it('contains valid standard, hard, and very_hard tiers and non-empty categories', () => {
    expect(dataset.people.length).toBeGreaterThan(3500);
    const tiers = new Set(dataset.people.map((p) => p.tier));
    expect(tiers.has('standard')).toBe(true);
    expect(tiers.has('hard')).toBe(true);
    expect(tiers.has('very_hard')).toBe(true);

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
      selectedTier: 'hard',
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
      matchTier: 'standard',
      matchOnlySwedish: false,
    });

    const restored = loadGeoSession();
    expect(restored).not.toBeNull();
    expect(restored?.currentPersonId).toBe('Q1043');
    expect(restored?.selectedTier).toBe('hard');
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
      tier: 'standard',
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
      tier: 'standard',
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
      tierFilter: 'standard',
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
      tier: 'standard',
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

import {
  toggleLifeStatus,
  matchesLifeStatuses,
  matchesCenturies,
  toggleCentury,
  toggleTier,
  matchesTiers,
  matchesCountries,
  toggleCountry,
  extractAvailableCountries,
} from '../filters.ts';

describe('multi-choice game filters (filters.ts)', () => {
  it('toggles life statuses (historical / living) without an explicit both button and keeps at least one selected', () => {
    let statuses = toggleLifeStatus(['historical'], 'living');
    expect(statuses).toEqual(['historical', 'living']);

    // Deselecting historical leaves living
    statuses = toggleLifeStatus(statuses, 'historical');
    expect(statuses).toEqual(['living']);

    // Clicking the last remaining option keeps it active
    statuses = toggleLifeStatus(statuses, 'living');
    expect(statuses).toEqual(['living']);

    const historicalPerson = makeMockPerson({ id: 'Q_HIST', deathDate: { iso: '1900-01-01', year: 1900, precision: 'day', calendar: 'gregorian' } });
    const livingPerson = makeMockPerson({ id: 'Q_LIV', deathDate: null });

    expect(matchesLifeStatuses(historicalPerson, ['historical'])).toBe(true);
    expect(matchesLifeStatuses(livingPerson, ['historical'])).toBe(false);
    expect(matchesLifeStatuses(livingPerson, ['living'])).toBe(true);
    expect(matchesLifeStatuses(historicalPerson, ['historical', 'living'])).toBe(true);
    expect(matchesLifeStatuses(livingPerson, ['historical', 'living'])).toBe(true);
  });

  it('matches epochs when either birth year OR death year falls in any selected century (e.g. 1400 and 1600)', () => {
    let centuries = toggleCentury([], '1400');
    centuries = toggleCentury(centuries, '1600');
    expect(centuries).toEqual(['1400', '1600']);

    const p1384_1456 = makeMockPerson({
      id: 'Q_1384_1456',
      birthDate: { iso: '1384-01-01', year: 1384, precision: 'year', calendar: 'julian' },
      deathDate: { iso: '1456-01-01', year: 1456, precision: 'year', calendar: 'julian' },
    });
    const p1567_1604 = makeMockPerson({
      id: 'Q_1567_1604',
      birthDate: { iso: '1567-01-01', year: 1567, precision: 'year', calendar: 'julian' },
      deathDate: { iso: '1604-01-01', year: 1604, precision: 'year', calendar: 'julian' },
    });
    const p1503_1578 = makeMockPerson({
      id: 'Q_1503_1578',
      birthDate: { iso: '1503-01-01', year: 1503, precision: 'year', calendar: 'julian' },
      deathDate: { iso: '1578-01-01', year: 1578, precision: 'year', calendar: 'julian' },
    });

    expect(matchesCenturies(p1384_1456, centuries)).toBe(true);
    expect(matchesCenturies(p1567_1604, centuries)).toBe(true);
    expect(matchesCenturies(p1503_1578, centuries)).toBe(false);
    expect(matchesCenturies(p1503_1578, [])).toBe(true); // Empty = all epochs
  });

  it('expands to standard+hard+very_hard when selecting very_hard from default standard, then allows deselecting individual tiers', () => {
    let tiers = toggleTier(['standard'], 'very_hard');
    expect(tiers).toEqual(['standard', 'hard', 'very_hard']);

    // Now user can deselect standard or hard
    tiers = toggleTier(tiers, 'standard');
    expect(tiers).toEqual(['hard', 'very_hard']);

    tiers = toggleTier(tiers, 'hard');
    expect(tiers).toEqual(['very_hard']);

    // Cannot deselect the last remaining tier
    expect(toggleTier(tiers, 'very_hard')).toEqual(['very_hard']);

    // Selecting hard from standard gives standard + hard
    expect(toggleTier(['standard'], 'hard')).toEqual(['standard', 'hard']);

    const stdP = makeMockPerson({ id: 'Q_S', tier: 'standard' });
    const veryHardP = makeMockPerson({ id: 'Q_VH', tier: 'very_hard' });
    expect(matchesTiers(stdP, ['standard', 'hard'])).toBe(true);
    expect(matchesTiers(veryHardP, ['standard', 'hard'])).toBe(false);
  });

  it('filters by multiple countries across any, citizenship, birth, and death modes and maps historical predecessor states', () => {
    const alfredNobel = makeMockPerson({
      id: 'Q_NOBEL',
      swedish: true,
      citizenship: [{ id: 'Q34', name: { sv: 'Sverige', en: 'Sweden' } }],
      birthPlace: {
        id: 'Q1754',
        name: { sv: 'Stockholm', en: 'Stockholm' },
        coord: [59.33, 18.06],
        country: { id: 'Q34', name: { sv: 'Sverige', en: 'Sweden' } },
      },
      deathPlace: {
        id: 'Q34156',
        name: { sv: 'Sanremo', en: 'Sanremo' },
        coord: [43.81, 7.77],
        country: { id: 'Q38', name: { sv: 'Italien', en: 'Italy' } },
      },
    });

    const prussianPerson = makeMockPerson({
      id: 'Q_PRUSSIA',
      swedish: false,
      citizenship: [{ id: 'Q27306', name: { sv: 'Konungariket Preussen', en: 'Kingdom of Prussia' } }],
      birthPlace: {
        id: 'Q64',
        name: { sv: 'Berlin', en: 'Berlin' },
        coord: [52.52, 13.4],
        country: { id: 'Q183', name: { sv: 'Tyskland', en: 'Germany' } },
      },
    });

    const countries = toggleCountry([], 'Q38'); // Italy
    expect(matchesCountries(alfredNobel, countries, 'any')).toBe(true);
    expect(matchesCountries(alfredNobel, countries, 'death')).toBe(true);
    expect(matchesCountries(alfredNobel, countries, 'birth')).toBe(false);
    expect(matchesCountries(alfredNobel, countries, 'citizenship')).toBe(false);

    // Historical Kingdom of Prussia (Q27306) maps to Germany (Q183) even in strict citizenship mode
    expect(matchesCountries(prussianPerson, ['Q183'], 'citizenship')).toBe(true);

    const extracted = extractAvailableCountries([alfredNobel, prussianPerson], 'sv');
    expect(extracted.map((c) => c.id)).toContain('Q34');
    expect(extracted.map((c) => c.id)).toContain('Q38');
    expect(extracted.map((c) => c.id)).toContain('Q183');
  });
});




