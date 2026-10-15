/**
 * Steg 4: Bygg den färdiga databasen som spelet läser.
 *
 * In:  data/selection.json, data/cache/entities.json, data/cache/media.json, data/overrides.json
 * Ut:  public/data/people.json  (kompakt, laddas av spelet)
 *      data/report.json         (statistik + datakvalitetsproblem)
 */
import { join } from 'node:path';
import { config } from './config.ts';
import { cleanDescription } from './lib/clean.ts';
import { bestDate } from './lib/dates.ts';
import { CACHE_DIR, DATA_DIR, PUBLIC_DATA_DIR, readJson, readJsonIfExists, writeJson } from './lib/util.ts';
import { pickImage } from './03-media.ts';
import type { Overrides, Selection } from './01-candidates.ts';
import type { RawClaim, RawEntities, Texts } from './02-entities.ts';
import type { EntityRef, Gender, ImageInfo, LocalizedText, PeopleDataset, Person, Place } from '../src/types/person.ts';

const GENDERS: Record<string, Gender> = { Q6581097: 'male', Q6581072: 'female' };
const SWEDISH = new Set<string>(config.swedishCountries);

/** sv/en med fallback till språkneutral "mul"-etikett. */
function localize(t: Texts): LocalizedText {
  const out: LocalizedText = {};
  const sv = t.sv ?? t.mul;
  const en = t.en ?? t.mul;
  if (sv) out.sv = sv;
  if (en) out.en = en;
  return out;
}

const hasText = (t: LocalizedText) => !!(t.sv || t.en);

/** Preferred-rankade värden först, därefter övriga i källans ordning. */
const ordered = (claims: RawClaim[] | undefined) =>
  [...(claims ?? [])].sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'preferred' ? -1 : 1));

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(cur, v)
      : v;
  }
  return out as T;
}

function main() {
  const selection = readJson<Selection>(join(DATA_DIR, 'selection.json'));
  const raw = readJson<RawEntities>(join(CACHE_DIR, 'entities.json'));
  const media = readJsonIfExists<Record<string, ImageInfo | null>>(join(CACHE_DIR, 'media.json'), {});
  const overrides = readJson<Overrides>(join(DATA_DIR, 'overrides.json'));
  const candidates = readJson<{ id: string; sitelinks: number }[]>(join(CACHE_DIR, 'candidates.json'));
  const sitelinks = new Map(candidates.map((c) => [c.id, c.sitelinks]));

  const ref = (id: string): EntityRef | null => {
    const r = raw.refs[id];
    const name = r ? localize(r.labels) : {};
    return hasText(name) ? { id, name } : null;
  };
  const refs = (claims: RawClaim[] | undefined, max = 99) =>
    ordered(claims).map((c) => ref(c.value)).filter((r): r is EntityRef => !!r).slice(0, max);
  const place = (claims: RawClaim[] | undefined): Place | null => {
    const first = ordered(claims)[0];
    if (!first) return null;
    const base = ref(first.value);
    if (!base) return null;
    const r = raw.refs[first.value]!;
    const p: Place = { ...base };
    if (r.coord) p.coord = r.coord;
    const country = r.country ? ref(r.country) : null;
    if (country) p.country = country;
    return p;
  };

  const people: Person[] = [];
  const problems: Record<string, string[]> = {};
  const note = (kind: string, id: string) => (problems[kind] ??= []).push(id);

  for (const { id, tier } of selection.people) {
    const r = raw.people[id];
    if (!r) { note('saknar data', id); continue; }

    const birthDate = bestDate(r.dates.P569);
    if (!birthDate) { note('uteslutna: osäkert födelsedatum', id); continue; }
    const deathDate = bestDate(r.dates.P570);
    if (!deathDate && (r.dates.P570.length > 0 || birthDate.year <= config.livingBornAfter)) {
      note('uteslutna: osäkert dödsdatum', id);
      continue;
    }
    if (deathDate && deathDate.year < birthDate.year) { note('uteslutna: död före födsel', id); continue; }

    const name = localize(r.labels);
    if (!hasText(name)) { note('uteslutna: namn saknas', id); continue; }

    const description: LocalizedText = {};
    const dsv = cleanDescription(r.descriptions.sv);
    const den = cleanDescription(r.descriptions.en);
    if (dsv) description.sv = dsv;
    if (den) description.en = den;

    const citizenship = refs(r.claims.P27);
    const imageFile = pickImage(r.claims.P18);
    const genderId = ordered(r.claims.P21)[0]?.value;

    let person: Person = {
      id,
      name,
      description,
      gender: genderId ? (GENDERS[genderId] ?? 'other') : undefined,
      birthDate,
      deathDate,
      birthPlace: place(r.claims.P19),
      deathPlace: deathDate ? place(r.claims.P20) : null,
      sitelinks: sitelinks.get(id) ?? 0,
      tier,
      swedish: citizenship.some((c) => SWEDISH.has(c.id)),
      occupations: refs(r.claims.P106, 6),
      citizenship,
      causeOfDeath: refs(r.claims.P509, 3),
      mannerOfDeath: refs(r.claims.P1196, 2),
      notableWorks: refs(r.claims.P800, 8),
      image: imageFile ? (media[imageFile] ?? null) : null,
      wiki: { ...(r.wiki.sv ? { sv: r.wiki.sv } : {}), ...(r.wiki.en ? { en: r.wiki.en } : {}) },
    };
    if (overrides.patches[id]) person = deepMerge(person, overrides.patches[id]);

    if (!name.sv) note('info: svenskt namn saknas', id);
    if (!description.sv) note('info: svensk beskrivning saknas', id);
    if (!person.birthPlace) note('info: födelseort saknas', id);
    if (person.deathDate && !person.deathPlace) note('info: dödsort saknas', id);
    if (!person.image) note('info: bild saknas', id);
    if (!person.occupations.length) note('info: yrke saknas', id);
    people.push(person);
  }

  people.sort((a, b) => b.sitelinks - a.sitelinks);
  const counts: Record<string, number> = {
    total: people.length,
    guess: people.filter((p) => p.tier === 'guess').length,
    reference: people.filter((p) => p.tier === 'reference').length,
    swedish: people.filter((p) => p.swedish).length,
    living: people.filter((p) => !p.deathDate).length,
    withImage: people.filter((p) => p.image).length,
  };
  const dataset: PeopleDataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'Wikidata (https://www.wikidata.org), via QLever',
    license: 'Data: CC0 1.0 (Wikidata). Bilder: Wikimedia Commons, licens per bild (se image.license/artist).',
    counts,
    people,
  };
  writeJson(join(PUBLIC_DATA_DIR, 'people.json'), dataset, false);

  const perCentury: Record<string, { guess: number; reference: number }> = {};
  for (const p of people) {
    const c = String(Math.floor(p.birthDate.year / 100) * 100);
    (perCentury[c] ??= { guess: 0, reference: 0 })[p.tier]++;
  }
  writeJson(join(DATA_DIR, 'report.json'), {
    generatedAt: dataset.generatedAt,
    counts,
    perCentury,
    problemCounts: Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, v.length])),
    problems,
  });

  console.log('Antal:', counts);
  console.log('Per sekel (födelse):', perCentury);
  console.log('Problem:', Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, v.length])));
  console.log('Klart: public/data/people.json, data/report.json');
}

main();
