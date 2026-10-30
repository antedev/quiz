/**
 * Steg 3b: Hämta sidvisningar (pageviews) från Wikipedia (sv, en, m.fl.)
 * via MediaWiki Action API (prop=pageviews, 30 dagar, 50 titlar/batch).
 *
 * Följer Wikimedias API-etikett:
 * - Tydlig User-Agent med kontaktuppgifter (via httpFetch)
 * - Strikt seriella anrop (concurrency = 1, ingen parallellism)
 * - maxlag=5 (avbryter och väntar om Wikimedias databaser har hög last)
 * - Paus mellan anrop samt exponentiell backoff vid 429 / 5xx / maxlag
 * - Inkrementell cache så redan hämtade personer inte hämtas om
 *
 * In:  data/cache/entities.json
 * Ut:  data/cache/pageviews.json
 */
import { join } from 'node:path';
import { CACHE_DIR, chunk, httpFetch, readJson, readJsonIfExists, sleep, writeJson } from './lib/util.ts';
import type { RawEntities } from './02-entities.ts';

export type PageviewsCache = Record<string, Record<string, number>>;

const WIKI_LANGS = ['sv', 'en'] as const;
const BATCH_SIZE = 50;
const DAYS = 30;
const REQUEST_DELAY_MS = 500;

interface PageviewsPage {
  title: string;
  missing?: boolean;
  pageviews?: Record<string, number | null>;
}

interface PageviewsResponse {
  error?: { code?: string; info?: string };
  continue?: Record<string, string>;
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: PageviewsPage[];
  };
}

/**
 * Beräknar ett spik-tåligt 30-dagarsvärde från dagliga sidvisningar.
 * Genom att kapa de 4 högsta toppdagarna (av ~30) filtreras tillfälliga nyhetsspikar
 * (t.ex. dödsfall, årsdagar eller virala nyheter) bort utan att lågfrekventa artiklar
 * tappar upplösning (vilket en ren median skulle ge när många dagar har 0–1 visningar).
 */
export function computeSpikeResistantViews(dailyMap: Record<string, number | null> | undefined): number {
  if (!dailyMap) return 0;
  const days = Object.values(dailyMap)
    .map((v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0))
    .sort((a, b) => a - b);

  if (days.length === 0) return 0;

  // Kapa de högsta ~15 % dagarna (t.ex. 4 dagar av 30) om vi har minst 10 dagar
  const trimTop = days.length >= 10 ? Math.max(1, Math.floor(days.length * 0.15)) : 0;
  const kept = days.slice(0, days.length - trimTop);
  const sum = kept.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / kept.length) * DAYS);
}

async function fetchPageviewsBatch(lang: string, titles: string[]): Promise<Map<string, number>> {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const accumulatedDaily = new Map<string, Record<string, number | null>>();
  const redirectMap = new Map<string, string>();

  let continueParams: Record<string, string> | undefined;

  while (true) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'pageviews',
      pvipdays: String(DAYS),
      redirects: '1',
      maxlag: '5',
      titles: titles.join('|'),
    });
    if (continueParams) {
      for (const [k, v] of Object.entries(continueParams)) {
        params.set(k, v);
      }
    }

    const res = await httpFetch(`${api}?${params.toString()}`, {}, 5, 1500);
    const json = (await res.json()) as PageviewsResponse;

    if (json.error?.code === 'maxlag') {
      const retryAfter = Number(res.headers.get('retry-after')) || 5;
      console.warn(`  ! MediaWiki maxlag på ${lang}.wikipedia – väntar ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      continue;
    }

    for (const n of json.query?.normalized ?? []) {
      redirectMap.set(n.from, n.to);
    }
    for (const r of json.query?.redirects ?? []) {
      redirectMap.set(r.from, r.to);
    }

    for (const page of json.query?.pages ?? []) {
      if (page.missing || !page.pageviews) continue;
      const prev = accumulatedDaily.get(page.title) ?? {};
      accumulatedDaily.set(page.title, { ...prev, ...page.pageviews });
    }

    if (json.continue) {
      continueParams = json.continue;
      await sleep(250);
    } else {
      break;
    }
  }

  // Lös upp kedjade normaliseringar/omdirigeringar (A -> B -> C)
  const resolveTitle = (rawTitle: string): string => {
    let cur = rawTitle;
    const seen = new Set<string>();
    while (redirectMap.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = redirectMap.get(cur)!;
    }
    return cur;
  };

  const result = new Map<string, number>();
  for (const requestedTitle of titles) {
    const canonical = resolveTitle(requestedTitle);
    const daily = accumulatedDaily.get(canonical) ?? accumulatedDaily.get(requestedTitle);
    result.set(requestedTitle, computeSpikeResistantViews(daily));
  }

  return result;
}

async function main() {
  const entities = readJson<RawEntities>(join(CACHE_DIR, 'entities.json'));
  const cachePath = join(CACHE_DIR, 'pageviews.json');
  const cache = readJsonIfExists<PageviewsCache>(cachePath, {});

  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const maxToFetch = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) || undefined : undefined;

  for (const lang of WIKI_LANGS) {
    const todo: { id: string; title: string }[] = [];
    for (const [id, person] of Object.entries(entities.people)) {
      const title = person.wiki?.[lang];
      if (!title) continue;
      if (cache[id] && typeof cache[id][lang] === 'number') continue;
      todo.push({ id, title });
    }

    const slice = maxToFetch ? todo.slice(0, maxToFetch) : todo;
    console.log(`[${lang}.wikipedia] ${slice.length} artiklar att hämta (av ${todo.length} som saknas i cache)...`);
    if (slice.length === 0) continue;

    const batches = chunk(slice, BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const t0 = Date.now();
      const viewsByTitle = await fetchPageviewsBatch(
        lang,
        batch.map((b) => b.title)
      );

      for (const item of batch) {
        const views = viewsByTitle.get(item.title) ?? 0;
        cache[item.id] ??= {};
        cache[item.id]![lang] = views;
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if ((i + 1) % 5 === 0 || i === batches.length - 1) {
        console.log(`  [${lang}.wiki ${i + 1}/${batches.length}] Sparat (${Object.keys(cache).length} personer i cache) [${elapsed}s]`);
        writeJson(cachePath, cache, false);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  writeJson(cachePath, cache, false);
  console.log(`Klart: ${cachePath} (${Object.keys(cache).length} personer med sidvisningar)`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('pipeline/03b-pageviews.ts');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
