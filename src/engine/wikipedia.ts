/**
 * Wikipedia Summary / Extract Service
 *
 * Hämtar korta biografiska sammanfattningar från Wikipedia REST API
 * eller förgenererad lokal JSON-fil.
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
      .then((data: Record<string, WikiSummaryData>) => {
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
const sanitizedPersonCache = new Map<string, WikiSummaryData>();

export async function fetchWikipediaSummary(
  wikiTitle: string,
  lang: 'sv' | 'en' = 'sv'
): Promise<string | null> {
  if (!wikiTitle) return null;
  const cleanTitle = wikiTitle.replace(/ /g, '_');
  const key = `${lang}:${cleanTitle}`;
  if (summaryCache.has(key)) return summaryCache.get(key)!;

  try {
    const domain = lang === 'sv' ? 'sv.wikipedia.org' : 'en.wikipedia.org';
    const url = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (data.extract) {
      const cleaned = cleanExtractParagraphs(data.extract);
      summaryCache.set(key, cleaned);
      return cleaned;
    }
  } catch (err) {
    console.warn('Kunde inte läsa sammanfattning från Wikipedia:', err);
  }
  return null;
}

/**
 * Filtrerar bort disambigueringar och namnkonventions-notiser (hatnotes) överst i Wikipedia-artiklar.
 */
export function cleanExtractParagraphs(extract: string): string {
  if (!extract) return '';
  const inlineHatnotePrefix =
    /^(?:Uppslagsord(?:et|en)\b[^.!?]*[.!?]|För andra betydelser\b[^.!?]*[.!?]|(?:Den här|Denna) (?:artikeln?|sidan?) handlar om\b[^.!?]*[.!?]|För\s+[^.!?]{2,120},\s*se\b[^.!?]*[.!?]|Artikeln följer\b[^.!?]*[.!?]|(?:Det här|Detta) är en artikel om\b[^.!?]*[.!?]|Ej att förväxla med\b[^.!?]*[.!?]|Se (?:även|också)\b[^.!?]*[.!?]|"[^"]+"[^.!?]*omdirigerar hit[^.!?]*[.!?]|This article is about\b[^.!?]*[.!?]|For other uses\b[^.!?]*[.!?]|Not to be confused with\b[^.!?]*[.!?]|In this (?:Spanish|Japanese|Chinese|Korean|Eastern|Icelandic) name\b[^.!?]*[.!?])\s*/i;

  const paragraphs = extract
    .split(/\n+/)
    .map((p) => p.trim().replace(inlineHatnotePrefix, '').trim())
    .filter(Boolean);

  const clean = paragraphs.filter((p) => {
    if (/^Uppslagsord(?:et|en)\b/i.test(p)) return false;
    if (/^För andra betydelser\b/i.test(p)) return false;
    if (/^(?:Den här|Denna) (?:artikeln?|sidan?) handlar om\b/i.test(p)) return false;
    if (/^För\s+[^.!?]{2,120},\s*se\b/i.test(p)) return false;
    if (/^För (?:artikeln om|staden|filmen|boken|andra)\b/i.test(p)) return false;
    if (/^Artikeln följer\b/i.test(p)) return false;
    if (/^(?:Det här|Detta) är en artikel om\b/i.test(p)) return false;
    if (/^Ej att förväxla med\b/i.test(p)) return false;
    if (/^Se (?:även|också)\b/i.test(p)) return false;
    if (/^"[^"]+"[^.!?]*omdirigerar hit/i.test(p)) return false;
    if (/^This article is about\b/i.test(p)) return false;
    if (/^For other uses\b/i.test(p)) return false;
    if (/^Not to be confused with\b/i.test(p)) return false;
    if (/^In this (?:Spanish|Japanese|Chinese|Korean|Eastern|Icelandic) name\b/i.test(p)) return false;
    return true;
  });

  // Ta max de 2 första styckena för att hålla ledtråden koncis
  return clean.slice(0, 2).join('\n\n').trim();
}

/**
 * Ord i namn som är vanliga binamn/prepositioner/titlar och INTE ska maskeras som fristående ord i brödtexten
 * (t.ex. "Karl den store" -> maskera "Karl" och "Karl den store", men inte varje "den" eller "store" i texten!).
 */
const NAME_TOKEN_STOPWORDS = new Set([
  'den', 'det', 'de', 'dem', 'och', 'att', 'som', 'för', 'av', 'af', 'von', 'van', 'der', 'del', 'della', 'degli', 'di', 'da', 'dos', 'das', 'du', 'des', 'la', 'le', 'les', 'el', 'al', 'ibn', 'bin', 'abu', 'abd',
  'store', 'stora', 'äldre', 'yngre', 'gamle', 'helige', 'heliga', 'gode', 'kloke', 'sköne', 'långe', 'korte', 'fromme', 'rättvise', 'grymme', 'modige', 'erövraren',
  'the', 'and', 'of', 'for', 'great', 'elder', 'younger', 'old', 'holy', 'good', 'wise', 'fair', 'tall', 'short', 'pious', 'just', 'cruel', 'bold', 'conqueror',
  'kung', 'drottning', 'prins', 'prinsessa', 'hertig', 'greve', 'friherre', 'baron', 'jarl', 'kejsare', 'tsar', 'sultan', 'khan', 'shah', 'farao', 'påve', 'biskop', 'helgon', 'abbé', 'pasha', 'bey', 'emir', 'kalif', 'imam', 'guru', 'swami', 'mahatma',
  'king', 'queen', 'prince', 'princess', 'duke', 'duchess', 'count', 'earl', 'baron', 'emperor', 'empress', 'pope', 'saint', 'sir', 'lord', 'lady', 'dame', 'don', 'dona',
  'person', 'personen', 'personens',
  'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx',
]);

