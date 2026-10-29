/**
 * Inställningar för data-pipelinen. Justera här för att ändra urvalet.
 */
export const config = {
  /** QLever är betydligt snabbare än query.wikidata.org för stora urval. */
  sparqlEndpoint: 'https://qlever.cs.uni-freiburg.de/api/wikidata',
  userAgent: 'LivslinjenQuiz/1.0 (https://github.com/ante/quiz; contact: quiz-app-dev@gmail.com)',

  /** Tidsspann (födelseår). Utökad för att omfatta antiken och forntida gestalter. */
  minBirthYear: -1500,
  maxBirthYear: 2010,
  /** Personer utan dödsdatum som är födda före detta år betraktas som "okänt", ej levande. */
  livingBornAfter: 1915,

  /** Hur många kandidater som hämtas från Wikidata (sorterat på sitelinks). */
  globalCandidateLimit: 35000,
  swedishCandidateLimit: 6000,
  /** Medborgarskap som räknas som "svensk" (Sverige). */
  swedishCountries: ['Q34'],

  /** Storlek på poolerna. */
  guessPoolSize: 2000,
  referencePoolSize: 6000,
  /** Andel svenskar i respektive pool (ungefärlig). */
  swedishShare: 0.2,
  /** Minsta antal per sekel (födelse) i Gissnings-poolen, för Tidskedjans täthet och historisk spännvidd. */
  minGuessPerCentury: {
    [-600]: 10,
    [-500]: 15,
    [-400]: 15,
    [-300]: 15,
    [-200]: 15,
    [-100]: 25,
    0: 25,
    100: 20,
    200: 15,
    300: 20,
    400: 15,
    500: 20,
    600: 20,
    700: 25,
    800: 30,
    900: 30,
    1000: 30,
    1100: 30,
    1200: 30,
    1300: 40,
    1400: 60,
    1500: 80,
    1600: 90,
    1700: 120,
    1800: 180,
    1900: 280,
    2000: 40,
  } as Record<number, number>,
  /** Max antal nu levande personer i Gissnings-poolen. */
  maxLivingInGuess: 800,

  /** Storlek på batchar mot APIerna. */
  sparqlBatchSize: 300,
  /** Minsta tid mellan SPARQL-frågor (publik tjänst – var snäll). */
  sparqlMinIntervalMs: 2000,
  commonsBatchSize: 50,
  thumbWidth: 400,
} as const;
