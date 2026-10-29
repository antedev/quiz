/**
 * Steg 2: Hämta detaljer för alla valda personer och refererade entiteter
 * via Wikidatas officiella wbgetentities-API (50 entiteter/anrop).
 * Sparar framsteg inkrementellt till cache.
 *
 * In:  data/selection.json
 * Ut:  data/cache/entities.json
 */
import { join } from 'node:path';
import { CACHE_DIR, DATA_DIR, chunk, httpFetch, readJson, readJsonIfExists, sleep, writeJson } from './lib/util.ts';
import type { Selection } from './01-candidates.ts';

export type Rank = 'preferred' | 'normal';
export interface RawDate { time: string; precision: number; calendar: string; rank: Rank }
export interface RawClaim { value: string; rank: Rank }
export type Texts = Record<string, string>; // språk -> text

export interface RawPerson {
  labels: Texts;
  descriptions: Texts;
  wiki: Texts;
  dates: { P569: RawDate[]; P570: RawDate[] };
  claims: Record<string, RawClaim[]>;
}
export interface RawRef {
  labels: Texts;
  coord?: [number, number];
  country?: string;
}
export interface RawEntities {
  generatedAt: string;
  people: Record<string, RawPerson>;
  refs: Record<string, RawRef>;
}

export const CLAIM_PROPS = ['P21', 'P19', 'P20', 'P106', 'P27', 'P509', 'P1196', 'P800', 'P18'] as const;
const PLACE_PROPS = new Set(['P19', 'P20']);
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

function parseRank(rankStr: string): Rank | null {
  if (rankStr === 'preferred') return 'preferred';
  if (rankStr === 'normal') return 'normal';
  return null; // deprecated
}

