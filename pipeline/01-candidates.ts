/**
 * Steg 1: Hämta kandidater (människor sorterade på antal Wikipedia-språk) och välj ut
 * Gissnings-poolen (Nivå 1) och Referens-poolen (Nivå 2).
 *
 * Ut: data/cache/candidates.json (rå kandidatlista), data/selection.json (valda ID:n + nivå)
 */
import { join } from 'node:path';
import { config } from './config.ts';
import { sparql, qid } from './lib/sparql.ts';
import { CACHE_DIR, DATA_DIR, readJson, writeJson } from './lib/util.ts';
import type { PoolTier } from '../src/types/person.ts';

export interface Candidate {
  id: string;
  sitelinks: number;
  birthYear: number;
  dead: boolean;
  swedish: boolean;
  svwiki: boolean;
}

export interface Overrides {
  forceGuess: string[];
  forceReference: string[];
  exclude: string[];
  patches: Record<string, unknown>;
}

export interface Selection {
  generatedAt: string;
  people: { id: string; tier: PoolTier }[];
}

const swedishFilter = config.swedishCountries.map((c) => `wd:${c}`).join(', ');

function candidateQuery(onlySwedish: boolean, limit: number): string {
  return `
SELECT ?item ?sl (MIN(YEAR(?b)) AS ?by) (SAMPLE(?d) AS ?dead) (SAMPLE(?c) AS ?se) (SAMPLE(?sv) AS ?svwiki) WHERE {
  ?item wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl ; wdt:P569 ?b .
  ${onlySwedish ? `?item wdt:P27 ?c . FILTER(?c IN (${swedishFilter}))` : `OPTIONAL { ?item wdt:P27 ?c . FILTER(?c IN (${swedishFilter})) }`}
  OPTIONAL { ?item wdt:P570 ?d }
  OPTIONAL { ?sv schema:about ?item ; schema:isPartOf <https://sv.wikipedia.org/> }
}
GROUP BY ?item ?sl ORDER BY DESC(?sl) LIMIT ${limit}`;
}

async function fetchCandidates(): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();
  for (const [label, swedishOnly, limit] of [
    ['globala', false, config.globalCandidateLimit],
    ['svenska', true, config.swedishCandidateLimit],
  ] as const) {
    console.log(`Hämtar ${label} kandidater (topp ${limit})...`);
    const t = Date.now();
    const rows = await sparql(candidateQuery(swedishOnly, limit));
    console.log(`  ${rows.length} rader på ${((Date.now() - t) / 1000).toFixed(1)}s`);
    for (const r of rows) {
      const id = qid(r.item!.value);
      const c: Candidate = {
        id,
        sitelinks: Number(r.sl!.value),
        birthYear: r.by ? Number(r.by.value) : NaN,
        dead: !!r.dead,
        swedish: !!r.se,
        svwiki: !!r.svwiki,
      };
      const prev = byId.get(id);
      if (!prev || c.sitelinks > prev.sitelinks) byId.set(id, { ...c, swedish: c.swedish || !!prev?.swedish });
    }
  }
  return [...byId.values()].sort((a, b) => b.sitelinks - a.sitelinks);
}

const century = (year: number) => Math.floor(year / 100) * 100;

function isEligible(c: Candidate): boolean {
  if (!Number.isFinite(c.birthYear)) return false;
  if (c.birthYear < config.minBirthYear || c.birthYear > config.maxBirthYear) return false;
  // Utan dödsdatum: bara giltig som levande om personen är född efter gränsen.
  if (!c.dead && c.birthYear <= config.livingBornAfter) return false;
  return true;
}

/**
 * Väljer en pool i prioritetsordning:
 * 1) tvingade ID:n, 2) minimum per sekel, 3) svensk kvot, 4) fyll på efter sitelinks.
 * Levande personer begränsas med maxLiving.
 */
function pickPool(
  pool: Candidate[],
  size: number,
  opts: { forced: string[]; perCentury: Record<number, number>; swedishShare: number; maxLiving: number },
): Candidate[] {
  const chosen = new Map<string, Candidate>();
  const byId = new Map(pool.map((c) => [c.id, c]));
  let living = 0;
  const add = (c: Candidate) => {
    if (chosen.has(c.id)) return false;
    if (!c.dead && living >= opts.maxLiving) return false;
    chosen.set(c.id, c);
    if (!c.dead) living++;
    return true;
  };

  for (const id of opts.forced) {
    const c = byId.get(id);
    if (c) add(c);
    else console.warn(`  ! Tvingat ID ${id} finns inte bland kandidaterna (öka candidateLimit?)`);
  }

  for (const [cent, min] of Object.entries(opts.perCentury)) {
    let n = [...chosen.values()].filter((c) => century(c.birthYear) === Number(cent)).length;
    for (const c of pool) {
      if (n >= min) break;
      if (century(c.birthYear) === Number(cent) && add(c)) n++;
    }
  }

  const swedishTarget = Math.round(size * opts.swedishShare);
  let se = [...chosen.values()].filter((c) => c.swedish).length;
  for (const c of pool) {
    if (se >= swedishTarget) break;
    if (c.swedish && add(c)) se++;
  }

  for (const c of pool) {
    if (chosen.size >= size) break;
    add(c);
  }
  return [...chosen.values()];
}

async function main() {
  const candidates = await fetchCandidates();
  writeJson(join(CACHE_DIR, 'candidates.json'), candidates, false);
  console.log(`Totalt ${candidates.length} unika kandidater.`);

  const overrides = readJson<Overrides>(join(DATA_DIR, 'overrides.json'));
  const excluded = new Set(overrides.exclude);
  const eligible = candidates.filter((c) => isEligible(c) && !excluded.has(c.id));
  console.log(`${eligible.length} uppfyller kriterierna (födda ${config.minBirthYear}–${config.maxBirthYear}).`);

  const guess = pickPool(eligible, config.guessPoolSize, {
    forced: overrides.forceGuess,
    perCentury: config.minGuessPerCentury,
    swedishShare: config.swedishShare,
    maxLiving: config.maxLivingInGuess,
  });
  const guessIds = new Set(guess.map((c) => c.id));
  const rest = eligible.filter((c) => !guessIds.has(c.id));
  const reference = pickPool(rest, config.referencePoolSize, {
    forced: overrides.forceReference.filter((id) => !guessIds.has(id)),
    perCentury: Object.fromEntries(Object.entries(config.minGuessPerCentury).map(([k, v]) => [k, v * 2])),
    swedishShare: config.swedishShare,
    maxLiving: config.maxLivingInGuess * 2,
  });

  const selection: Selection = {
    generatedAt: new Date().toISOString(),
    people: [
      ...guess.map((c) => ({ id: c.id, tier: 'guess' as const })),
      ...reference.map((c) => ({ id: c.id, tier: 'reference' as const })),
    ],
  };
  writeJson(join(DATA_DIR, 'selection.json'), selection);

  const summarize = (list: Candidate[]) => {
    const perCentury: Record<string, number> = {};
    for (const c of list) perCentury[century(c.birthYear)] = (perCentury[century(c.birthYear)] ?? 0) + 1;
    return {
      total: list.length,
      swedish: list.filter((c) => c.swedish).length,
      living: list.filter((c) => !c.dead).length,
      minSitelinks: Math.min(...list.map((c) => c.sitelinks)),
      perCentury,
    };
  };
  console.log('Gissnings-pool:', summarize(guess));
  console.log('Referens-pool:', summarize(reference));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
