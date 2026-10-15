/**
 * Steg 5: Hämta och förbereda biografiska Wikipedia-sammanfattningar.
 *
 * In:  public/data/people.json
 * Ut:  public/data/wiki_summaries.json (kompakt lexikon för spelet)
 *      data/cache/wikipedia_raw.json   (persistent cache)
 */
import { join } from 'node:path';
import {
  CACHE_DIR,
  PUBLIC_DATA_DIR,
  chunk,
  httpFetch,
  readJson,
  readJsonIfExists,
  sleep,
  writeJson,
} from './lib/util.ts';
import type { PeopleDataset, Person } from '../src/types/person.ts';

export interface WikiSummaryEntry {
  raw: string; // Ocensurerad sammanfattning för vinst/avslutningsvyn
  sanitized: string; // Tvättad ledtråd utan namn eller årtalsspoilers
  title: string;
  lang: 'sv' | 'en';
}

export type WikiSummaryMap = Record<string, WikiSummaryEntry>;

interface ActionQueryPage {
  pageid: number;
  ns: number;
  title: string;
  extract?: string;
  missing?: boolean;
}

interface ActionQueryResponse {
  query?: {
    pages?: Record<string, ActionQueryPage>;
    redirects?: { from: string; to: string }[];
    normalized?: { from: string; to: string }[];
  };
}

export function cleanExtractParagraphs(extract: string): string {
  if (!extract) return '';
  const paragraphs = extract
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const clean = paragraphs.filter((p) => {
    if (/^Uppslagsord(?:et|en)\b/i.test(p)) return false;
    if (/^För andra betydelser\b/i.test(p)) return false;
    if (/^Den här artikeln handlar om\b/i.test(p)) return false;
    if (/^För (?:artikeln om|staden|filmen|boken)\b/i.test(p)) return false;
    if (/^This article is about\b/i.test(p)) return false;
    if (/^For other uses\b/i.test(p)) return false;
    return true;
  });

  // Ta max de 2 första styckena för att hålla ledtråden koncis
  let text = clean.slice(0, 2).join('\n\n');
  return text.trim();
}

export function sanitizeExtract(
  text: string,
  person: Person,
  lang: 'sv' | 'en' = 'sv'
): string {
  if (!text) return '';
  let out = text;

  const isSv = lang === 'sv';

  // 1. Ersätt hela inledande namn- och subjektsfrasen fram till verbet:
  // "Stig Emil Fredrik Dagerman, född 5 oktober 1923..., var en svensk författare..."
  // -> "Personen var en svensk författare..."
  const verbRegex = isSv
    ? /^[^.!?\n]+?\b(var|är|blev|har varit|räknas som)\b/i
    : /^[^.!?\n]+?\b(was|is|became|has been|is considered)\b/i;

  if (verbRegex.test(out)) {
    out = out.replace(verbRegex, (_match, verb) => {
      return isSv ? `Personen ${verb}` : `The person ${verb}`;
    });
  }

  // 2. Ersätt eventuella ytterligare förekomster av personens namn i senare meningar
  const names = [
    person.name.sv,
    person.name.en,
    ...(person.name.sv?.split(/\s+/) || []),
    ...(person.name.en?.split(/\s+/) || []),
  ].filter((n): n is string => typeof n === 'string' && n.trim().length >= 3);

  const sortedNames = [...new Set(names)].sort((a, b) => b.length - a.length);
  for (const n of sortedNames) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    out = out.replace(regex, isSv ? 'personen' : 'the person');
  }

  // 3. Tvätta bort kvarvarande parenteser med födelse/dödsdatum
  out = out.replace(/\([^)]*(?:född|död|born|died|\b\d{4}\b)[^)]*\)/gi, '');

  // 4. Städa upp dubbel-mellanslag och interpunktion
  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  if (out.length > 0) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }

  return out;
}

async function fetchWikiBatch(
  titles: string[],
  lang: 'sv' | 'en'
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (titles.length === 0) return result;

  const domain = lang === 'sv' ? 'sv.wikipedia.org' : 'en.wikipedia.org';
  const url = `https://${domain}/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&exlimit=max&redirects=1&format=json&titles=${encodeURIComponent(
    titles.join('|')
  )}`;

  try {
    const res = await httpFetch(url, {}, 3, 1000);
    if (!res.ok) {
      console.warn(`  ! Wikipedia API ${domain} returnerade HTTP ${res.status}`);
      return result;
    }
    const data = (await res.json()) as ActionQueryResponse;
    const pages = Object.values(data.query?.pages ?? {});

    // Redirect mapping (from -> to)
    const redirectMap = new Map<string, string>();
    for (const r of data.query?.redirects ?? []) {
      redirectMap.set(r.from, r.to);
    }
    for (const n of data.query?.normalized ?? []) {
      redirectMap.set(n.from, n.to);
    }

    const titleToExtract = new Map<string, string>();
    for (const p of pages) {
      if (p.missing || !p.extract) continue;
      const clean = cleanExtractParagraphs(p.extract);
      if (clean) {
        titleToExtract.set(p.title, clean);
      }
    }

    // Mappa tillbaka till de efterfrågade titlarna
    for (const requestedTitle of titles) {
      const normalizedOrRedirected = redirectMap.get(requestedTitle) || requestedTitle;
      const extract =
        titleToExtract.get(normalizedOrRedirected) ||
        titleToExtract.get(requestedTitle);
      if (extract) {
        result.set(requestedTitle, extract);
      }
    }
  } catch (err) {
    console.warn(`  ! Fel vid hämtning av batch från ${domain}:`, err);
  }

  return result;
}

