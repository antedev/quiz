import type { EntityRef, HistDate, LocalizedText, Place, QuizCategory, Tier } from '../types/person.ts';

/**
 * Absoluta tröskelvärden för svårighetsgrad (kändisskapsindex på en 0–200-skala).
 * Gör att svårighetsgraden är deterministisk över tid och kan beräknas för valfri
 * språkutgåva och hemland (t.ex. Sverige/sv, Tyskland/de, USA/en, Storbritannien/en, Australien/en).
 */
export const TIER_THRESHOLDS = {
  standard: 140, // >= 140: Standard (Ikoner & Hushållsnamn)
  hard: 75,      // >= 75 och < 140: Svår (God allmänbildning & historia)
  // < 75: Mycket svår (Fördjupning / Historia / Nisch)
} as const;

export interface FamiliarityLocale {
  /** Wikipedia-språkutgåva, t.ex. 'sv', 'en', 'de', 'fr', 'es' */
  lang: string;
  /** Spelarens referensland (Wikidata QID, t.ex. 'Q34' Sverige, 'Q183' Tyskland, 'Q30' USA, 'Q145' Storbritannien, 'Q408' Australien) */
  country: string;
}

export const DEFAULT_FAMILIARITY_LOCALE: FamiliarityLocale = {
  lang: 'sv',
  country: 'Q34',
};

/**
 * Fördefinierade spelarprofiler (språk + land) för generaliserad svårighetsbedömning.
 */
export const LOCALE_PRESETS: Record<string, FamiliarityLocale> = {
  SE: { lang: 'sv', country: 'Q34' },  // Sverige (sv.wikipedia)
  FI: { lang: 'sv', country: 'Q33' },  // Finland / finlandssvensk (sv.wikipedia)
  DE: { lang: 'de', country: 'Q183' }, // Tyskland (de.wikipedia)
  AT: { lang: 'de', country: 'Q40' },  // Österrike (de.wikipedia)
  CH: { lang: 'de', country: 'Q39' },  // Schweiz (de.wikipedia)
  US: { lang: 'en', country: 'Q30' },  // USA (en.wikipedia)
  GB: { lang: 'en', country: 'Q145' }, // Storbritannien (en.wikipedia)
  AU: { lang: 'en', country: 'Q408' }, // Australien (en.wikipedia)
  CA: { lang: 'en', country: 'Q16' },  // Kanada (en.wikipedia)
  FR: { lang: 'fr', country: 'Q142' }, // Frankrike (fr.wikipedia)
  ES: { lang: 'es', country: 'Q29' },  // Spanien (es.wikipedia)
  IT: { lang: 'it', country: 'Q38' },  // Italien (it.wikipedia)
};

/**
 * Log10-referensintervall (ca 5:e till 98:e percentilen för 30-dagars sidvisningar)
 * per Wikipedia-språkutgåva. Normaliserar bort att olika språkutgåvor har olika
 * läsarunderlag (t.ex. att en.wikipedia har ~58x fler visningar per artikel än sv.wikipedia)
 * och att sv.wikipedia har många bot-skapade stubbar (som får ~0 mänskliga sidvisningar).
 */
export const WIKI_EDITION_NORMS: Record<string, { logFloor: number; logCeiling: number }> = {
  sv: { logFloor: 0.85, logCeiling: 3.55 }, // ~6 till ~3 550 visningar / 30d
  en: { logFloor: 2.20, logCeiling: 5.25 }, // ~160 till ~178 000 visningar / 30d
  de: { logFloor: 1.65, logCeiling: 4.50 }, // ~45 till ~31 600 visningar / 30d
  fr: { logFloor: 1.55, logCeiling: 4.40 }, // ~35 till ~25 000 visningar / 30d
  es: { logFloor: 1.55, logCeiling: 4.40 },
  it: { logFloor: 1.45, logCeiling: 4.30 },
};

