import { loc, type HistDate, type Lang, type Person, type Place } from '../types/person.ts';

export interface ContemporaryMatch {
  person: Person;
  relationship: string; // t.ex. "Levde samtidigt som X. När vår person föddes var X ca 45 år gammal."
}

const SOVEREIGN_OR_COMMON_PLACES = new Set([
  'sverige',
  'sweden',
  'danmark',
  'denmark',
  'norge',
  'norway',
  'frankrike',
  'france',
  'england',
  'storbritannien',
  'spanien',
  'spain',
  'portugal',
  'italien',
  'italy',
  'tyskland',
  'germany',
  'ryssland',
  'russia',
  'österrike',
  'austria',
  'polen',
  'poland',
  'ungern',
  'hungary',
  'grekland',
  'greece',
  'egypten',
  'egypt',
  'moskva',
  'moscow',
  'konstantinopel',
  'constantinople',
  'parma',
  'orléans',
  'orleans',
]);

/**
 * Returnerar ortsnamnet för visning på kartan/HUD.
 * Under pågående gissning (!isRevealed) maskeras ortsnamn som innehåller personens eget namn
 * eller toponymiska epitet (t.ex. "Vinci" för Leonardo da Vinci, "Rotterdam" för Erasmus av Rotterdam,
 * "Assisi" för Franciskus av Assisi, "Berings ö" för Vitus Bering) så att nålen visar var på kartan
 * händelsen skedde utan att avslöja namnet i klartext.
 */
export function getSafePlaceName(
  place: Place | null | undefined,
  person: Person,
  lang: Lang = 'sv',
  isRevealed = false,
  fallback = ''
): string {
  const isSv = lang === 'sv';
  const defaultFallback = fallback || (isSv ? 'Okänd ort' : 'Unknown');
  if (!place) return defaultFallback;

  const rawName = loc(place.name, lang, defaultFallback);
  if (isRevealed || !rawName) return rawName;

  const lowerPlace = rawName.toLowerCase();
  const nameTokens = [person.name.sv, person.name.en]
    .filter(Boolean)
    .flatMap((n) =>
      n!
        .toLowerCase()
        .replace(/[^a-zåäöéèüñç\s-]/gi, '')
        .split(/[\s-]+/)
        .filter(
          (w) =>
            w.length >= 4 &&
            !['från', 'store', 'äldre', 'yngre', 'helige', 'saint', 'markis', 'earl', 'hertig'].includes(w) &&
            !SOVEREIGN_OR_COMMON_PLACES.has(w)
        )
    );

  const hasNameLeak = nameTokens.some((token) => lowerPlace.includes(token));
  const hasMonumentLeak = /birthplace|birth house|födelsehus|sterbehaus|maison natale/i.test(rawName);

  if (hasNameLeak || hasMonumentLeak) {
    const countryName = loc(place.country?.name, lang, '') || loc(person.citizenship?.[0]?.name, lang, '');
    if (countryName && !nameTokens.some((t) => countryName.toLowerCase().includes(t))) {
      return isSv ? `Ort i ${countryName}` : `Place in ${countryName}`;
    }
    return isSv ? 'Hemlig ort' : 'Secret place';
  }

  return rawName;
}

/** Formaterar ett historiskt datum för spelaren (år eller fullt datum om känd dag). */
export function formatDate(d: HistDate | null, lang: 'sv' | 'en' = 'sv'): string {
  if (!d) return lang === 'sv' ? 'nu levande' : 'alive today';
  if (d.year < 0) {
    return `${Math.abs(d.year)} ${lang === 'sv' ? 'f.Kr.' : 'BC'}`;
  }
  if (d.precision === 'year') {
    return `${d.year}`;
  }
  const dateObj = new Date(d.iso);
  if (isNaN(dateObj.getTime())) return `${d.year}`;
  const locale = lang === 'sv' ? 'sv-SE' : 'en-US';
  return dateObj.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: d.precision === 'day' ? 'numeric' : undefined,
  });
}

/**
 * Hittar 1–3 samtida kända personer ("tidskompisar") vars liv överlappade med målet.
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
    return overlapEnd - overlapStart >= 15;
  });

  // Sortera efter kändisskap (sitelinks)
  candidates.sort((a, b) => b.sitelinks - a.sitelinks);

  const selected = candidates.slice(0, maxCount);

  return selected.map((p) => {
    const pName = loc(p.name, lang, lang === 'sv' ? 'En samtida gestalt' : 'A contemporary figure');
    const pBirth = p.birthDate.year;
    const pDeath = p.deathDate?.year ?? new Date().getFullYear();

    let relationship = '';
    if (lang === 'sv') {
      if (tBirth > pBirth && tBirth < pDeath) {
        const pAgeAtTargetBirth = tBirth - pBirth;
        relationship = `Levde samtidigt som ${pName}. När personen föddes var ${pName} ca ${pAgeAtTargetBirth} år gammal.`;
      } else if (pBirth > tBirth && pBirth < tDeath) {
        const targetAgeAtPBirth = pBirth - tBirth;
        relationship = `Levde samtidigt som ${pName} och var ca ${targetAgeAtPBirth} år gammal när ${pName} föddes.`;
      } else {
        relationship = `Levde under samma epok som ${pName} (${pBirth}–${p.deathDate ? pDeath : 'nu'}).`;
      }
    } else {
      if (tBirth > pBirth && tBirth < pDeath) {
        const pAgeAtTargetBirth = tBirth - pBirth;
        relationship = `Lived at the same time as ${pName}. When this person was born, ${pName} was about ${pAgeAtTargetBirth} years old.`;
      } else if (pBirth > tBirth && pBirth < tDeath) {
        const targetAgeAtPBirth = pBirth - tBirth;
        relationship = `Lived at the same time as ${pName} and was about ${targetAgeAtPBirth} years old when ${pName} was born.`;
      } else {
        relationship = `Lived during the same era as ${pName} (${pBirth}–${p.deathDate ? pDeath : 'now'}).`;
      }
    }

    return { person: p, relationship };
  });
}
