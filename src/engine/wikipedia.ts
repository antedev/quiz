/**
 * Wikipedia Summary / Extract Service
 * 
 * Hämtar korta biografiska sammanfattningar från Wikipedia REST API.
 * 
 * Licens:
 * Wikipedia-text är licensierad under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
 * Detta tillåter fri distribution och anpassning, förutsatt att attribution anges (länk till Wikipedia).
 */

import type { Person } from '../types/person.ts';

export interface WikiSummaryData {
  raw: string;
  sanitized: string;
  title: string;
  lang: 'sv' | 'en';
}

let summariesPromise: Promise<Record<string, WikiSummaryData> | null> | null = null;
let localSummaries: Record<string, WikiSummaryData> | null = null;

/**
 * Läser in lokalt förgenererade Wikipedia-sammanfattningar från public/data/wiki_summaries.json (0 ms fördröjning).
 */
export async function loadLocalWikipediaSummaries(): Promise<Record<string, WikiSummaryData> | null> {
  if (localSummaries) return localSummaries;
  if (!summariesPromise) {
    summariesPromise = fetch('/data/wiki_summaries.json')
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        localSummaries = data;
        return data;
      })
      .catch((err) => {
        console.warn('Kunde inte läsa in wiki_summaries.json:', err);
        return null;
      });
  }
  return summariesPromise;
}

const summaryCache = new Map<string, string>();

export async function fetchWikipediaSummary(
  wikiTitle: string,
  lang: 'sv' | 'en' = 'sv'
): Promise<string | null> {
  if (!wikiTitle) return null;
  const key = `${lang}:${wikiTitle}`;
  if (summaryCache.has(key)) return summaryCache.get(key)!;

  try {
    const domain = lang === 'sv' ? 'sv.wikipedia.org' : 'en.wikipedia.org';
    const url = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (lang === 'sv') {
        // Fallback till engelska om svensk artikel saknas
        return fetchWikipediaSummary(wikiTitle, 'en');
      }
      return null;
    }
    const data = await res.json();
    if (data.extract) {
      summaryCache.set(key, data.extract);
      return data.extract;
    }
  } catch (err) {
    console.warn('Kunde inte läsa sammanfattning från Wikipedia:', err);
  }
  return null;
}

/**
 * Tvättar en Wikipedia-ingress så att den blir en naturlig, fängslande och spoilerfri ledtråd:
 * - Ersätter hela den inledande namnfrasen (inklusive alla mellannamn, födelsedatum, parenteser)
 *   fram till huvudverbet ("var en...", "är en...") med "Personen var en...".
 * - Maskerar eventuella kvarvarande omnämnanden av personens namn i senare meningar.
 */
export function sanitizeWikipediaClue(
  extract: string,
  names: string[],
  lang: 'sv' | 'en' = 'sv'
): string {
  if (!extract) return '';
  let text = extract.trim();

  // 1. Ersätt hela inledande subjektsfrasen fram till verbet:
  // T.ex. "Stig Emil Fredrik Dagerman, född 5 oktober 1923..., var en svensk författare" -> "Personen var en svensk författare"
  const isSv = lang === 'sv';
  const verbRegex = isSv
    ? /^[^.!?\n]{2,140}?\b(var|är|blev|har varit|räknas som)\b/i
    : /^[^.!?\n]{2,140}?\b(was|is|became|has been|is considered)\b/i;

  if (verbRegex.test(text)) {
    text = text.replace(verbRegex, (_match, verb) => {
      return isSv ? `Personen ${verb}` : `The person ${verb}`;
    });
  }

  // 2. Byt ut eventuella kvarvarande förekomster av personens namn i senare meningar
  const sortedNames = [...names]
    .filter((n): n is string => typeof n === 'string' && n.trim().length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const n of sortedNames) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    text = text.replace(regex, isSv ? 'personen' : 'the person');
  }

  // 3. Tvätta bort kvarvarande parenteser med födelse/dödsdatum ifall de smugit med
  text = text.replace(/\([^)]*(?:född|död|born|died|\b\d{4}\b)[^)]*\)/gi, '');

  // 4. Städa upp dubbel-mellanslag och interpunktion
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  // Se till att meningen börjar med stor bokstav
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Hämtar en persons Wikipedia-sammanfattning (både rå och tvättad):
 * 1. Först från förladdad lokal JSON-fil (0 ms)
 * 2. Fallback till direkt REST API-anrop om personen saknas i filen
 */
export async function getPersonWikipediaSummary(
  person: Person,
  lang: 'sv' | 'en' = 'sv'
): Promise<WikiSummaryData | null> {
  // 1. Snabb sökning i lokala sammanfattningar (0 ms)
  const summaries = await loadLocalWikipediaSummaries();
  if (summaries && summaries[person.id]) {
    return summaries[person.id];
  }

  // 2. Fallback till live Wikipedia REST API ifall personen saknas lokalt
  const title =
    person.wiki[lang] ||
    person.wiki.sv ||
    person.wiki.en ||
    person.name.sv ||
    person.name.en;
  if (!title) return null;

  const raw = await fetchWikipediaSummary(title, lang);
  if (!raw) return null;

  const names = [
    person.name.sv,
    person.name.en,
    ...(person.name.sv?.split(/\s+/) || []),
    ...(person.name.en?.split(/\s+/) || []),
  ].filter((n): n is string => typeof n === 'string' && n.trim().length >= 3);

  const sanitized = sanitizeWikipediaClue(raw, names, lang);
  return {
    raw,
    sanitized,
    title,
    lang,
  };
}