/**
 * Andel av läsartrafiken på respektive Wikipedia-språkutgåva som kommer från ett visst land.
 *
 * När ett språk delas av flera länder (t.ex. en.wikipedia mellan USA, Storbritannien, Australien, Kanada
 * och globala andraspråksläsare, eller de.wikipedia mellan Tyskland, Österrike och Schweiz) späs en
 * inhemsk profils sidvisningar ut i proportion till landets andel av språkutgåvans totala trafik.
 *
 * Notera: För Sverige på sv.wikipedia är andelen ~0.92 (-log10(0.92) = +0.036, dvs. i princip 0!),
 * eftersom sv.wikipedias sidvisningar redan till >90 % utgörs av svenska läsare. Därmed behövs ingen
 * hårdkodad "2.2x"-multiplikator för svenskar när sidvisningar finns.
 */
export const COUNTRY_WIKI_AUDIENCE_SHARE: Record<string, number> = {
  'sv:Q34': 0.92,  // Sverige på sv.wikipedia (~92 % av läsarna)
  'sv:Q33': 0.06,  // Finland på sv.wikipedia (~6 % av läsarna)
  'de:Q183': 0.82, // Tyskland på de.wikipedia (~82 % av läsarna)
  'de:Q40': 0.09,  // Österrike på de.wikipedia (~9 % av läsarna)
  'de:Q39': 0.06,  // Schweiz på de.wikipedia (~6 % av läsarna)
  'en:Q30': 0.42,  // USA på en.wikipedia (~42 % av globala en.wiki-trafiken)
  'en:Q145': 0.11, // Storbritannien på en.wikipedia (~11 % av globala en.wiki-trafiken)
  'en:Q16': 0.045, // Kanada på en.wikipedia (~4.5 %)
  'en:Q408': 0.035,// Australien på en.wikipedia (~3.5 %)
  'fr:Q142': 0.72, // Frankrike på fr.wikipedia
  'es:Q29': 0.28,  // Spanien på es.wikipedia (delas med Latinamerika)
  'it:Q38': 0.92,  // Italien på it.wikipedia
};

const HISTORICAL_COUNTRY_MAP: Record<string, string> = {
  Q756617: 'Q35', Q62651: 'Q35',
  Q174193: 'Q145', Q161885: 'Q145', Q179876: 'Q145', Q230791: 'Q145', Q21: 'Q145', Q22: 'Q145', Q25: 'Q145',
  Q27306: 'Q183', Q43287: 'Q183', Q41304: 'Q183', Q7318: 'Q183', Q1206012: 'Q183', Q148499: 'Q183',
  Q12548: 'Q183', Q156199: 'Q183', Q713750: 'Q183', Q16957: 'Q183', Q154195: 'Q183', Q159631: 'Q183',
  Q155570: 'Q183', Q696651: 'Q183',
  Q172579: 'Q38', Q170174: 'Q38', Q4948: 'Q38', Q148540: 'Q38', Q2252973: 'Q38', Q154849: 'Q38',
  Q70972: 'Q142', Q146246: 'Q142', Q70802: 'Q142',
  Q34266: 'Q159', Q15180: 'Q159', Q11750528: 'Q159', Q2305208: 'Q159', Q186096: 'Q159',
  Q131964: 'Q40', Q28513: 'Q40', Q533534: 'Q40', Q699964: 'Q40', Q701614: 'Q40',
  Q29999: 'Q55', Q170072: 'Q55',
  Q45670: 'Q45',
  Q129286: 'Q668', Q1775277: 'Q668',
  Q8733: 'Q148', Q13426199: 'Q148', Q9903: 'Q148', Q7462: 'Q148', Q9683: 'Q148', Q7313: 'Q148',
  Q188712: 'Q17',
  Q62633: 'Q33',
  Q172107: 'Q36', Q207272: 'Q36',
  Q217196: 'Q29',
  Q11768: 'Q79',
  Q12560: 'Q43',
  Q844930: 'Q41',
  Q33946: 'Q213',
  Q2277: 'Q1747689',
};

