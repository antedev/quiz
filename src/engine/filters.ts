import { loc, type LocalizedText, type Person, type Tier } from '../types/person.ts';
import { determineTier, type FamiliarityLocale } from './classification.ts';

export type LifeStatusOption = 'historical' | 'living';
export type CountryMatchMode = 'any' | 'citizenship' | 'birth' | 'death';

export interface CenturyOption {
  value: string;
  label: string;
  labelEn: string;
  shortLabel: string;
  shortLabelEn: string;
}

export const CENTURY_OPTIONS: CenturyOption[] = [
  { value: 'antiquity', label: 'Antiken & forntid (< 500)', labelEn: 'Antiquity (< 500)', shortLabel: '< 500', shortLabelEn: '< 500' },
  { value: 'early', label: '500–1200-talet', labelEn: '500–1200s', shortLabel: '500–1200', shortLabelEn: '500–1200' },
  { value: '1300', label: '1300-talet', labelEn: '1300s', shortLabel: '1300', shortLabelEn: '1300s' },
  { value: '1400', label: '1400-talet', labelEn: '1400s', shortLabel: '1400', shortLabelEn: '1400s' },
  { value: '1500', label: '1500-talet', labelEn: '1500s', shortLabel: '1500', shortLabelEn: '1500s' },
  { value: '1600', label: '1600-talet', labelEn: '1600s', shortLabel: '1600', shortLabelEn: '1600s' },
  { value: '1700', label: '1700-talet', labelEn: '1700s', shortLabel: '1700', shortLabelEn: '1700s' },
  { value: '1800', label: '1800-talet', labelEn: '1800s', shortLabel: '1800', shortLabelEn: '1800s' },
  { value: '1900', label: '1900-talet', labelEn: '1900s', shortLabel: '1900', shortLabelEn: '1900s' },
  { value: '2000', label: '2000-talet', labelEn: '2000s', shortLabel: '2000', shortLabelEn: '2000s' },
];

/**
 * Mappar historiska föregångarstater i Wikidata (t.ex. Konungariket Danmark, Preussen,
 * Kungariket England, Kejsardömet Ryssland) till motsvarande moderna land-ID så att
 * medborgarskap och födelse-/dödsort hänger ihop över tid.
 */
