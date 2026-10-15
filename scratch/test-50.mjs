import { readJson } from '../pipeline/lib/util.ts';
import { chunk } from '../pipeline/lib/util.ts';

const sel = readJson('data/selection.json');
const batch = sel.people.slice(0, 50).map(p => p.id);
console.log('Testing batch of 50:', batch.slice(0, 5));
const t = Date.now();
const params = new URLSearchParams({
  action: 'wbgetentities',
  format: 'json',
  ids: batch.join('|'),
  props: 'labels|descriptions|claims|sitelinks',
  languages: 'sv|en',
  sitefilter: 'svwiki|enwiki',
});
const res = await fetch('https://www.wikidata.org/w/api.php?' + params.toString(), {
  headers: { 'User-Agent': 'LivslinjenQuiz/0.1 (https://github.com/; test)' }
});
console.log('Status:', res.status, 'Time:', Date.now() - t, 'ms');
const data = await res.json();
console.log('Keys count:', Object.keys(data.entities || {}).length);
