import { config } from '../config.ts';
import { httpFetch, sleep } from './util.ts';

export const PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;

export type Binding = Record<string, { type: string; value: string; datatype?: string; 'xml:lang'?: string }>;

let lastCall = 0;

/**
 * Kör en SPARQL-fråga mot konfigurerad endpoint (QLever som standard).
 * Strypt till max en fråga per `sparqlMinIntervalMs` för att vara snäll mot den publika tjänsten.
 * OBS: QLever har (i skrivande stund) problem med numeriska FILTER på wikibase:sitelinks
 * – sortera och filtrera i kod istället.
 */
export async function sparql(query: string): Promise<Binding[]> {
  const wait = lastCall + config.sparqlMinIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await httpFetch(config.sparqlEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'query=' + encodeURIComponent(PREFIXES + query),
  }, 6, 5000);
  const text = await res.text();
  lastCall = Date.now();
  if (!res.ok) throw new Error(`SPARQL ${res.status}: ${text.slice(0, 600)}`);
  return (JSON.parse(text) as { results: { bindings: Binding[] } }).results.bindings;
}

/** "http://www.wikidata.org/entity/Q42" -> "Q42" */
export const qid = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

export const values = (ids: string[]) => ids.map((id) => `wd:${id}`).join(' ');