/**
 * Extraherar en säker lista på personens fullständiga namn och unika delnamn för maskering.
 */
export function extractPersonMaskNames(person: Pick<Person, 'name'> & { wiki?: Person['wiki'] }): string[] {
  const fullNames = [
    person.name.sv,
    person.name.en,
    person.wiki?.sv?.replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*/g, ''),
    person.wiki?.en?.replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*/g, ''),
  ].filter((n): n is string => typeof n === 'string' && n.trim().length >= 2);

  const tokens: string[] = [];
  for (const full of fullNames) {
    for (const rawPart of full.split(/[\s,–—-]+/)) {
      const part = rawPart.replace(/^[("']+|[)"'.]+$/g, '').trim();
      if (part.length >= 3 && !NAME_TOKEN_STOPWORDS.has(part.toLowerCase())) {
        tokens.push(part);
      }
    }
  }

  return [...new Set([...fullNames, ...tokens])];
}

/**
 * Ersätter den inledande subjektsfrasen fram till första huvudverbet (utanför parenteser).
 */
function replaceIntroSubject(text: string, isSv: boolean): string {
  // Hitta positioner utanför (...) och [...] inom de första 500 tecknen
  const limit = Math.min(text.length, 500);
  let depth = 0;

  // Bygg en mask där tecken inuti parenteser är ersatta med mellanslag av samma längd,
  // så att vi kan matcha huvudverbet utanför parenteser med exakt index!
  let masked = '';
  for (let i = 0; i < limit; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') {
      depth++;
      masked += ' ';
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      masked += ' ';
    } else if (depth > 0) {
      masked += ' ';
    } else {
      masked += ch;
    }
  }

  const verbPattern = isSv
    ? /(?<=\s)(var|är|blev|har varit|räknas som|anses vara|antas vara)(?=\s)/i
    : /(?<=\s)(was|is|became|has been|is considered)(?=\s)/i;

  const match = verbPattern.exec(masked);
  if (match && match.index !== undefined) {
    // Kontrollera att det inte finns en riktig meningspunkt före verbet i den omaskerade delen
    // (tillåt förkortningar som "S.", "J.P.", "St.", "D.C.", "eg.", "el.", "nuv.", "prof.", "dr." etc.)
    const beforeVerbMasked = masked.slice(0, match.index);
    const cleanedAbbrevs = beforeVerbMasked
      .replace(
        /\b(?:[A-ZÅÄÖ]\.|St\.|S:t|Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.|Jr\.|Sr\.|fr\.|eng\.|lat\.|ty\.|ry\.|ca\.|c\.|f\.|d\.|eg\.|el\.|nuv\.|urspr\.|g\.s\.|n\.s\.|f\.Kr\.|e\.Kr\.|f\.d\.|bl\.a\.|m\.fl\.|m\.m\.|osv\.|t\.ex\.)/gi,
        ' '
      )
      .trim();

    if (!/[.!?]\s+[A-ZÅÄÖ]/.test(cleanedAbbrevs)) {
      const verb = text.slice(match.index, match.index + match[0].length);
      const rest = text.slice(match.index + match[0].length);
      return (isSv ? `Personen ${verb}` : `The person ${verb}`) + rest;
    }
  }

  // Fallback för uppslagsverks-artiklar utan hjälpverb ("Namn, född X i Y, död Z i W, svensk målare...")
  if (isSv) {
    const verblessMatch = /^[^.!?]{3,160}?\bdöd\b[^.!?]{3,160}?(?:,\s*|\.\s+)/i.exec(masked);
    if (verblessMatch) {
      const rest = text.slice(verblessMatch[0].length);
      if (rest.length > 0) {
        const loweredFirst = rest.charAt(0).toLowerCase() + rest.slice(1);
        return `Personen var ${loweredFirst}`;
      }
    }
  }

  return text;
}

/**
 * Tvättar en Wikipedia-ingress så att den blir en naturlig, fängslande och spoilerfri ledtråd:
 * - Filtrerar bort hatnotes ("Artikeln följer den spanska namnseden..." etc.).
 * - Ersätter hela den inledande namnfrasen (inklusive alla mellannamn, födelsedatum, parenteser)
 *   fram till huvudverbet ("var en...", "är en...") med "Personen var/är en...".
 * - Maskerar eventuella kvarvarande omnämnanden av personens namn (inkl. genitiv -s och diakriter) i senare meningar.
 */
export function sanitizeWikipediaClue(
  extract: string,
  namesOrPerson: string[] | (Pick<Person, 'name'> & { wiki?: Person['wiki'] }),
  lang: 'sv' | 'en' = 'sv'
): string {
  if (!extract) return '';
  const isSv = lang === 'sv';
  let text = cleanExtractParagraphs(extract);
  if (!text) return '';

  // 1. Ersätt hela inledande subjektsfrasen fram till huvudverbet (utanför parenteser)
  text = replaceIntroSubject(text, isSv);

  // 2. Byt ut eventuella kvarvarande förekomster av personens namn i senare meningar
  // Använder Unicode-medvetna ordgränser (\p{L}\p{N}) och fångar även genitiv-s (t.ex. "Linnés" -> "personens")
  const names = Array.isArray(namesOrPerson) ? namesOrPerson : extractPersonMaskNames(namesOrPerson);
  const filteredNames = [...new Set(names)]
    .map((n) => n?.trim())
    .filter((n): n is string => Boolean(n && n.length >= 3 && !NAME_TOKEN_STOPWORDS.has(n.toLowerCase())))
    .sort((a, b) => b.length - a.length);

  for (const n of filteredNames) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=^|[^\\p{L}\\p{N}])(${escaped})(s|'s)?(?=[^\\p{L}\\p{N}]|$)`, 'gui');
    text = text.replace(regex, (_full, _base, genitive) => {
      if (genitive) {
        return isSv ? 'personens' : "the person's";
      }
      return isSv ? 'personen' : 'the person';
    });
  }

  // 3. Tvätta bort kvarvarande parenteser med födelse/dödsdatum ifall de smugit med
  text = text.replace(/\([^)]*(?:född|död|born|died|\b\d{4}\b)[^)]*\)/gi, '');

  // 4. Städa upp upprepade "personen personen" (t.ex. om förnamn + efternamn stod separat)
  text = text
    .replace(/\b(personen)\s+personen(s?)\b/gi, 'personen$2')
    .replace(/\b(the person)\s+the person('s)?\b/gi, 'the person$2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  // 5. Se till att meningsstarter efter punkt har stor bokstav ("... i Paris. personen blev..." -> "... i Paris. Personen blev...")
  text = text.replace(/(^|[.!?]\s+)(personen|the person)\b/gi, (_m, prefix, word) => {
    const cap = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    return `${prefix}${cap}`;
  });

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Hämtar en persons Wikipedia-sammanfattning (både rå och tvättad) på begärt språk:
 * 1. Först från förladdad lokal JSON-fil om språket matchar (0 ms)
 * 2. Annars via direkt Wikipedia REST API på begärt språk (med fallback till det andra språket)
 */
export async function getPersonWikipediaSummary(
  person: Person,
  lang: 'sv' | 'en' = 'sv'
): Promise<WikiSummaryData | null> {
  const cacheKey = `${person.id}:${lang}`;
  if (sanitizedPersonCache.has(cacheKey)) {
    return sanitizedPersonCache.get(cacheKey)!;
  }

  // 1. Snabb sökning i lokala sammanfattningar (0 ms) om språket stämmer
  const summaries = await loadLocalWikipediaSummaries();
  const localEntry = summaries ? summaries[person.id] : undefined;
  if (localEntry && localEntry.lang === lang) {
    sanitizedPersonCache.set(cacheKey, localEntry);
    return localEntry;
  }

  // 2. Om efterfrågat språk saknas i lokal fil (t.ex. användaren valt 'en' men lokal fil har 'sv'),
  // hämta direkt från rätt språkversion av Wikipedia
  const preferredTitle = person.wiki[lang] || person.name[lang];
  if (preferredTitle) {
    const raw = await fetchWikipediaSummary(preferredTitle, lang);
    if (raw) {
      const names = extractPersonMaskNames(person);
      const sanitized = sanitizeWikipediaClue(raw, names, lang);
      const result: WikiSummaryData = {
        raw,
        sanitized,
        title: preferredTitle,
        lang,
      };
      sanitizedPersonCache.set(cacheKey, result);
      return result;
    }
  }

  // 3. Fallback till lokal sammanfattning på det andra språket om den finns
  if (localEntry) {
    sanitizedPersonCache.set(cacheKey, localEntry);
    return localEntry;
  }

  // 4. Sista fallback: prova andra språkets titel mot REST API
  const fallbackLang: 'sv' | 'en' = lang === 'sv' ? 'en' : 'sv';
  const fallbackTitle = person.wiki[fallbackLang] || person.name[fallbackLang];
  if (fallbackTitle) {
    const raw = await fetchWikipediaSummary(fallbackTitle, fallbackLang);
    if (raw) {
      const names = extractPersonMaskNames(person);
      const sanitized = sanitizeWikipediaClue(raw, names, fallbackLang);
      const result: WikiSummaryData = {
        raw,
        sanitized,
        title: fallbackTitle,
        lang: fallbackLang,
      };
      sanitizedPersonCache.set(cacheKey, result);
      return result;
    }
  }

  return null;
}