const HISTORICAL_COUNTRY_ALIASES: Record<string, string> = {
  // Danmark (Q35)
  Q756617: 'Q35', // Konungariket Danmark
  Q62651: 'Q35',  // Danmark-Norge

  // Storbritannien (Q145)
  Q174193: 'Q145', // Förenade kungariket Storbritannien och Irland
  Q161885: 'Q145', // Kungariket Storbritannien
  Q179876: 'Q145', // Kungariket England
  Q230791: 'Q145', // Kungariket Skottland
  Q21: 'Q145',     // England
  Q22: 'Q145',     // Skottland
  Q25: 'Q145',     // Wales

  // Tyskland (Q183)
  Q27306: 'Q183',   // Konungariket Preussen
  Q43287: 'Q183',   // Kejsardömet Tyskland
  Q41304: 'Q183',   // Weimarrepubliken
  Q7318: 'Q183',    // Nazityskland
  Q1206012: 'Q183', // Tyska riket
  Q148499: 'Q183',  // Markgrevskapet Brandenburg
  Q12548: 'Q183',   // Tysk-romerska riket
  Q156199: 'Q183',  // Kurfurstendömet Sachsen
  Q713750: 'Q183',  // Västtyskland
  Q16957: 'Q183',   // Östtyskland
  Q154195: 'Q183',  // Kungariket Bayern
  Q159631: 'Q183',  // Kungariket Württemberg
  Q155570: 'Q183',  // Sachsen-Weimar-Eisenach
  Q696651: 'Q183',  // Sachsen-Eisenach

  // Italien (Q38)
  Q172579: 'Q38',  // Kungariket Italien
  Q170174: 'Q38',  // Kyrkostaten
  Q4948: 'Q38',    // Republiken Venedig
  Q148540: 'Q38',  // Republiken Florens
  Q2252973: 'Q38', // Hertigdömet Florens
  Q154849: 'Q38',  // Storhertigdömet Toscana

  // Frankrike (Q142)
  Q70972: 'Q142',  // Kungariket Frankrike
  Q146246: 'Q142', // Frankerriket
  Q70802: 'Q142',  // Tredje franska republiken

  // Ryssland (Q159)
  Q34266: 'Q159',    // Kejsardömet Ryssland
  Q15180: 'Q159',    // Sovjetunionen
  Q11750528: 'Q159', // Furstendömet Moskva
  Q2305208: 'Q159',  // Sovjetryssland
  Q186096: 'Q159',   // Tsarryssland

  // Österrike (Q40)
  Q131964: 'Q40', // Kejsardömet Österrike
  Q28513: 'Q40',  // Österrike-Ungern
  Q533534: 'Q40', // Cisleithanien
  Q699964: 'Q40', // Ärkehertigdömet Österrike
  Q701614: 'Q40', // Ärkebiskopsdömet Salzburg

  // Nederländerna (Q55)
  Q29999: 'Q55',  // Konungariket Nederländerna
  Q170072: 'Q55', // Republiken Förenade Nederländerna

  // Portugal (Q45)
  Q45670: 'Q45',  // Kungariket Portugal

  // Indien (Q668)
  Q129286: 'Q668',  // Brittiska Indien
  Q1775277: 'Q668', // Dominionen Indien

  // Kina (Q148)
  Q8733: 'Q148',     // Qingdynastin
  Q13426199: 'Q148', // Republiken Kina
  Q9903: 'Q148',     // Mingdynastin
  Q7462: 'Q148',     // Songdynastin
  Q9683: 'Q148',     // Tangdynastin
  Q7313: 'Q148',     // Yuandynastin

  // Japan (Q17)
  Q188712: 'Q17', // Kejsardömet Japan

  // Finland (Q33)
  Q62633: 'Q33', // Storfurstendömet Finland

  // Polen (Q36)
  Q172107: 'Q36', // Polsk-litauiska samväldet
  Q207272: 'Q36', // Andra polska republiken

  // Spanien (Q29)
  Q217196: 'Q29', // Kastilianska kronan

  // Egypten (Q79)
  Q11768: 'Q79', // Forntida Egypten

  // Turkiet (Q43)
  Q12560: 'Q43', // Osmanska riket

  // Grekland (Q41)
  Q844930: 'Q41', // Antikens Aten

  // Tjeckien (Q213)
  Q33946: 'Q213', // Tjeckoslovakien

  // Romerska riket (Q1747689)
  Q2277: 'Q1747689', // Romerska kejsardömet
};

export const COUNTRY_FLAGS: Record<string, string> = {
  Q34: '🇸🇪',
  Q30: '🇺🇸',
  Q145: '🇬🇧',
  Q142: '🇫🇷',
  Q183: '🇩🇪',
  Q38: '🇮🇹',
  Q29: '🇪🇸',
  Q159: '🇷🇺',
  Q35: '🇩🇰',
  Q20: '🇳🇴',
  Q33: '🇫🇮',
  Q40: '🇦🇹',
  Q39: '🇨🇭',
  Q55: '🇳🇱',
  Q36: '🇵🇱',
  Q41: '🇬🇷',
  Q43: '🇹🇷',
  Q668: '🇮🇳',
  Q148: '🇨🇳',
  Q17: '🇯🇵',
  Q79: '🇪🇬',
  Q794: '🇮🇷',
  Q31: '🇧🇪',
  Q45: '🇵🇹',
  Q16: '🇨🇦',
  Q212: '🇺🇦',
  Q28: '🇭🇺',
  Q213: '🇨🇿',
  Q27: '🇮🇪',
  Q155: '🇧🇷',
  Q96: '🇲🇽',
  Q408: '🇦🇺',
  Q414: '🇦🇷',
  Q801: '🇮🇱',
  Q258: '🇿🇦',
  Q851: '🇸🇦',
  Q796: '🇮🇶',
  Q858: '🇸🇾',
  Q843: '🇵🇰',
  Q884: '🇰🇷',
  Q889: '🇦🇫',
  Q219: '🇧🇬',
  Q218: '🇷🇴',
  Q230: '🇬🇪',
  Q948: '🇹🇳',
  Q403: '🇷🇸',
  Q184: '🇧🇾',
  Q419: '🇵🇪',
  Q262: '🇩🇿',
  Q191: '🇪🇪',
  Q224: '🇭🇷',
  Q1028: '🇲🇦',
  Q225: '🇧🇦',
  Q298: '🇨🇱',
  Q822: '🇱🇧',
  Q1747689: '🏛️',
  Q12544: '☦️',
};

