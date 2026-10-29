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
    Q11453310: { sv: 'Tokyo', en: 'Tokyo' }, // Hospital of the Imperial Household
    Q43079570: { sv: 'Nashville, Tennessee', en: 'Nashville, Tennessee' }, // Vanderbilt-Ingram Cancer Center
    Q13814628: { sv: 'Suzhou (Gusu)', en: 'Suzhou (Gusu)' }, // Gusu / Suzhou
    Q65415418: { sv: 'Padua (Patavium)', en: 'Padua (Patavium)' }, // Patavium
    Q50711037: { sv: 'Como (Novum Comum)', en: 'Como (Novum Comum)' }, // Novum Comum
    Q27088966: { sv: 'Amasya (Amasia)', en: 'Amasya (Amasia)' }, // Amasia
    Q21711493: { sv: 'Oslo (Christiania)', en: 'Oslo (Christiania)' }, // Christiania
    Q31897851: { sv: 'Stockholm', en: 'Stockholm' }, // Svea ingenjörkårs församling
    Q31899080: { sv: 'Stockholm', en: 'Stockholm' }, // Svea livgardes församling
  };

  /**
   * Koordinat-fallback för platser i Wikidata som saknar direkta P625-koordinater på själva entiteten
   * (t.ex. antika stadsnamn som Gusu/Suzhou, Patavium/Padua, historiska riken, sjukhus eller församlingar).
   */
  const PLACE_COORD_FALLBACKS: Record<string, [number, number]> = {
    Q6843510: [34.6811, 135.5003], // Midōsuji, Osaka
    Q11453310: [35.6875, 139.7564], // Hospital of the Imperial Household, Tokyo
    Q21711493: [59.9139, 10.7522], // Christiania (Oslo)
    Q15278: [22.3369, 114.1761], // Kowloon Tong, Hong Kong
    Q13814628: [31.3041, 120.5954], // Gusu (Suzhou)
    Q54295687: [22.5525, 75.7564], // Bhim Janmabhoomi (Mhow, Madhya Pradesh)
    Q2277: [41.8931, 12.4828], // Romerska kejsardömet (Rom)
    Q65415418: [45.4064, 11.8768], // Patavium (Padua)
    Q50711037: [45.8081, 9.0852], // Novum Comum (Como)
    Q106259102: [53.5511, 9.9937], // Meierstraße
    Q43079570: [36.1408, -86.8019], // Vanderbilt-Ingram Cancer Center (Nashville)
    Q668: [28.6139, 77.2090], // Indien
    Q27088966: [40.6539, 35.8331], // Amasia (Amasya)
    Q4334071: [48.0444, 30.8500], // Olviopol (Pervomajsk)
    Q227007: [35.3986, 117.1336], // Zhu (Zoucheng, Shandong)
    Q137795320: [43.1744, -2.2808], // Azpeitia (Loyola)
    Q23670612: [36.8528, 10.3233], // Roman Carthage
    Q3008765: [39.4167, 22.5667], // Cynocephalus (Thessalien)
    Q12974700: [9.2881, 79.3129], // Rameswaram taluk
    Q510990: [43.2994, 13.4533], // Picenum (Marche)
    Q68706518: [22.5455, 88.3526], // Kolkata (Sri Aurobindo Bhawan)
    Q122791820: [35.0253, 135.7636], // Kyoto (Nakayama Residence)
    Q11240365: [35.6852, 139.7528], // Meiji Palace, Tokyo
    Q1048669: [41.8931, 12.4828], // Latium
    Q139428256: [55.7558, 37.6173], // Semenovo
    Q43114927: [42.8805, -8.5457], // Casa de Santa María
    Q555994: [38.0800, 46.2919], // Aq Qoyunlu (Tabriz)
    Q1054923: [22.3193, 114.1694], // British Hong Kong
    Q116214691: [37.3891, -5.9845], // Spalis (Sevilla)
    Q41: [37.9838, 23.7275], // Grekland
    Q184536: [12.6392, -8.0029], // Maliriket
    Q120227728: [40.5892, -4.1478], // El Escorial
    Q11266977: [39.6650, 20.8537], // Epirus (Ioannina)
    Q15782399: [37.0179, -7.9308], // Algarve
    Q3134997: [-2.5000, 28.8667], // Hewa Bora
    Q3875016: [47.9212, 106.9186], // Khamag Mongol
    Q477152: [47.1683, 47.4025], // Sarai
    Q164092: [51.8667, 12.6500], // Hertigdömet Sachsen (Wittenberg)
    Q96246887: [24.7136, 46.6753], // Saudiarabien
    Q97205845: [37.5758, 126.9831], // Andong Byeolgung (Seoul)
    Q1747689: [41.8931, 12.4828], // Romerska riket
    Q10646925: [40.8233, 14.1222], // Puteoli (Pozzuoli)
    Q6645669: [47.2307, 16.6218], // Pannonia Prima (Savaria)
    Q113490577: [33.9000, 114.5167], // Xianyang County
    Q16110680: [33.4251, -91.1612], // Guachoya (Mississippi River)
    Q136690357: [38.9167, 41.1500], // Hatsekats (Taron, Armenien)
    Q10909621: [38.8672, 106.5269], // Buzhou
    Q736936: [35.5967, 116.9911], // Lu (Qufu, Shandong)
    Q11958507: [52.8153, 0.5142], // Appleton House (Sandringham)
    Q116507919: [40.9833, 29.0333], // Harbor of Eutropius (Chalcedon)
    Q3775884: [52.8667, -8.2000], // M7 motorway (Tipperary)
    Q68682: [39.7747, 64.4286], // Buchara
    Q11768: [30.0444, 31.2357], // Forntida Egypten
    Q1122052: [47.0000, 35.0000], // Cumania
    Q119561775: [42.9964, 21.9461], // Bederiana (Justiniana Prima)
    Q235: [43.7384, 7.4246], // Monaco
    Q40: [48.2082, 16.3738], // Österrike
    Q766: [17.9712, -76.7936], // Jamaica
    Q9352080: [52.6606, 19.0672], // Szpetal (Włocławek)
    Q33242202: [54.1931, 32.1642], // Kimborovo (Smolensk)
    Q2014166: [34.7717, 72.3600], // Oddiyana (Swat)
    Q1016: [32.8872, 13.1913], // Libyen
    Q38: [41.9028, 12.4964], // Italien
    Q4307705: [34.2658, 108.9541], // Hangfeng Hall (Chang'an / Xi'an)
    Q399: [40.1792, 44.4991], // Armenien
    Q1702716: [53.8425, 14.6150], // Jomsborg (Wolin)
    Q43: [39.9334, 32.8597], // Turkiet
    Q12544: [41.0082, 28.9784], // Bysantinska riket (Konstantinopel)
    Q22: [55.9533, -3.1883], // Skottland
    Q2866053: [45.7772, 3.0870], // Arvernis (Clermont-Ferrand)
    Q40169: [36.3594, 43.1528], // Assyria (Nineve)
    Q12250518: [24.4539, 39.5692], // Wadi al-'Aqiq (Medina)
    Q858: [33.5138, 36.2765], // Syrien
    Q16545261: [38.6833, 27.5500], // Korupedion (Lydien)
    Q660393: [50.7753, 6.0839], // Lower Lotharingia (Aachen)
    Q23884786: [34.5197, 65.2550], // Ghor (Afghanistan)
    Q3183526: [33.5138, 36.2765], // Bilad al-Sham (Damaskus)
    Q111143175: [25.2854, 51.5310], // Beth Qatraye (Qatar)
    Q171150: [47.4979, 19.0402], // Kungariket Ungern
    Q7313: [39.9042, 116.4074], // Yuandynastin (Khanbaliq / Peking)
    Q9672118: [-9.2500, 15.7000], // Caculo Cabaça (Angola)
    Q973988: [-9.5400, 16.3400], // Kungariket Matamba
    Q2067184: [43.2141, 27.9147], // Bulgariska imperiet (Preslav)
    Q1143126: [34.6197, 112.4540], // Senare Tangdynastin (Luoyang)
    Q10541651: [58.3833, 12.1667], // Jälbolung (Västergötland)
    Q20089083: [37.5425, -5.0819], // Munda (Andalusien)
    Q17000558: [36.6972, 45.1417], // Piranshahr (Iran)
    Q11138161: [58.7289, 23.9503], // Kirbla parish (Estland)
    Q115051735: [60.5117, 14.2256], // Vansbro
    Q31897851: [59.3293, 18.0686], // Svea ingenjörkårs församling (Stockholm)
    Q31899080: [59.3293, 18.0686], // Svea livgardes församling (Stockholm)
    Q25522569: [57.9258, 26.3292], // Sangaste (Estland)
    Q36: [52.2297, 21.0122], // Polen
    Q796: [33.3152, 44.3661], // Irak
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
        if (c.value === 'Q24238356') return null; // "okänd" / "unknown" som platsentitet
        const base = ref(c.value);
        if (!base) return null;
        const r = raw.refs[c.value]!;
        const hasCoord = !!(r.coord || PLACE_COORD_FALLBACKS[c.value]);
        const combined = `${base.name.sv ?? ''} ${base.name.en ?? ''}`.toLowerCase();
        let score = idx === 0 ? 10 : 0;
        if (hasCoord) score += 25;
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
    const coord = best.r.coord ?? PLACE_COORD_FALLBACKS[best.claim.value];
    if (coord) p.coord = coord;
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
