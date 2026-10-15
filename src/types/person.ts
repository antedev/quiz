/**
 * Datamodell för persondatabasen. Delas mellan data-pipelinen och spelet.
 * Källa: Wikidata (CC0). Bilder: Wikimedia Commons (licens per bild, se ImageInfo).
 */

export type Lang = 'sv' | 'en';

/** Text på flera språk. Spelet väljer språk med fallback (sv -> en). */
export type LocalizedText = Partial<Record<Lang, string>>;

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
 * guess     = Nivå 1, kända personer: rätta svar och svarsalternativ.
 * reference = Nivå 2, används som kontextledtrådar ("levde samtidigt som ...").
 */
export type Tier = 'guess' | 'reference';

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
