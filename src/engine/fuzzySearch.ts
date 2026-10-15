/**
 * Smart och förlåtande sökning för historiska namn.
 * 
 * Hanterar:
 * 1. Diakritiska tecken (é -> e, ü -> u, ö -> o etc.)
 * 2. Transkriberingsvariationer från kyrilliska/andra alfabet:
 *    - chr / khr / kr / cr -> kr
 *    - sjtj / shch / sch / stj / sh -> sh
 *    - tch / tj / cz / ch -> ch
 *    - w / ff / v -> v
 *    - y / ij / iy / j i slutet -> i
 *    - dubbla konsonanter -> enkla konsonanter (ss -> s, tt -> t etc.)
 * 3. Matchning på förnamn ELLER efternamn (prefix eller substring).
 * 4. Damerau-Levenshtein edit-distance för att tolerera 1-2 feltryckningar/stavfel.
 * 5. Söker i både svenska och engelska namn samtidigt.
 */

import type { Person } from '../types/person.ts';

export function normalizePhonetic(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Ta bort accenter
    .replace(/shch|sjtj|sch|stj|sh/g, 'sh')
    .replace(/khr|chr|kh/g, 'k')
    .replace(/ch(?=[aeiouy])/g, 'k') // t.ex. Machiavelli -> makiavelli
    .replace(/tch|tj|cz|ch/g, 'ch')
    .replace(/c|q|k/g, 'k')
    .replace(/w|ff|v/g, 'v')
    .replace(/(.)\1+/g, '$1') // Ta bort dubbeltecken (ss -> s, tt -> t, ll -> l)
    .replace(/(?:ij|iy|y|j)$/g, 'i')
    .replace(/[^a-z0-9]/g, '');
}

export function cleanSimple(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Beräknar Levenshtein-avstånd mellan två strängar.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const val = a[i] === b[j] ? row[j]! : Math.min(row[j]!, row[j + 1]!, prev) + 1;
      row[j] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length]!;
}

export interface SearchMatch {
  person: Person;
  score: number; // Högre är bättre match
}

export function searchPeopleForgiving(
  query: string,
  people: Person[],
  maxResults = 7
): Person[] {
  const qClean = cleanSimple(query);
  if (!qClean || qClean.length < 2) return [];

  const qPhonetic = normalizePhonetic(query);
  const qWords = qClean.split(/\s+/).filter(Boolean);

  const matches: SearchMatch[] = [];

  for (const person of people) {
    const svRaw = person.name.sv || '';
    const enRaw = person.name.en || '';
    const svClean = cleanSimple(svRaw);
    const enClean = cleanSimple(enRaw);

    let bestScore = -1;

    // 1. Exakt matchning på fullständigt namn (sv eller en)
    if (svClean === qClean || enClean === qClean) {
      bestScore = 1000;
    }

    // 2. Prefix-matchning på namn (t.ex. "nikita chr...")
    if (bestScore < 0) {
      if (svClean.startsWith(qClean) || enClean.startsWith(qClean)) {
        bestScore = 500;
      }
    }

    // 3. Ordnivå-matchning (t.ex. användaren skriver "Chrusjtjov" och personen heter "Nikita Chrusjtjov")
    if (bestScore < 0) {
      const pWords = `${svClean} ${enClean}`.split(/\s+/).filter(Boolean);
      for (const w of pWords) {
        if (w.startsWith(qClean)) {
          bestScore = Math.max(bestScore, 400 + (qClean.length / w.length) * 50);
        } else if (w.includes(qClean)) {
          bestScore = Math.max(bestScore, 300);
        }
      }
    }

    // 4. Fonetisk / Transkriberingsmatchning (t.ex. "Krusjtjov" matchar "Chrusjtjov" / "Khrushchev")
    if (bestScore < 0 && qPhonetic.length >= 3) {
      const svPhonetic = normalizePhonetic(svRaw);
      const enPhonetic = normalizePhonetic(enRaw);

      if (svPhonetic.includes(qPhonetic) || enPhonetic.includes(qPhonetic)) {
        bestScore = 250;
      } else {
        // Kontrollera fonetiska ord för sig (t.ex. efternamn)
        const pPhoneticWords = `${svRaw} ${enRaw}`
          .split(/\s+/)
          .map(normalizePhonetic)
          .filter((w) => w.length >= 3);

        for (const pw of pPhoneticWords) {
          if (pw.includes(qPhonetic) || qPhonetic.includes(pw)) {
            bestScore = Math.max(bestScore, 220);
          } else {
            // Levenshtein på fonetiskt ord (tillåt 1 feltryckning)
            const dist = levenshtein(qPhonetic, pw);
            if (dist <= 1 && pw.length >= 4) {
              bestScore = Math.max(bestScore, 180 - dist * 20);
            }
          }
        }
      }
    }

    // 5. Allmän fuzzy Levenshtein på hela namnet eller ord (tillåt 1-2 felstavningar)
    if (bestScore < 0 && qClean.length >= 4) {
      const pWords = `${svClean} ${enClean}`.split(/\s+/).filter((w) => w.length >= 4);
      for (const w of pWords) {
        const dist = levenshtein(qClean, w);
        const maxAllowed = qClean.length > 6 ? 2 : 1;
        if (dist <= maxAllowed) {
          bestScore = Math.max(bestScore, 150 - dist * 30);
        }
      }
    }

    if (bestScore > 0) {
      // Lägg till liten bonus för kändisskap (sitelinks) så kända personer kommer först vid likvärdig match
      const fameBonus = Math.min(person.sitelinks, 50);
      matches.push({ person, score: bestScore + fameBonus });
    }
  }

  // Sortera efter score fallande
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, maxResults).map((m) => m.person);
}
