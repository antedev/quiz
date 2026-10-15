import type { HistDate, Person, Tier } from '../types/person.ts';

export interface ClueLevel {
  level: number;       // 1 (10p), 2 (8p), 3 (6p), 4 (4p), 5 (2p)
  points: number;      // 10, 8, 6, 4, 2
  title: string;       // Kort rubrik
  text?: string;       // Textledtråd
  category?: string;   // T.ex. "Tid & Rum", "Tidskompis", "Verksamhet"
  revealImage?: boolean;
  blurAmount?: number; // 20px -> 12px -> 6px -> 0px
  metadata?: Record<string, unknown>;
}

export interface ContemporaryMatch {
  person: Person;
  relationship: string; // t.ex. "Föddes när X var 45 år gammal och dog 5 år efter att X dog"
}

/** Formaterar ett historiskt datum för spelaren (år eller fullt datum om känd dag). */
export function formatDate(d: HistDate | null, lang: 'sv' | 'en' = 'sv'): string {
  if (!d) return lang === 'sv' ? 'nu levande' : 'alive today';
  if (d.precision === 'year') {
    return d.year < 0 ? `${Math.abs(d.year)} ${lang === 'sv' ? 'f.Kr.' : 'BC'}` : `${d.year}`;
  }
  const dateObj = new Date(d.iso);
  if (isNaN(dateObj.getTime())) return `${d.year}`;
  const locale = lang === 'sv' ? 'sv-SE' : 'en-US';
  return dateObj.toLocaleDateString(locale, {
    year: 'numeric',
    month: d.precision === 'month' ? 'long' : 'long',
    day: d.precision === 'day' ? 'numeric' : undefined,
  });
}

/**
 * Hittar 1–2 samtida kända personer ("tidskompisar") vars liv överlappade med målet.
 */
export function findContemporaries(
  target: Person,
  pool: Person[],
  maxCount = 2,
  lang: 'sv' | 'en' = 'sv'
): ContemporaryMatch[] {
  const tBirth = target.birthDate.year;
  const tDeath = target.deathDate?.year ?? new Date().getFullYear();

  // Filtrera fram personer som levde samtidigt och har hög sitelinks-rankning
  const candidates = pool.filter((p) => {
    if (p.id === target.id) return false;
    const pBirth = p.birthDate.year;
    const pDeath = p.deathDate?.year ?? new Date().getFullYear();
    // Överlappar de i minst 15 år?
    const overlapStart = Math.max(tBirth, pBirth);
    const overlapEnd = Math.min(tDeath, pDeath);
    return (overlapEnd - overlapStart) >= 15;
  });

  // Sortera efter kändisskap (sitelinks)
  candidates.sort((a, b) => b.sitelinks - a.sitelinks);

  const selected = candidates.slice(0, maxCount);

  return selected.map((p) => {
    const pName = p.name[lang] || p.name.en || p.name.sv || 'En samtida gestalt';
    const pBirth = p.birthDate.year;
    const pDeath = p.deathDate?.year ?? new Date().getFullYear();

    let relationship = '';
    if (lang === 'sv') {
      if (tBirth > pBirth && tBirth < pDeath) {
        const pAgeAtTargetBirth = tBirth - pBirth;
        relationship = `Levde samtidigt som ${pName}. När vår person föddes var ${pName} ca ${pAgeAtTargetBirth} år gammal.`;
      } else if (pBirth > tBirth && pBirth < tDeath) {
        const targetAgeAtPBirth = pBirth - tBirth;
        relationship = `Var ca ${targetAgeAtPBirth} år gammal när ${pName} föddes.`;
      } else {
        relationship = `Levde under samma epok som ${pName}.`;
      }
    } else {
      if (tBirth > pBirth && tBirth < pDeath) {
        const pAgeAtTargetBirth = tBirth - pBirth;
        relationship = `Lived at the same time as ${pName}. When our person was born, ${pName} was about ${pAgeAtTargetBirth} years old.`;
      } else if (pBirth > tBirth && pBirth < tDeath) {
        const targetAgeAtPBirth = pBirth - tBirth;
        relationship = `Was about ${targetAgeAtPBirth} years old when ${pName} was born.`;
      } else {
        relationship = `Lived during the same era as ${pName}.`;
      }
    }

    return { person: p, relationship };
  });
}

/**
 * Skapar 5 nivåer av ledtrådar för "Vem är personen?"
 */
