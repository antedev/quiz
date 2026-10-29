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
import type { EntityRef, Gender, ImageInfo, LocalizedText, PeopleDataset, Person, Place, Tier } from '../src/types/person.ts';
import { determineTier, classifyCategories } from '../src/engine/classification.ts';

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

  /**
   * Byggnader, sjukhus och minnesmärken i Wikidata P19/P20 som annars läcker personens namn
   * eller visar ett specifikt sjukhus/hus i stället för staden/orten.
   */
  const PLACE_LABEL_OVERRIDES: Record<string, LocalizedText> = {
    Q2262830: { sv: 'Yorba Linda, Kalifornien', en: 'Yorba Linda, California' }, // Birthplace of Richard Nixon
    Q7013596: { sv: 'New York', en: 'New York City' }, // New York Hospital / Weill Cornell
    Q11614939: { sv: 'Iga (Ueno)', en: 'Iga (Ueno)' }, // Bashos födelsehus
    Q4917087: { sv: 'Tampico, Illinois', en: 'Tampico, Illinois' }, // Birthplace of Ronald Reagan
    Q121091534: { sv: 'Los Angeles (Bel Air)', en: 'Los Angeles (Bel Air)' }, // 668 St. Cloud Road (Reagan death)
    Q1476974: { sv: 'Westmoreland County, Virginia', en: 'Westmoreland County, Virginia' }, // George Washington Birthplace
    Q3181502: { sv: 'Brookline, Massachusetts', en: 'Brookline, Massachusetts' }, // JFK National Historic Site
    Q3896131: { sv: 'Dallas, Texas', en: 'Dallas, Texas' }, // Parkland Memorial Hospital (JFK / Oswald)
    Q954276: { sv: 'Hyde Park, New York', en: 'Hyde Park, New York' }, // Home of Franklin D. Roosevelt
    Q2714456: { sv: 'Warm Springs, Georgia', en: 'Warm Springs, Georgia' }, // Little White House
    Q38018317: { sv: 'Kierling (Klosterneuburg)', en: 'Kierling (Klosterneuburg)' }, // Kafka Sterbehaus
    Q2108847: { sv: 'Hope, Arkansas', en: 'Hope, Arkansas' }, // Bill Clinton Birthplace Home
    Q1669062: { sv: 'Uppsala', en: 'Uppsala' }, // Linnés Hammarby
    Q5885537: { sv: 'Wadowice', en: 'Wadowice' }, // John Paul II Family Home in Wadowice
    Q106766784: { sv: 'Roccasecca (Lazio)', en: 'Roccasecca (Lazio)' }, // castle of the counts of Aquino
    Q6548118: { sv: 'Plains, Georgia', en: 'Plains, Georgia' }, // Lillian G. Carter Nursing Center
    Q107599584: { sv: 'Plains, Georgia', en: 'Plains, Georgia' }, // Jimmy Carter House
    Q2348968: { sv: 'Marktl (Bayern)', en: 'Marktl (Bavaria)' }, // Birth house of Benedict XVI
    Q5672150: { sv: 'Lamar, Missouri', en: 'Lamar, Missouri' }, // Harry S Truman Birthplace
    Q111362759: { sv: 'Clermont-Ferrand', en: 'Clermont-Ferrand' }, // birth house of Blaise Pascal
    Q5349910: { sv: 'Denison, Texas', en: 'Denison, Texas' }, // Eisenhower Birthplace
    Q3065522: { sv: 'Abbottabad', en: 'Abbottabad' }, // Osama bin Laden's compound in Abbottabad
    Q5549503: { sv: 'Omaha, Nebraska', en: 'Omaha, Nebraska' }, // Gerald R. Ford Birthsite
    Q14688998: { sv: 'West Branch, Iowa', en: 'West Branch, Iowa' }, // Herbert Hoover National Historic Site
    Q14712874: { sv: 'Westmoreland County, Virginia', en: 'Westmoreland County, Virginia' }, // Monroe Hall
    Q1381516: { sv: 'New Delhi', en: 'New Delhi' }, // Birla House / Gandhi Smriti
    Q153491: { sv: 'Berlin', en: 'Berlin' }, // Adolf Hitlers bunker / Führerbunker
    Q360607: { sv: 'Braunau am Inn', en: 'Braunau am Inn' }, // Adolf Hitlers födelsehus
    Q7296924: { sv: 'Rawalpindi', en: 'Rawalpindi' }, // Benazir Bhutto Hospital
    Q58450335: { sv: 'New Delhi', en: 'New Delhi' }, // Dr. Ambedkar National Memorial
    Q7288812: { sv: 'Kolkata', en: 'Kolkata' }, // Swami Vivekananda's Ancestral House
    Q3280230: { sv: 'Jarnac', en: 'Jarnac' }, // Maison natale de François Mitterrand
    Q17534538: { sv: 'Thornton, Yorkshire', en: 'Thornton, Yorkshire' }, // The Brontë Birthplace
    Q7279187: { sv: 'Springdale, Pennsylvania', en: 'Springdale, Pennsylvania' }, // Rachel Carson Homestead
    Q137795320: { sv: 'Azpeitia (Baskien)', en: 'Azpeitia (Basque Country)' }, // Holy House of Loyola
    Q68706518: { sv: 'Kolkata', en: 'Kolkata' }, // Sri Aurobindo Bhawan
    Q11240365: { sv: 'Tokyo', en: 'Tokyo' }, // Meiji Palace
    Q132682082: { sv: 'İzmir', en: 'İzmir' }, // İnönü House Museum
    Q15816551: { sv: 'Delhi', en: 'Delhi' }, // Ghalib ki Haveli
    Q7586214: { sv: 'Tiruvannamalai', en: 'Tiruvannamalai' }, // Sri Ramana Ashram
    Q6257637: { sv: 'Lancaster, Ohio', en: 'Lancaster, Ohio' }, // John Sherman Birthplace
    Q368346: { sv: 'Florens (Careggi)', en: 'Florence (Careggi)' }, // Villa Medici at Careggi
    Q1333383: { sv: 'Saint-Michel (Dordogne)', en: 'Saint-Michel (Dordogne)' }, // Château de Montaigne
    Q52069: { sv: 'Caprese (Toscana)', en: 'Caprese (Tuscany)' }, // Caprese Michelangelo
    Q320299: { sv: 'La Haye-en-Touraine', en: 'La Haye-en-Touraine' }, // Descartes (renamed town)
    Q101616: { sv: 'Sotto il Monte (Bergamo)', en: 'Sotto il Monte (Bergamo)' }, // Sotto il Monte Giovanni XXIII
    Q34638: { sv: 'Arquà (Veneto)', en: 'Arquà (Veneto)' }, // Arquà Petrarca
    Q56687351: { sv: 'Valdicastello (Toscana)', en: 'Valdicastello (Tuscany)' }, // Valdicastello Carducci
    Q104096: { sv: 'Corteno (Lombardiet)', en: 'Corteno (Lombardy)' }, // Corteno Golgi
    Q17785: { sv: "Castelnuovo d'Asti", en: "Castelnuovo d'Asti" }, // Castelnuovo Don Bosco
    Q17814: { sv: 'Grazzano Monferrato', en: 'Grazzano Monferrato' }, // Grazzano Badoglio
    Q834276: { sv: 'Labastide-Fortunière', en: 'Labastide-Fortunière' }, // Labastide-Murat
    Q693259: { sv: 'Chavaniac (Auvergne)', en: 'Chavaniac (Auvergne)' }, // Chavaniac-Lafayette
    Q475374: { sv: 'Carla-le-Comte', en: 'Carla-le-Comte' }, // Carla-Bayle
    Q1101832: { sv: 'Le Bignon (Loiret)', en: 'Le Bignon (Loiret)' }, // Le Bignon-Mirabeau
    Q741578: { sv: 'Saint-Léger-de-Foucheret', en: 'Saint-Léger-de-Foucheret' }, // Saint-Léger-Vauban
    Q194434: { sv: 'Pouy (Landes)', en: 'Pouy (Landes)' }, // Saint-Vincent-de-Paul
    Q3947701: { sv: 'Nepantla', en: 'Nepantla' }, // Nepantla de Sor Juana Inés de la Cruz
    Q18498195: { sv: 'Isola di Carturo (Veneto)', en: 'Isola di Carturo (Veneto)' }, // Isola Mantegna
    Q1990216: { sv: 'Ahmadabad', en: 'Ahmadabad' }, // Ahmadabad-e Mosaddeq
    Q19688347: { sv: 'Simbirsk (Uljanovsk)', en: 'Simbirsk (Ulyanovsk)' }, // Karamzinka
    Q730806: { sv: 'Franceville (Haut-Ogooué)', en: 'Franceville (Haut-Ogooué)' }, // Bongoville
    Q12073283: { sv: 'New Haven, Connecticut', en: 'New Haven, Connecticut' }, // Yale - New Haven Hospital (G.W. Bush)
    Q100276507: { sv: 'Scranton, Pennsylvania', en: 'Scranton, Pennsylvania' }, // St. Mary's Hospital (Joe Biden)
    Q1734280: { sv: 'Solna (Stockholm)', en: 'Solna (Stockholm)' }, // Karolinska Universitetssjukhuset
    Q1439312: { sv: 'Danderyd (Stockholm)', en: 'Danderyd (Stockholm)' }, // Danderyds sjukhus
    Q10727466: { sv: 'Örebro', en: 'Örebro' }, // Örebro hospital
    Q10612973: { sv: 'Stockholm', en: 'Stockholm' }, // Hedvig Eleonora och Oscars församling
    Q212937: { sv: 'Stockholm', en: 'Stockholm' }, // Klara församling
  };

  const BUILDING_OR_SPOILER_RE =
    /birthplace|birth house|birthsite|födelsehus|historic site|national monument|sterbehaus|maison natale|homestead|memorial|house museum|bunker|compound|ashram|bhawan|haveli|hammarby|smriti|nursing center|family home|little white house|hospital|sjukhus|lasarett|medical center|clinic|clinique|maternity|infirmary|sanatorium|hospice|församling|parish|\broad\b|\bstreet\b/i;

  const place = (claims: RawClaim[] | undefined, personName: LocalizedText): Place | null => {
    if (!claims || claims.length === 0) return null;
    const pTokens = [personName.sv, personName.en]
      .filter(Boolean)
      .flatMap((n) =>
        n!
          .toLowerCase()
          .replace(/[^a-zåäöéèüñç\s-]/gi, '')
          .split(/[\s-]+/)
          .filter((w) => w.length >= 4 && !['från', 'store', 'äldre', 'yngre', 'helige', 'saint'].includes(w))
      );

    // Rangordna kandidater: föredra riktiga städer/orter framför sjukhus, födelsehus och platser med personens eget namn
    const scored = ordered(claims)
      .map((c, idx) => {
        const base = ref(c.value);
        if (!base) return null;
        const r = raw.refs[c.value]!;
        const combined = `${base.name.sv ?? ''} ${base.name.en ?? ''}`.toLowerCase();
        let score = idx === 0 ? 10 : 0;
        if (r.coord) score += 25;
        if (base.name.sv) score += 15;
        if (BUILDING_OR_SPOILER_RE.test(combined)) score -= 100;
        if (pTokens.some((w) => combined.includes(w))) score -= 120;
        return { claim: c, base, r, score };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) return null;
    const overrideName = PLACE_LABEL_OVERRIDES[best.claim.value];
    const p: Place = {
      id: best.claim.value,
      name: overrideName ? { ...best.base.name, ...overrideName } : best.base.name,
    };
    if (best.r.coord) p.coord = best.r.coord;
    const country = best.r.country ? ref(best.r.country) : null;
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
    if (!name.sv && r.wiki.sv) name.sv = r.wiki.sv.replace(/ \(.*\)$/, '');
    if (!name.en && r.wiki.en) name.en = r.wiki.en.replace(/ \(.*\)$/, '');
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
      birthPlace: place(r.claims.P19, name),
      deathPlace: deathDate ? place(r.claims.P20, name) : null,
      sitelinks: sitelinks.get(id) ?? 0,
      tier: determineTier({
        sitelinks: sitelinks.get(id) ?? 0,
        swedish: citizenship.some((c) => SWEDISH.has(c.id)),
      }),
      categories: classifyCategories({
        occupations: refs(r.claims.P106, 6),
        description,
      }),
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
    easy: people.filter((p) => p.tier === 'easy').length,
    medium: people.filter((p) => p.tier === 'medium').length,
    hard: people.filter((p) => p.tier === 'hard').length,
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

  const perCentury: Record<string, Record<Tier, number>> = {};
  for (const p of people) {
    const c = String(Math.floor(p.birthDate.year / 100) * 100);
    (perCentury[c] ??= { easy: 0, medium: 0, hard: 0 })[p.tier]++;
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