const canonCountry = (id: string): string => HISTORICAL_COUNTRY_MAP[id] ?? id;
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface FamiliarityCandidate {
  sitelinks: number;
  swedish?: boolean;
  citizenship?: EntityRef[];
  birthPlace?: Place | null;
  deathPlace?: Place | null;
  birthDate?: HistDate | { year: number };
  deathDate?: HistDate | { year: number } | null;
  pageviews?: Record<string, number>;
}

function isAffiliatedWithCountry(person: FamiliarityCandidate, targetCountryId: string): boolean {
  const target = canonCountry(targetCountryId);
  if (target === 'Q34' && person.swedish) return true;
  for (const c of person.citizenship ?? []) {
    if (canonCountry(c.id) === target) return true;
  }
  if (person.birthPlace?.country?.id && canonCountry(person.birthPlace.country.id) === target) {
    return true;
  }
  return false;
}

/**
 * Kompenserar för att nu levande personer har ~2–3x högre daglig nyhets-/medietrafik på Wikipedia
 * än historiska gestalter (före 1900) med motsvarande lärobokskändisskap.
 */
function computeEraLogAdjustment(person: FamiliarityCandidate): number {
  if (person.deathDate === undefined && person.birthDate === undefined) return 0;
  if (person.deathDate === null) return -0.22;
  const birthYear = person.birthDate?.year ?? 1900;
  if (birthYear < 1800) return +0.25;
  if (birthYear < 1900) return +0.15;
  return 0;
}

/**
 * Beräknar ett generaliserat kändisskapsindex (ca 0–200) för en person utifrån:
 * 1) Global bredd (Wikidata sitelinks + en.wikipedia-visningar)
 * 2) Läsarfrekvens på spelarens Wikipedia-språkutgåva (normaliserad på log10-skala per språkutgåva)
 * 3) Utspädningskompensation för inhemska personer när flera länder delar språkutgåva (t.ex. US/GB/AU på en.wikipedia)
 */
export function computeKandisScore(
  person: FamiliarityCandidate,
  locale: FamiliarityLocale = DEFAULT_FAMILIARITY_LOCALE
): number {
  const { lang, country } = locale;
  const sl = Math.max(1, person.sitelinks || 0);
  const slLog = Math.log10(Math.max(10, sl));
  const slScore = clamp(((slLog - 1.30) / (2.30 - 1.30)) * 100, 0, 120);

  const isDomestic = isAffiliatedWithCountry(person, country);
  const pv = person.pageviews;
  const hasAnyPageviews = pv && Object.keys(pv).length > 0;

  // Fallback om sidvisningar inte finns alls (t.ex. i äldre enhetstester med enbart sitelinks):
  if (!hasAnyPageviews) {
    const domesticShare = isDomestic ? 0.08 : 1.0;
    const dilutionBoost = isDomestic ? -Math.log10(domesticShare) * 55 * clamp(1 - slScore / 130, 0.45, 1.0) : 0;
    return Math.round((slScore + dilutionBoost) * 1.62);
  }

  const eraAdj = computeEraLogAdjustment(person);
  const enNorm = WIKI_EDITION_NORMS.en!;
  const enViews = pv.en ?? 0;
  const enLog = Math.log10(enViews + 1) + eraAdj;
  const enScore =
    enViews > 0
      ? clamp(((enLog - enNorm.logFloor) / (enNorm.logCeiling - enNorm.logFloor)) * 100, 0, 120)
      : slScore;

  const globalScore = 0.60 * slScore + 0.40 * enScore;

  // Om den valda språkutgåvan har sidvisningar (t.ex. 'sv' eller 'en'), använd dem direkt.
  // Annars (t.ex. 'de' innan de.wikipedia-cache har hämtats) estimera från en.wikipedia + hemlandsandel.
  const hasLangViews = typeof pv[lang] === 'number';
  const activeLang = hasLangViews ? lang : 'en';
  const norm = WIKI_EDITION_NORMS[activeLang] ?? WIKI_EDITION_NORMS.en!;
  const rawLocalViews = pv[activeLang] ?? 0;
  let localLog = Math.log10(rawLocalViews + 1) + eraAdj;

  if (isDomestic && rawLocalViews > 0) {
    const shareKey = `${activeLang}:${canonCountry(country)}`;
    // Om en icke-engelskspråkig profil (t.ex. Tyskland) faller tillbaka på en.wikipedia,
    // har inhemska tyska profiler ungefär ~8 % relativ räckvidd på en.wikipedia.
    const share = COUNTRY_WIKI_AUDIENCE_SHARE[shareKey] ?? (activeLang === lang ? 0.5 : 0.08);
    const dilutionLog = -Math.log10(share);
    const domesticWeight = clamp(1 - slScore / 110, 0.15, 1.0);
    localLog += domesticWeight * dilutionLog;
  }

  const localScore = clamp(((localLog - norm.logFloor) / (norm.logCeiling - norm.logFloor)) * 100, 0, 125);

  const balanced = 0.40 * globalScore + 0.60 * localScore;
  const localDriven = 0.15 * globalScore + 0.85 * localScore;
  const combined = Math.max(balanced, localDriven);

  return Math.round(combined * 1.62);
}