export function generateClues(
  person: Person,
  allPeople: Person[],
  lang: 'sv' | 'en' = 'sv'
): ClueLevel[] {
  const isSv = lang === 'sv';
  const name = person.name[lang] || person.name.sv || person.name.en || 'Okänd';
  const birthPlace = person.birthPlace?.name[lang] || person.birthPlace?.name.sv || person.birthPlace?.name.en;
  const deathPlace = person.deathPlace?.name[lang] || person.deathPlace?.name.sv || person.deathPlace?.name.en;
  const occupations = person.occupations.map((o) => o.name[lang] || o.name.sv || o.name.en).filter(Boolean);
  const citizenship = person.citizenship.map((c) => c.name[lang] || c.name.sv || c.name.en).filter(Boolean);
  const works = person.notableWorks.map((w) => w.name[lang] || w.name.sv || w.name.en).filter(Boolean);
  const contemporaries = findContemporaries(person, allPeople, 2, lang);

  const clues: ClueLevel[] = [];

  // Nivå 1 (10p): Epok och geografi i breda drag
  const birthCentury = Math.floor(person.birthDate.year / 100) * 100;
  const broadGeo = person.birthPlace?.country?.name[lang] || citizenship[0] || (isSv ? 'Europa' : 'the world');
  clues.push({
    level: 1,
    points: 10,
    title: isSv ? '10 poäng: Tidsepok & Värld' : '10 points: Era & Region',
    category: isSv ? 'Tid & Rum' : 'Time & Space',
    text: isSv
      ? `Personen levde under ${birthCentury}-talet/följande sekel och verkade med koppling till ${broadGeo}.`
      : `This person lived during the ${birthCentury}s/following century and was associated with ${broadGeo}.`,
    blurAmount: 28,
  });

  // Nivå 2 (8p): Tidskompis & Livsspann
  const compText = contemporaries[0]?.relationship || (isSv ? `Föddes år ${person.birthDate.year}.` : `Born in the year ${person.birthDate.year}.`);
  clues.push({
    level: 2,
    points: 8,
    title: isSv ? '8 poäng: Samtid & Livsspann' : '8 points: Contemporary & Lifespan',
    category: isSv ? 'Tidskompis' : 'Contemporary',
    text: compText,
    blurAmount: 18,
  });

  // Nivå 3 (6p): Födelse- och dödsorter + Yrkeskategori
  const occText = occupations.slice(0, 2).join(', ');
  let geoText = '';
  if (birthPlace && deathPlace && birthPlace !== deathPlace) {
    geoText = isSv ? `Föddes i ${birthPlace} och dog i ${deathPlace}.` : `Born in ${birthPlace} and died in ${deathPlace}.`;
  } else if (birthPlace) {
    geoText = isSv ? `Föddes i ${birthPlace}.` : `Born in ${birthPlace}.`;
  }
  clues.push({
    level: 3,
    points: 6,
    title: isSv ? '6 poäng: Platser & Verksamhet' : '6 points: Places & Activity',
    category: isSv ? 'Verksamhet' : 'Activity',
    text: [geoText, occText ? (isSv ? `Verksam som: ${occText}.` : `Known as: ${occText}.`) : ''].filter(Boolean).join(' '),
    blurAmount: 10,
  });

  // Nivå 4 (4p): Exakta årtal + Kända verk / dödssätt / tidskompis 2
  const yearsText = isSv
    ? `Levde ${formatDate(person.birthDate, 'sv')} – ${formatDate(person.deathDate, 'sv')}.`
    : `Lived ${formatDate(person.birthDate, 'en')} – ${formatDate(person.deathDate, 'en')}.`;
  const worksText = works.length > 0
    ? (isSv ? `Kopplad till verk som: ${works.slice(0, 2).join(', ')}.` : `Associated with works such as: ${works.slice(0, 2).join(', ')}.`)
    : (contemporaries[1]?.relationship || '');
  clues.push({
    level: 4,
    points: 4,
    title: isSv ? '4 poäng: Exakta datum & Kända verk' : '4 points: Exact Dates & Works',
    category: isSv ? 'Datum & Verk' : 'Dates & Works',
    text: [yearsText, worksText].filter(Boolean).join(' '),
    blurAmount: 4,
  });

  // Nivå 5 (2p): Tvättad beskrivning + skarp bild
  const desc = person.description[lang] || person.description.sv || person.description.en || '';
  clues.push({
    level: 5,
    points: 2,
    title: isSv ? '2 poäng: Signalement' : '2 points: Description',
    category: isSv ? 'Beskrivning' : 'Description',
    text: desc ? (isSv ? `Beskrivning: "${desc}".` : `Description: "${desc}".`) : (isSv ? 'Känd historisk personlighet.' : 'Well-known historical personality.'),
    revealImage: true,
    blurAmount: 0,
  });

  return clues;
}
