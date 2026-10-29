import type { EntityRef, LocalizedText, QuizCategory } from '../types/person.ts';

/**
 * Absoluta tröskelvärden för svårighetsgrad (kändisskap).
 * Gör att svårighetsgraden är deterministisk och inte ändras relativt när fler personer importeras.
 */
export const TIER_THRESHOLDS = {
  easy: 140,   // >= 140: Ikoner & Kändisar (Trump, Linné, Einstein, Astrid Lindgren, Zlatan...)
  medium: 75,  // >= 75 och < 140: God allmänbildning (Hjalmar Söderberg, Bellman, Olof Palme, Agatha Christie...)
  // < 75: Fördjupning / Historia / Nisch (Jakob Bernoulli, Giambattista Vico, Albrekt av Mecklenburg...)
} as const;

export const SWEDISH_CELEBRITY_MULTIPLIER = 2.2;

/**
 * Beräknar ett absolut kändisskapsindex för en person.
 * Globala Wikipedia-artiklar (sitelinks) som bas, med en svensk multiplikator för att spegla
 * att en svensk spelare känner igen svenska kulturprofiler långt mer än världsgenomsnittet.
 */
export function computeKandisScore(person: { sitelinks: number; swedish: boolean }): number {
  const base = person.sitelinks || 0;
  return person.swedish ? Math.round(base * SWEDISH_CELEBRITY_MULTIPLIER) : base;
}

/**
 * Returnerar svårighetsgraden baserat på absolut kändisskapsindex.
 */
export function determineTier(person: { sitelinks: number; swedish: boolean }): 'easy' | 'medium' | 'hard' {
  const score = computeKandisScore(person);
  if (score >= TIER_THRESHOLDS.easy) return 'easy';
  if (score >= TIER_THRESHOLDS.medium) return 'medium';
  return 'hard';
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