const CANONICAL_COUNTRY_NAMES: Record<string, LocalizedText> = {
  Q34: { sv: 'Sverige', en: 'Sweden' },
  Q30: { sv: 'USA', en: 'United States' },
  Q145: { sv: 'Storbritannien', en: 'United Kingdom' },
  Q142: { sv: 'Frankrike', en: 'France' },
  Q183: { sv: 'Tyskland', en: 'Germany' },
  Q38: { sv: 'Italien', en: 'Italy' },
  Q29: { sv: 'Spanien', en: 'Spain' },
  Q159: { sv: 'Ryssland', en: 'Russia' },
  Q35: { sv: 'Danmark', en: 'Denmark' },
  Q20: { sv: 'Norge', en: 'Norway' },
  Q33: { sv: 'Finland', en: 'Finland' },
  Q40: { sv: 'Österrike', en: 'Austria' },
  Q39: { sv: 'Schweiz', en: 'Switzerland' },
  Q55: { sv: 'Nederländerna', en: 'Netherlands' },
  Q36: { sv: 'Polen', en: 'Poland' },
  Q41: { sv: 'Grekland', en: 'Greece' },
  Q43: { sv: 'Turkiet (inkl. Osmanska riket)', en: 'Turkey (incl. Ottoman Empire)' },
  Q668: { sv: 'Indien', en: 'India' },
  Q148: { sv: 'Kina', en: 'China' },
  Q17: { sv: 'Japan', en: 'Japan' },
  Q79: { sv: 'Egypten', en: 'Egypt' },
  Q794: { sv: 'Iran / Persien', en: 'Iran / Persia' },
  Q31: { sv: 'Belgien', en: 'Belgium' },
  Q45: { sv: 'Portugal', en: 'Portugal' },
  Q16: { sv: 'Kanada', en: 'Canada' },
  Q212: { sv: 'Ukraina', en: 'Ukraine' },
  Q28: { sv: 'Ungern', en: 'Hungary' },
  Q213: { sv: 'Tjeckien', en: 'Czech Republic' },
  Q27: { sv: 'Irland', en: 'Ireland' },
  Q155: { sv: 'Brasilien', en: 'Brazil' },
  Q1747689: { sv: 'Romerska riket', en: 'Ancient Rome' },
  Q12544: { sv: 'Bysantinska riket', en: 'Byzantine Empire' },
};

/** Snabbvals-länder som visas direkt (Norden + stora historiska länder) */
export const QUICK_COUNTRY_IDS = [
  'Q34',  // Sverige
  'Q30',  // USA
  'Q145', // Storbritannien
  'Q142', // Frankrike
  'Q183', // Tyskland
  'Q38',  // Italien
  'Q35',  // Danmark
  'Q20',  // Norge
  'Q33',  // Finland
] as const;

export function canonicalizeCountryId(id: string): string {
  return HISTORICAL_COUNTRY_ALIASES[id] ?? id;
}

/**
 * 1. Spelläge (Historiska / Nu levande):
 * Flerval utan separat "Båda"-ruta. Minst ett alternativ hålls alltid aktivt.
 */
export function toggleLifeStatus(
  current: LifeStatusOption[],
  clicked: LifeStatusOption
): LifeStatusOption[] {
  const has = current.includes(clicked);
  if (has) {
    if (current.length <= 1) return current;
    return current.filter((s) => s !== clicked);
  }
  const next = [...current, clicked];
  const order: LifeStatusOption[] = ['historical', 'living'];
  return order.filter((s) => next.includes(s));
}