/**
 * Returnerar svårighetsgraden ('standard' | 'hard' | 'very_hard') för en person,
 * valfritt beräknad för en specifik spelarprofil (språk + land).
 */
export function determineTier(
  person: FamiliarityCandidate,
  locale: FamiliarityLocale = DEFAULT_FAMILIARITY_LOCALE
): Tier {
  const score = computeKandisScore(person, locale);
  if (score >= TIER_THRESHOLDS.standard) return 'standard';
  if (score >= TIER_THRESHOLDS.hard) return 'hard';
  return 'very_hard';
}

interface CategoryRule {
  cat: QuizCategory;
  /** Termer som kan förekomma som sammansättningar (t.ex. "skådespelare" i "filmskådespelare") */
  terms: string[];
  /** Kortare eller tvetydiga ord som måste stå vid ordstart/ordgräns (t.ex. "dj", "tsar", "khan") */
  wordTerms?: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    cat: 'sports',
    terms: [
      'idrott', 'sport', 'fotboll', 'friidrott', 'ishockey', 'tennis', 'racerförare',
      'skidåk', 'simmar', 'basket', 'cyklis', 'boxar', 'schack', 'golf', 'formel 1',
      'motorcykel', 'hästpolo', 'ryttare', 'skridsko', 'handboll', 'bandy', 'baseboll',
      'gymnast', 'brottare', 'roddare', 'alpin',
      'footballer', 'soccer player', 'tennis player', 'ice hockey', 'chess player',
      'swimmer', 'cyclist', 'boxer', 'racing driver', 'Formula One', 'sprinter',
      'skier', 'figure skater', 'golfer', 'wrestler', 'gymnast', 'basketball player'
    ],
    wordTerms: ['atlet', 'athlete', 'olympian']
  },
  {
    cat: 'music',
    terms: [
      'kompositör', 'tonsättare', 'sångar', 'musiker', 'låtskriv', 'dirigent', 'pianist', 'opera',
      'sångtext', 'organist', 'cellist', 'violinist', 'gitarrist', 'rappare', 'trumslagar',
      'sångerska', 'instrumentmakare', 'violinmakare', 'trubadur', 'sopran', 'tenor',
      'discjockey', 'diskjockey', 'musikproducent',
      'composer', 'singer', 'musician', 'songwriter', 'conductor', 'violinist', 'guitarist',
      'rapper', 'drummer', 'soprano', 'record producer'
    ],
    wordTerms: ['dj', 'bard']
  },
  {
    cat: 'culture',
    terms: [
      'skådespelare', 'filmregissör', 'filmproducent', 'regissör', 'teater', 'komiker',
      'manusförfattare', 'programledare', 'cirkus', 'trollkarl', 'radiopratare', 'dansare',
      'koreograf', 'kurtisan', 'underhållare', 'fotomodell',
      'actor', 'actress', 'film director', 'film producer', 'screenwriter', 'comedian',
      'dancer', 'choreographer', 'entertainer', 'television presenter', 'illusionist'
    ],
    wordTerms: ['artist', 'modell']
  },
  {
    cat: 'art',
    terms: [
      'målare', 'skulptör', 'arkitekt', 'grafiker', 'tecknare', 'fotograf', 'illustratör',
      'konstnär', 'kopparstickare', 'gravör', 'etsare', 'litograf', 'formgivare', 'designer',
      'kalligraf', 'keramiker', 'konstsamlare',
      'painter', 'sculptor', 'architect', 'photographer', 'illustrator', 'printmaker',
      'engraver', 'etcher', 'draughtsman', 'draftsman', 'calligrapher', 'ceramist'
    ]
  },
  {
    cat: 'literature',
    terms: [
      'författare', 'romanförfattare', 'dramatiker', 'essäist', 'översättare',
      'barnboksförfattare', 'självbiograf', 'dagboksskrivare', 'novellförfattare', 'librettist',
      'lyriker', 'krönikör', 'journalist', 'publicist', 'redaktör', 'skribent', 'kritiker',
      'prosaist', 'lexikograf',
      'writer', 'novelist', 'playwright', 'dramatist', 'essayist', 'translator',
      'diarist', 'chronicler', 'literary critic', 'editor', 'biographer'
    ],
    wordTerms: ['poet', 'author', 'skald']
  },
  {
    cat: 'exploration',
    terms: [
      'upptäcktsresande', 'astronaut', 'sjöfarare', 'polarfarare', 'flygpionjär',
      'rymdfarare', 'kosmonaut', 'navigator', 'äventyrare', 'kartograf', 'upptäckare',
      'testpilot', 'stridspilot', 'helikopterpilot',
      'explorer', 'seafarer', 'cosmonaut', 'aviator', 'cartographer', 'mountaineer',
      'adventurer', 'circumnavigator'
    ],
    wordTerms: ['pilot']
  },
  {
    cat: 'politics',
    terms: [
      'politiker', 'monark', 'diplomat', 'drottning', 'president', 'militär',
      'ämbetsman', 'kejsare', 'statsman', 'revolutionär', 'partiledare', 'härskare',
      'statsperson', 'statschef', 'regeringschef', 'guvernör', 'general', 'amiral',
      'officer', 'krigsherre', 'krigare', 'fältmarskalk', 'kansler', 'minister', 'senator',
      'riksdagsledamot', 'borgmästare', 'aristokrat', 'gemål', 'adelsman',
      'samuraj', 'regent', 'hövding', 'landsfader', 'diktator', 'fältherre', 'kondottiär',
      'politician', 'statesperson', 'statesman', 'emperor', 'empress', 'dictator',
      'military officer', 'military leader', 'commander', 'governor', 'chancellor',
      'prime minister', 'revolutionary', 'warlord', 'noble', 'consort', 'pharaoh'
    ],
    wordTerms: [
      'kung', 'prins', 'prinsessa', 'tsar', 'farao', 'sultan', 'khan', 'mansa',
      'jarl', 'hertig', 'furste', 'kalif', 'emir', 'shah', 'conqueror', 'king', 'queen', 'prince', 'princess'
    ]
  },
  {
    cat: 'science',
    terms: [
      'fysiker', 'filosof', 'matematiker', 'kemist', 'astronom', 'biolog', 'universitetslärare',
      'läkare', 'historiker', 'uppfinnare', 'botaniker', 'geolog', 'sociolog', 'psykolog',
      'antropolog', 'arkeolog', 'zoolog', 'lingvist', 'vetenskapsman', 'forskare', 'anatom',
      'kirurg', 'naturvetare', 'meteorolog', 'naturforskare', 'teoretiker', 'polyhistor',
      'ekonom', 'nationalekonom', 'professor', 'vetenskap', 'ingenjör', 'kryptograf',
      'physicist', 'philosopher', 'mathematician', 'chemist', 'astronomer', 'biologist',
      'physician', 'historian', 'inventor', 'botanist', 'geologist', 'sociologist',
      'psychologist', 'anthropologist', 'archaeologist', 'zoologist', 'linguist',
      'scientist', 'researcher', 'anatomist', 'surgeon', 'naturalist', 'polymath',
      'economist', 'engineer', 'computer scientist'
    ]
  },
  {
    cat: 'business',
    terms: [
      'affärsman', 'entreprenör', 'företagsledare', 'bankir', 'industrialist', 'finansman',
      'köpman', 'affärsidkare', 'handelsman', 'redare', 'bruksägare', 'grosshandlare',
      'building contractor', 'mecenat', 'företagare', 'förläggare', 'boktryckare',
      'businessperson', 'businessman', 'businesswoman', 'entrepreneur', 'banker',
      'financier', 'merchant', 'shipowner', 'publisher', 'magnate', 'tycoon'
    ]
  },
  {
    cat: 'society',
    terms: [
      'präst', 'teolog', 'påve', 'biskop', 'helgon', 'predikant', 'ärkebiskop',
      'aktivist', 'suffragett', 'missionär', 'rabbin', 'reformator',
      'patriark', 'kardinal', 'motståndskämpe', 'religiös', 'medicinman',
      'mystiker', 'teosof', 'filantrop', 'ordensgrundare', 'profet', 'martyr',
      'priest', 'theologian', 'bishop', 'archbishop', 'preacher', 'activist',
      'suffragette', 'missionary', 'rabbi', 'reformer', 'cardinal', 'mystic',
      'philanthropist', 'monk', 'nun', 'saint', 'pope', 'prophet'
    ],
    wordTerms: ['munk', 'nunna', 'imam', 'abbot', 'guru']
  }
];

