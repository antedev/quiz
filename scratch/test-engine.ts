import { generateClues, findContemporaries } from '../src/engine/clues.ts';
import { evaluateTransition, draftCards } from '../src/engine/chain.ts';
import type { Person } from '../src/types/person.ts';

const mockPeople: Person[] = [
  {
    id: 'Q762',
    name: { sv: 'Leonardo da Vinci', en: 'Leonardo da Vinci' },
    description: { sv: 'italienskt universalgeni', en: 'Italian polymath' },
    birthDate: { iso: '1452-04-15', year: 1452, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1519-05-02', year: 1519, precision: 'day', calendar: 'julian' },
    birthPlace: { id: 'Q154184', name: { sv: 'Anchiano', en: 'Anchiano' }, country: { id: 'Q38', name: { sv: 'Italien', en: 'Italy' } } },
    deathPlace: { id: 'Q206693', name: { sv: 'Amboise', en: 'Amboise' }, country: { id: 'Q142', name: { sv: 'Frankrike', en: 'France' } } },
    sitelinks: 300,
    tier: 'guess',
    swedish: false,
    occupations: [{ id: 'Q1028181', name: { sv: 'målare', en: 'painter' } }],
    citizenship: [{ id: 'Q38', name: { sv: 'Italien', en: 'Italy' } }],
    causeOfDeath: [],
    mannerOfDeath: [],
    notableWorks: [{ id: 'Q12418', name: { sv: 'Mona Lisa', en: 'Mona Lisa' } }],
    image: null,
    wiki: { sv: 'Leonardo_da_Vinci' },
  },
  {
    id: 'Q5592',
    name: { sv: 'Michelangelo', en: 'Michelangelo' },
    description: { sv: 'italiensk skulptör och målare', en: 'Italian sculptor and painter' },
    birthDate: { iso: '1475-03-06', year: 1475, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1564-02-18', year: 1564, precision: 'day', calendar: 'julian' },
    birthPlace: { id: 'Q1', name: { sv: 'Caprese', en: 'Caprese' } },
    deathPlace: { id: 'Q220', name: { sv: 'Rom', en: 'Rome' } },
    sitelinks: 280,
    tier: 'guess',
    swedish: false,
    occupations: [{ id: 'Q1028181', name: { sv: 'skulptör', en: 'sculptor' } }],
    citizenship: [{ id: 'Q38', name: { sv: 'Italien', en: 'Italy' } }],
    causeOfDeath: [],
    mannerOfDeath: [],
    notableWorks: [{ id: 'Q22366', name: { sv: 'David', en: 'David' } }],
    image: null,
    wiki: { sv: 'Michelangelo' },
  },
  {
    id: 'Q692',
    name: { sv: 'William Shakespeare', en: 'William Shakespeare' },
    description: { sv: 'engelsk dramatiker', en: 'English playwright' },
    birthDate: { iso: '1564-04-26', year: 1564, precision: 'day', calendar: 'julian' },
    deathDate: { iso: '1616-05-03', year: 1616, precision: 'day', calendar: 'julian' },
    birthPlace: { id: 'Q189', name: { sv: 'Stratford-upon-Avon', en: 'Stratford-upon-Avon' } },
    deathPlace: { id: 'Q189', name: { sv: 'Stratford-upon-Avon', en: 'Stratford-upon-Avon' } },
    sitelinks: 336,
    tier: 'guess',
    swedish: false,
    occupations: [{ id: 'Q214917', name: { sv: 'dramatiker', en: 'playwright' } }],
    citizenship: [{ id: 'Q145', name: { sv: 'England', en: 'England' } }],
    causeOfDeath: [],
    mannerOfDeath: [],
    notableWorks: [{ id: 'Q41567', name: { sv: 'Hamlet', en: 'Hamlet' } }],
    image: null,
    wiki: { sv: 'William_Shakespeare' },
  },
];

console.log('=== TEST 1: Spelläge 1 (Ledtrådar) ===');
const clues = generateClues(mockPeople[0]!, mockPeople, 'sv');
for (const c of clues) {
  console.log(`[${c.points}p] ${c.title} -> ${c.text}`);
}

console.log('\n=== TEST 2: Spelläge 2 (Överlapp & Växling) ===');
// Leonardo (död 1519) -> Michelangelo (född 1475)
const t1 = evaluateTransition(mockPeople[0]!, mockPeople[1]!);
console.log('Leonardo -> Michelangelo:', t1.messageSv, 'Straff:', t1.penaltyPoints);

// Michelangelo (död 1564) -> Shakespeare (född 1564) -> Exakt stafettväxling!
const t2 = evaluateTransition(mockPeople[1]!, mockPeople[2]!);
console.log('Michelangelo -> Shakespeare:', t2.messageSv, 'Straff:', t2.penaltyPoints);

// Leonardo (död 1519) -> Shakespeare (född 1564) -> Tidsglapp (45 år)!
const t3 = evaluateTransition(mockPeople[0]!, mockPeople[2]!);
console.log('Leonardo -> Shakespeare (glapp):', t3.messageSv, 'Straff:', t3.penaltyPoints);
