/**
 * Datamodell för persondatabasen. Delas mellan data-pipelinen och spelet.
 * Källa: Wikidata (CC0). Bilder: Wikimedia Commons (licens per bild, se ImageInfo).
 */

export type Lang = 'sv' | 'en';

/** Text på flera språk. Spelet väljer språk med fallback (sv -> en). */
export type LocalizedText = Partial<Record<Lang, string>>;

/** Hämtar text på valt språk med garanterad fallback (lang -> sv -> en -> fallback). */
export function loc(text: LocalizedText | undefined | null, lang: Lang = 'sv', fallback = ''): string {
  if (!text) return fallback;
  return text[lang] || text.sv || text.en || fallback;
}

export type DatePrecision = 'year' | 'month' | 'day';

export interface HistDate {
  /** ISO-liknande datum, t.ex. "1452-04-15" (dag/månad = 01 om precision saknas). Negativt år för f.Kr. */
  iso: string;
  year: number;
  precision: DatePrecision;
  /** Julianska datum anges som i källan; år räcker för spellogiken. */
  calendar: 'gregorian' | 'julian';
}

/** Referens till en annan Wikidata-entitet (yrke, land, verk ...). */
export interface EntityRef {
  id: string;
  name: LocalizedText;
}

export interface Place extends EntityRef {
  /** [lat, lon] */
  coord?: [number, number];
  country?: EntityRef;
}

export interface ImageInfo {
  /** Filnamn på Commons, t.ex. "Leonardo_self.jpg" */
  file: string;
  /** Miniatyr-URL (bredd ~ 400 px) */
  thumb: string;
  /** Beskrivningssida på Commons (för attribution) */
  page: string;
  artist?: string;
  license?: string;
  licenseUrl?: string;
}

/**
 * Tre svårighetsgrader för quiz:
 * easy   = Lätt (Ikoner & Kändisar, kandisScore >= 140)
 * medium = Medel (Allmänbildning, kandisScore 75–139)
 * hard   = Svår (Nisch & Historia, kandisScore < 75)
 */
export type Tier = 'easy' | 'medium' | 'hard';

/** Urvalspool i data-pipelinen (steg 1). */
export type PoolTier = 'guess' | 'reference';

export type QuizCategory =
  | 'politics'
  | 'science'
  | 'literature'
  | 'music'
  | 'culture'
  | 'art'
  | 'sports'
  | 'business'
  | 'society'
  | 'exploration'
  | 'other';

export const QUIZ_CATEGORIES: Record<QuizCategory, { sv: string; en: string; icon: string }> = {
  politics: { sv: 'Politik & Historia', en: 'Politics & History', icon: '🏛️' },
  science: { sv: 'Vetenskap & Filosofi', en: 'Science & Philosophy', icon: '🔬' },
  literature: { sv: 'Litteratur & Text', en: 'Literature & Writing', icon: '📚' },
  music: { sv: 'Musik', en: 'Music', icon: '🎵' },
  culture: { sv: 'Scen, Film & Nöje', en: 'Stage, Film & Media', icon: '🎭' },
  art: { sv: 'Konst & Arkitektur', en: 'Art & Architecture', icon: '🎨' },
  sports: { sv: 'Sport & Idrott', en: 'Sports', icon: '⚽' },
  business: { sv: 'Ekonomi & Näringsliv', en: 'Business & Economics', icon: '💼' },
  society: { sv: 'Samhälle & Religion', en: 'Society & Faith', icon: '🕊️' },
  exploration: { sv: 'Upptäckare & Äventyr', en: 'Exploration & Pioneers', icon: '🧭' },
  other: { sv: 'Kultur & Samhälle', en: 'Culture & Society', icon: '🌟' },
};

export type Gender = 'male' | 'female' | 'other';

export interface Person {
  id: string;
  name: LocalizedText;
  /** Tvättad beskrivning (årtal borttagna). */
  description: LocalizedText;
  gender?: Gender;
  birthDate: HistDate;
  /** null = nu levande */
  deathDate: HistDate | null;
  birthPlace: Place | null;
  deathPlace: Place | null;
  sitelinks: number;
  tier: Tier;
  categories?: QuizCategory[];
  swedish: boolean;
  occupations: EntityRef[];
  citizenship: EntityRef[];
  causeOfDeath: EntityRef[];
  mannerOfDeath: EntityRef[];
  notableWorks: EntityRef[];
  image: ImageInfo | null;
  /** Artikeltitlar på Wikipedia */
  wiki: LocalizedText;
}

export interface PeopleDataset {
  version: 1;
  generatedAt: string;
  source: string;
  license: string;
  counts: Record<string, number>;
  people: Person[];
}