export function matchesLifeStatuses(person: Person, statuses: LifeStatusOption[]): boolean {
  if (statuses.length === 0 || (statuses.includes('historical') && statuses.includes('living'))) {
    return true;
  }
  if (statuses.includes('historical')) return !!person.deathDate;
  if (statuses.includes('living')) return !person.deathDate;
  return true;
}

/**
 * 2. Epok / Århundrade:
 * Flerval där en person matchar om ANTINGEN födelseår ELLER dödsår ligger i någon av de valda epokerna.
 * Exempel: Om 1400 och 1600 är valda matchar 1384–1456 (död på 1400-talet) och 1567–1604 (död på 1600-talet),
 * men INTE 1503–1578 (både född och död på 1500-talet).
 */
export function yearInCentury(year: number, century: string): boolean {
  if (century === 'all') return true;
  if (century === 'antiquity') return year < 500;
  if (century === 'early') return year >= 500 && year < 1300;
  const cNum = parseInt(century, 10);
  if (Number.isNaN(cNum)) return true;
  return year >= cNum && year < cNum + 100;
}

export function matchesPersonCentury(person: Person, century: string): boolean {
  if (century === 'all') return true;
  if (yearInCentury(person.birthDate.year, century)) return true;
  if (person.deathDate && yearInCentury(person.deathDate.year, century)) return true;
  return false;
}

export function matchesCenturies(person: Person, centuries: string[]): boolean {
  if (centuries.length === 0 || centuries.includes('all')) return true;
  return centuries.some((c) => matchesPersonCentury(person, c));
}

export function toggleCentury(current: string[], clicked: string): string[] {
  if (clicked === 'all') return [];
  const clean = current.filter((c) => c !== 'all');
  if (clean.includes(clicked)) {
    return clean.filter((c) => c !== clicked);
  }
  const next = [...clean, clicked];
  const order = CENTURY_OPTIONS.map((c) => c.value);
  return order.filter((c) => next.includes(c));
}

/**
 * 3. Svårighetsgrad (Standard / Svår / Mycket svår):
 * Flerval utan separat "Alla"-knapp.
 * Om man utgår från startläget ['standard'] och klickar på 'very_hard' markeras ['standard', 'hard', 'very_hard'],
 * varpå man kan avmarkera valfria nivåer.
 */
export function normalizeTier(tier: string): Tier {
  if (tier === 'easy' || tier === 'standard') return 'standard';
  if (tier === 'medium' || tier === 'hard') return 'hard';
  if (tier === 'very_hard') return 'very_hard';
  return 'standard';
}

export function normalizeTierList(tiers?: string[], legacySingle?: string): Tier[] {
  const order: Tier[] = ['standard', 'hard', 'very_hard'];
  if (tiers && tiers.length > 0) {
    const mapped = new Set<Tier>(tiers.map(normalizeTier));
    const result = order.filter((t) => mapped.has(t));
    if (result.length > 0) return result;
  }
  if (legacySingle === 'all') return ['standard', 'hard', 'very_hard'];
  if (legacySingle) return [normalizeTier(legacySingle)];
  return ['standard'];
}

export function toggleTier(current: Tier[], clicked: Tier): Tier[] {
  const normalizedCurrent = normalizeTierList(current);
  const normalizedClicked = normalizeTier(clicked);
  const has = normalizedCurrent.includes(normalizedClicked);
  if (has) {
    if (normalizedCurrent.length <= 1) return normalizedCurrent;
    return normalizedCurrent.filter((t) => t !== normalizedClicked);
  }
  // Om man står på startvalet ['standard'] och klickar på 'very_hard', markera alla tre: ['standard', 'hard', 'very_hard']
  if (normalizedClicked === 'very_hard' && normalizedCurrent.length === 1 && normalizedCurrent[0] === 'standard') {
    return ['standard', 'hard', 'very_hard'];
  }
  const next = [...normalizedCurrent, normalizedClicked];
  const order: Tier[] = ['standard', 'hard', 'very_hard'];
  return order.filter((t) => next.includes(t));
}