function matchesRule(text: string, rule: CategoryRule): boolean {
  if (rule.terms.some((term) => text.includes(term.toLowerCase()))) {
    return true;
  }
  if (rule.wordTerms) {
    for (const wt of rule.wordTerms) {
      const escaped = wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<=^|[^\\p{L}\\p{N}])${escaped}(?:en|et|ar|er|na|s)?(?=[^\\p{L}\\p{N}]|$)`, 'ui');
      if (regex.test(text)) return true;
    }
  }
  return false;
}

/**
 * Klassificerar en person i quiz-kategorier baserat på yrkeslistor och beskrivning.
 * Returnerar en array av kategorier i prioritetsordning.
 */
export function classifyCategories(person: {
  occupations?: EntityRef[];
  description?: LocalizedText;
}): QuizCategory[] {
  const occText = (person.occupations || [])
    .map((o) => `${o.name?.sv || ''} ${o.name?.en || ''}`)
    .join(' ')
    .toLowerCase();

  // Ta bort släktomnämnanden ("son till...", "barnbarn till...", "gift med...") ur beskrivningen
  // så att en förfaders titel inte styr personens egen kategori.
  const cleanRelatives = (s: string) =>
    s.replace(/\b(?:son|dotter|barnbarn|bror|syster|far|mor|gift)\s+(?:till|med)\b.*$/i, '');

  const descText = [
    cleanRelatives(person.description?.sv || ''),
    cleanRelatives(person.description?.en || ''),
  ]
    .join(' ')
    .toLowerCase();

  const fullText = `${occText} ${descText}`;

  const matched: QuizCategory[] = [];
  for (const rule of CATEGORY_RULES) {
    if (matchesRule(fullText, rule)) {
      matched.push(rule.cat);
    }
  }

  return matched.length > 0 ? matched : ['other'];
}