async function fetchEntitiesBatch(ids: string[]): Promise<Record<string, any>> {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: ids.join('|'),
    props: 'labels|descriptions|claims|sitelinks',
    languages: 'sv|en',
    sitefilter: 'svwiki|enwiki',
  });

  const res = await httpFetch(`${WIKIDATA_API}?${params.toString()}`, {}, 5, 2000);
  if (!res.ok) throw new Error(`wbgetentities failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.entities || {};
}

async function main() {
  const selection = readJson<Selection>(join(DATA_DIR, 'selection.json'));
  const cacheFile = join(CACHE_DIR, 'entities.json');
  const cached = readJsonIfExists<RawEntities>(cacheFile, {
    generatedAt: new Date().toISOString(),
    people: {},
    refs: {},
  });

  const allIds = selection.people.map((p) => p.id);
  const missingPeopleIds = allIds.filter((id) => !cached.people[id]);

  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const maxToFetch = limitArg ? parseInt(limitArg.split('=')[1] ?? '', 10) || undefined : undefined;
  const toFetchIds = maxToFetch ? missingPeopleIds.slice(0, maxToFetch) : missingPeopleIds;

  if (toFetchIds.length > 0) {
    console.log(`Hämtar data för ${toFetchIds.length} personer (av ${missingPeopleIds.length} som saknas i urvalet på ${allIds.length})...`);
    const batches = chunk(toFetchIds, 50);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const t = Date.now();
      const entities = await fetchEntitiesBatch(batch);

      for (const id of batch) {
        const e = entities[id];
        if (!e) continue;

        const labels: Texts = {};
        if (e.labels?.sv?.value) labels.sv = e.labels.sv.value;
        if (e.labels?.en?.value) labels.en = e.labels.en.value;

        const descriptions: Texts = {};
        if (e.descriptions?.sv?.value) descriptions.sv = e.descriptions.sv.value;
        if (e.descriptions?.en?.value) descriptions.en = e.descriptions.en.value;

        const wiki: Texts = {};
        if (e.sitelinks?.svwiki?.title) wiki.sv = e.sitelinks.svwiki.title;
        if (e.sitelinks?.enwiki?.title) wiki.en = e.sitelinks.enwiki.title;

        const dates = { P569: [] as RawDate[], P570: [] as RawDate[] };
        for (const prop of ['P569', 'P570'] as const) {
          const statements = e.claims?.[prop] || [];
          for (const st of statements) {
            const rank = parseRank(st.rank);
            if (!rank) continue;
            const val = st.mainsnak?.datavalue?.value;
            if (val && typeof val === 'object' && val.time) {
              dates[prop].push({
                time: val.time,
                precision: Number(val.precision ?? 11),
                calendar: val.calendarmodel ?? '',
                rank,
              });
            }
          }
        }

        const claims: Record<string, RawClaim[]> = {};
        for (const prop of CLAIM_PROPS) {
          const statements = e.claims?.[prop] || [];
          const claimList: RawClaim[] = [];
          for (const st of statements) {
            const rank = parseRank(st.rank);
            if (!rank) continue;
            if (prop === 'P18') {
              const val = st.mainsnak?.datavalue?.value;
              if (typeof val === 'string') claimList.push({ value: val, rank });
            } else {
              const val = st.mainsnak?.datavalue?.value?.id;
              if (val && typeof val === 'string') {
                claimList.push({ value: val, rank });
              }
            }
          }
          if (claimList.length > 0) {
            // Begränsa per egenskap för att hålla databasen ren och snabb
            const max = prop === 'P800' ? 6 : prop === 'P106' ? 5 : 4;
            claims[prop] = claimList.slice(0, max);
          }
        }

        cached.people[id] = { labels, descriptions, wiki, dates, claims };
      }

      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      const cachedCount = Object.keys(cached.people).length;
      const pct = Math.round((cachedCount / allIds.length) * 100);
      console.log(`  [Batch ${i + 1}/${batches.length}] +${batch.length} personer (${cachedCount}/${allIds.length} – ${pct}%) [${elapsed}s]`);
      writeJson(cacheFile, cached, false);
      await sleep(650);
    }
  } else {
    console.log(`Alla ${allIds.length} personer fanns redan i cachen.`);
  }

  // Samla refererade entiteter
  const refIds = new Set<string>();
  const placeIds = new Set<string>();
  for (const p of Object.values(cached.people)) {
    for (const prop of CLAIM_PROPS) {
      if (prop === 'P18') continue;
      for (const c of p.claims[prop] || []) {
        refIds.add(c.value);
        if (PLACE_PROPS.has(prop)) placeIds.add(c.value);
      }
    }
  }

  const missingRefIds = [...refIds].filter((id) => !cached.refs[id]);
  console.log(`Totalt ${refIds.size} unika referenser (${placeIds.size} platser). Saknas i cache: ${missingRefIds.length}`);

  if (missingRefIds.length > 0) {
    const refBatches = chunk(missingRefIds, 50);
    for (let i = 0; i < refBatches.length; i++) {
      const batch = refBatches[i]!;
      const entities = await fetchEntitiesBatch(batch);

      for (const id of batch) {
        const e = entities[id];
        if (!e) continue;

        const labels: Texts = {};
        if (e.labels?.sv?.value) labels.sv = e.labels.sv.value;
        if (e.labels?.en?.value) labels.en = e.labels.en.value;

        const ref: RawRef = { labels };

        if (placeIds.has(id)) {
          const coordVal = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
          if (coordVal && typeof coordVal.latitude === 'number' && typeof coordVal.longitude === 'number') {
            ref.coord = [coordVal.latitude, coordVal.longitude];
          }
          const countryVal = e.claims?.P17?.[0]?.mainsnak?.datavalue?.value?.id;
          if (countryVal) {
            ref.country = countryVal;
          }
        }

        cached.refs[id] = ref;
      }

      if ((i + 1) % 2 === 0 || i === refBatches.length - 1) {
        console.log(`  [Referenser ${i + 1}/${refBatches.length}] (${Object.keys(cached.refs).length} referenser sparade)`);
        writeJson(cacheFile, cached, false);
      }
      await sleep(650);
    }
  }

  // Se till att länder också har etiketter
  const missingCountryIds = new Set<string>();
  for (const r of Object.values(cached.refs)) {
    if (r.country && !cached.refs[r.country]) missingCountryIds.add(r.country);
  }
  if (missingCountryIds.size > 0) {
    console.log(`Hämtar ${missingCountryIds.size} länder som saknas...`);
    const cBatches = chunk([...missingCountryIds], 50);
    for (let i = 0; i < cBatches.length; i++) {
      const batch = cBatches[i]!;
      const entities = await fetchEntitiesBatch(batch);
      for (const id of batch) {
        const e = entities[id];
        if (!e) continue;
        const labels: Texts = {};
        if (e.labels?.sv?.value) labels.sv = e.labels.sv.value;
        if (e.labels?.en?.value) labels.en = e.labels.en.value;
        cached.refs[id] = { labels };
      }
      console.log(`  [Länder ${i + 1}/${cBatches.length}]`);
      await sleep(650);
    }
  }

  cached.generatedAt = new Date().toISOString();
  writeJson(cacheFile, cached, false);
  console.log(`Klart: ${cacheFile} (${Object.keys(cached.people).length} personer, ${Object.keys(cached.refs).length} referenser)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
