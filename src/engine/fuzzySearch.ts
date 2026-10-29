/**
 * Smart och förlåtande sökning för historiska namn.
 *
 * Hanterar:
 * 1. Diakritiska tecken (é -> e, ü -> u, ö -> o) samt nordiska/europeiska bokstäver (ø -> o, æ -> ae, ß -> ss, ł -> l).
 * 2. Transkriberingsvariationer från kyrilliska/andra alfabet:
 *    - chr / khr / kr / cr -> k
 *    - sjtj / shch / sch / stj / sh -> sh
 *    - tch / tj / cz / ch -> ch
 *    - w / ff / v -> v
 *    - y / ij / iy / j i slutet -> i
 *    - dubbla konsonanter -> enkla konsonanter (ss -> s, tt -> t etc.)
 * 3. Flerords-sökning som tillåter utelämnade adelspartiklar/regentnummer (t.ex. "Carl Linne" -> "Carl von Linné", "Gustav Adolf" -> "Gustav II Adolf").
 * 4. Levenshtein edit-distance för att tolerera 1-2 feltryckningar/stavfel.
 * 5. Söker i både svenska och engelska namn samtidigt.
 */

import type { Person } from '../types/person.ts';

function foldSpecialChars(str: string): string {
  return str
    .toLowerCase()
    .replace(/ø|œ/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/ð|đ/g, 'd')
    .replace(/þ/g, 'th')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizePhonetic(str: string): string {
  if (!str) return '';
  return foldSpecialChars(str)
    .replace(/shch|sjtj|sch|stj|sh/g, 'sh')
    .replace(/khr|chr|kh/g, 'k')
    .replace(/(?<!t)ch(?=[ei])/g, 'k') // t.ex. Machiavelli -> makiavelli, Michelangelo -> mikelangelo
    .replace(/tch|tj|cz|ch/g, 'ch')
    .replace(/c(?!h)|q|k/g, 'k') // konvertera c -> k utan att förstöra 'ch'
    .replace(/aj|ay/g, 'ai')
    .replace(/oj|oy/g, 'oi')
    .replace(/ej|ey/g, 'ei')
    .replace(/w|ff|v/g, 'v')
    .replace(/(.)\1+/g, '$1') // Ta bort dubbeltecken (ss -> s, tt -> t, ll -> l)
    .replace(/(?:ij|iy|y|j)$/g, 'i')
    .replace(/[^a-z0-9]/g, '');
}

export function cleanSimple(str: string): string {
  if (!str) return '';
  return foldSpecialChars(str).trim();
}

/**
 * Beräknar Levenshtein-avstånd mellan två strängar.
 */
export function levenshtein(a: string, b: string): number {
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

function matchSingleToken(
  qToken: string,
  qTokenPhonetic: string,
  pWords: string[],
  pPhoneticWords: string[]
): number {
  let best = 0;

  for (const pw of pWords) {
    if (pw === qToken) return 1.0;
    if (pw.startsWith(qToken)) {
      best = Math.max(best, 0.9);
    } else if (pw.includes(qToken) && qToken.length >= 3) {
      best = Math.max(best, 0.75);
    } else if (qToken.length >= 4 && pw.length >= 4) {
      const dist = levenshtein(qToken, pw);
      const maxAllowed = qToken.length > 6 ? 2 : 1;
      if (dist <= maxAllowed) {
        best = Math.max(best, 0.7 - dist * 0.1);
      }
    }
  }

  if (best < 0.8 && qTokenPhonetic.length >= 3) {
    for (const ppw of pPhoneticWords) {
      if (ppw === qTokenPhonetic || ppw.startsWith(qTokenPhonetic)) {
        best = Math.max(best, 0.85);
      } else if (ppw.includes(qTokenPhonetic) || qTokenPhonetic.includes(ppw)) {
        best = Math.max(best, 0.75);
      } else if (ppw.length >= 4) {
        const dist = levenshtein(qTokenPhonetic, ppw);
        if (dist <= 1) {
          best = Math.max(best, 0.7);
        }
      }
    }
  }

  return best;
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
  const qWordsPhonetic = query.trim().split(/\s+/).map(normalizePhonetic);

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

    // 2. Prefix-matchning på hela namnet (t.ex. "nikita chr...")
    if (bestScore < 0) {
      if ((svClean && svClean.startsWith(qClean)) || (enClean && enClean.startsWith(qClean))) {
        bestScore = 500;
      }
    }

    const pWords = [...new Set(`${svClean} ${enClean}`.split(/[\s–—-]+/).filter(Boolean))];
    const pPhoneticWords = [
      ...new Set(
        `${svRaw} ${enRaw}`
          .split(/[\s–—-]+/)
          .map(normalizePhonetic)
          .filter((w) => w.length >= 2)
      ),
    ];

    // 3. Flerords-sökning (t.ex. "Carl Linne" -> "Carl von Linné", "Gustav Adolf" -> "Gustav II Adolf")
    if (bestScore < 0 && qWords.length > 1) {
      let allMatched = true;
      let sumQuality = 0;

      for (let idx = 0; idx < qWords.length; idx++) {
        const qw = qWords[idx]!;
        const qwp = qWordsPhonetic[idx] || '';
        const quality = matchSingleToken(qw, qwp, pWords, pPhoneticWords);
        if (quality <= 0) {
          allMatched = false;
          break;
        }
        sumQuality += quality;
      }

      if (allMatched) {
        const avgQuality = sumQuality / qWords.length;
        bestScore = 420 + avgQuality * 70; // 465 - 490
      }
    }

    // 4. Ordnivå-matchning för enkelord (t.ex. "Chrusjtjov" matchar "Nikita Chrusjtjov")
    if (bestScore < 0 && qWords.length === 1) {
      for (const w of pWords) {
        if (w === qClean) {
          bestScore = Math.max(bestScore, 460);
        } else if (w.startsWith(qClean)) {
          bestScore = Math.max(bestScore, 400 + (qClean.length / w.length) * 50);
        } else if (w.includes(qClean)) {
          bestScore = Math.max(bestScore, 300);
        }
      }
    }

    // 5. Fonetisk / Transkriberingsmatchning (t.ex. "Krusjtjov" matchar "Chrusjtjov" / "Khrushchev")
    if (bestScore < 0 && qPhonetic.length >= 3) {
      const svPhonetic = normalizePhonetic(svRaw);
      const enPhonetic = normalizePhonetic(enRaw);

      if ((svPhonetic && svPhonetic.includes(qPhonetic)) || (enPhonetic && enPhonetic.includes(qPhonetic))) {
        bestScore = 250;
      } else {
        for (const pw of pPhoneticWords) {
          if (pw.length < 3) continue;
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

    // 6. Allmän fuzzy Levenshtein på ord (tillåt 1-2 felstavningar)
    if (bestScore < 0 && qClean.length >= 4) {
      for (const w of pWords) {
        if (w.length < 4) continue;
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