async function main() {
  console.log('📖 Steg 5: Wikipedia-sammanfattningar');

  const dataset = readJson<PeopleDataset>(join(PUBLIC_DATA_DIR, 'people.json'));
  const cachePath = join(CACHE_DIR, 'wikipedia_raw.json');
  const cache = readJsonIfExists<Record<string, { title: string; extract: string; lang: 'sv' | 'en' }>>(
    cachePath,
    {}
  );

  console.log(`  Totalt ${dataset.people.length} personer i databasen.`);
  console.log(`  ${Object.keys(cache).length} redan cachade.`);

  // 1. Samla titlar som behöver hämtas på svenska
  const svToFetch: { personId: string; title: string }[] = [];
  const enFallbackCandidates: { personId: string; title: string }[] = [];

  for (const p of dataset.people) {
    const existing = cache[p.id];
    // Om vi redan har den på svenska är vi helt klara
    if (existing && existing.lang === 'sv') continue;

    if (p.wiki?.sv) {
      svToFetch.push({ personId: p.id, title: p.wiki.sv });
    } else if (p.wiki?.en && !existing) {
      enFallbackCandidates.push({ personId: p.id, title: p.wiki.en });
    }
  }

  // Hämta svenska Wikipedia-artiklar i batchar om 20 (Wikipedias maxgräns för extracts)
  if (svToFetch.length > 0) {
    console.log(`  Hämtar ${svToFetch.length} artiklar från sv.wikipedia.org...`);
    const batches = chunk(svToFetch, 20);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const titles = batch.map((b) => b.title);
      const results = await fetchWikiBatch(titles, 'sv');

      for (const item of batch) {
        const extract = results.get(item.title);
        if (extract) {
          cache[item.personId] = { title: item.title, extract, lang: 'sv' };
        } else {
          // Saknas på svenska, lägg till för engelsk fallback
          const person = dataset.people.find((p) => p.id === item.personId);
          if (person?.wiki?.en) {
            enFallbackCandidates.push({ personId: item.personId, title: person.wiki.en });
          }
        }
      }

      if ((i + 1) % 10 === 0 || i === batches.length - 1) {
        console.log(`    Batch ${i + 1}/${batches.length} klara (${Object.keys(cache).length} sparade i cache)`);
        writeJson(cachePath, cache, false);
      }
      await sleep(150);
    }
  }

  // Hämta engelska fallback-artiklar
  const neededEn = enFallbackCandidates.filter((item) => !cache[item.personId] || cache[item.personId]?.lang !== 'sv');
  if (neededEn.length > 0) {
    console.log(`  Hämtar ${neededEn.length} artiklar från en.wikipedia.org (fallback)...`);
    const batches = chunk(neededEn, 20);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const titles = batch.map((b) => b.title);
      const results = await fetchWikiBatch(titles, 'en');

      for (const item of batch) {
        const extract = results.get(item.title);
        if (extract) {
          cache[item.personId] = { title: item.title, extract, lang: 'en' };
        }
      }

      if ((i + 1) % 10 === 0 || i === batches.length - 1) {
        console.log(`    Engelsk batch ${i + 1}/${batches.length} klara`);
        writeJson(cachePath, cache, false);
      }
      await sleep(150);
    }
  }

  writeJson(cachePath, cache, false);
  console.log(`  Totalt ${Object.keys(cache).length} artiklar cachade.`);

  // 2. Bygg det färdiga, tvättade lexikonet för spelet
  const output: WikiSummaryMap = {};
  let countSv = 0;
  let countEn = 0;

  for (const person of dataset.people) {
    const cached = cache[person.id];
    if (!cached || !cached.extract) continue;

    const sanitized = sanitizeExtract(cached.extract, person, cached.lang);
    output[person.id] = {
      raw: cached.extract,
      sanitized,
      title: cached.title,
      lang: cached.lang,
    };

    if (cached.lang === 'sv') countSv++;
    else countEn++;
  }

  const outputPath = join(PUBLIC_DATA_DIR, 'wiki_summaries.json');
  writeJson(outputPath, output, false);

  console.log(`\n✅ Färdigt! Sparade ${Object.keys(output).length} sammanfattningar till public/data/wiki_summaries.json`);
  console.log(`   - Svenska: ${countSv}`);
  console.log(`   - Engelska (fallback): ${countEn}`);
  console.log(`   - Saknas: ${dataset.people.length - Object.keys(output).length}`);
}

main().catch((err) => {
  console.error('Kritiskt fel i pipeline/05-wikipedia.ts:', err);
  process.exit(1);
});