export function matchesTiers(person: Person, tiers: Tier[], locale?: FamiliarityLocale): boolean {
  if (tiers.length === 0 || tiers.length === 3) return true;
  const normalizedTiers = tiers.map(normalizeTier);
  const effectiveTier = locale ? determineTier(person, locale) : normalizeTier(person.tier);
  return normalizedTiers.includes(effectiveTier);
}

/**
 * 4. Länder (Countries):
 * Avgör vilka länder en person är kopplad till utifrån vald kopplingstyp:
 * - 'any': Medborgarskap ELLER född i landet ELLER död i landet
 * - 'citizenship': Medborgarskap (Wikidata P27, inkl. person.swedish för Q34)
 * - 'birth': Födelseortens land (birthPlace.country)
 * - 'death': Dödsortens land (deathPlace.country)
 */
export function getPersonCountryIds(person: Person, mode: CountryMatchMode = 'any'): Set<string> {
  const ids = new Set<string>();

  if (mode === 'any' || mode === 'citizenship') {
    if (person.swedish) ids.add('Q34');
    for (const c of person.citizenship || []) {
      ids.add(canonicalizeCountryId(c.id));
    }
  }

  if (mode === 'any' || mode === 'birth') {
    if (person.birthPlace?.country?.id) {
      ids.add(canonicalizeCountryId(person.birthPlace.country.id));
    }
  }

  if (mode === 'any' || mode === 'death') {
    if (person.deathPlace?.country?.id) {
      ids.add(canonicalizeCountryId(person.deathPlace.country.id));
    }
  }

  return ids;
}

export function matchesCountries(
  person: Person,
  selectedCountries: string[],
  mode: CountryMatchMode = 'any'
): boolean {
  if (selectedCountries.length === 0) return true;
  const personCountries = getPersonCountryIds(person, mode);
  return selectedCountries.some((cId) => personCountries.has(canonicalizeCountryId(cId)));
}

export function toggleCountry(current: string[], clicked: string): string[] {
  const canonical = canonicalizeCountryId(clicked);
  if (current.includes(canonical)) {
    return current.filter((c) => c !== canonical);
  }
  return [...current, canonical];
}

export interface CountryOption {
  id: string;
  label: string;
  flag: string;
  count: number;
}

export function extractAvailableCountries(
  people: Person[],
  lang: 'sv' | 'en',
  mode: CountryMatchMode = 'any'
): CountryOption[] {
  const map = new Map<string, { names: LocalizedText; count: number }>();

  // Samla etiketter från alla personers länder
  const rawNames = new Map<string, LocalizedText>();
  for (const p of people) {
    for (const c of p.citizenship || []) {
      if (!rawNames.has(c.id)) rawNames.set(c.id, c.name);
    }
    if (p.birthPlace?.country) {
      const c = p.birthPlace.country;
      if (!rawNames.has(c.id)) rawNames.set(c.id, c.name);
    }
    if (p.deathPlace?.country) {
      const c = p.deathPlace.country;
      if (!rawNames.has(c.id)) rawNames.set(c.id, c.name);
    }
  }

  for (const p of people) {
    const ids = getPersonCountryIds(p, mode);
    for (const id of ids) {
      if (id === 'Q223050') continue; // hoppa över "statslöshet"
      const existing = map.get(id);
      if (existing) {
        existing.count++;
      } else {
        const names = CANONICAL_COUNTRY_NAMES[id] ?? rawNames.get(id) ?? { sv: id, en: id };
        map.set(id, { names, count: 1 });
      }
    }
  }

  const list: CountryOption[] = [];
  for (const [id, data] of map.entries()) {
    const label = loc(data.names, lang, id);
    list.push({
      id,
      label,
      flag: COUNTRY_FLAGS[id] ?? '🌍',
      count: data.count,
    });
  }

  return list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, lang));
}
