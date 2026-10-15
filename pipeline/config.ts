/**
 * Inställningar för data-pipelinen. Justera här för att ändra urvalet.
 */
export const config = {
  /** QLever är betydligt snabbare än query.wikidata.org för stora urval. */
  sparqlEndpoint: 'https://qlever.cs.uni-freiburg.de/api/wikidata',
  userAgent: 'LivslinjenQuiz/0.1 (https://github.com/; historical quiz data pipeline)',

  /** Tidsspann (födelseår). Utöka minYear senare för antiken. */
  minBirthYear: 1000,
  maxBirthYear: 2005,
  /** Personer utan dödsdatum som är födda före detta år betraktas som "okänt", ej levande. */
  livingBornAfter: 1915,

  /** Hur många kandidater som hämtas från Wikidata (sorterat på sitelinks). */
  globalCandidateLimit: 20000,
  swedishCandidateLimit: 4000,
  /** Medborgarskap som räknas som "svensk" (Sverige). */
  swedishCountries: ['Q34'],

  /** Storlek på poolerna. */
  guessPoolSize: 1200,
  referencePoolSize: 3000,
  /** Andel svenskar i respektive pool (ungefärlig). */
  swedishShare: 0.2,
  /** Minsta antal per sekel (födelse) i Gissnings-poolen, för Tidskedjans täthet. */
  minGuessPerCentury: { 1300: 30, 1400: 50, 1500: 70, 1600: 80, 1700: 100, 1800: 120, 1900: 150 } as Record<number, number>,
  /** Max antal nu levande personer i Gissnings-poolen. */
  maxLivingInGuess: 150,

  /** Storlek på batchar mot APIerna. */
  sparqlBatchSize: 300,
  /** Minsta tid mellan SPARQL-frågor (publik tjänst – var snäll). */
  sparqlMinIntervalMs: 2000,
  commonsBatchSize: 50,
  thumbWidth: 400,
} as const;
