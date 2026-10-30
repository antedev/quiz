/**
 * Steg 3: Hämta miniatyr-URL och licens/upphovsperson för porträttbilder från Wikimedia Commons.
 * Inkrementell: redan hämtade filer hoppas över.
 *
 * In:  data/cache/entities.json
 * Ut:  data/cache/media.json
 */
import { join } from 'node:path';
import { config } from './config.ts';
import { CACHE_DIR, chunk, httpFetch, readJson, readJsonIfExists, sleep, writeJson } from './lib/util.ts';
import type { RawEntities, RawClaim } from './02-entities.ts';
import type { ImageInfo } from '../src/types/person.ts';

const API = 'https://commons.wikimedia.org/w/api.php';

/** Väljer bästa bilden: preferred rank först, annars första. */
export function pickImage(claims: RawClaim[] | undefined): string | undefined {
  if (!claims?.length) return undefined;
  return (claims.find((c) => c.rank === 'preferred') ?? claims[0])!.value;
}

const stripHtml = (s: string) =>
  s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

interface ApiPage {
  title: string;
  missing?: string;
  imageinfo?: {
    thumburl?: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}

async function main() {
  const entities = readJson<RawEntities>(join(CACHE_DIR, 'entities.json'));
  const mediaPath = join(CACHE_DIR, 'media.json');
  const media = readJsonIfExists<Record<string, ImageInfo | null>>(mediaPath, {});

  const files = new Set<string>();
  for (const p of Object.values(entities.people)) {
    const f = pickImage(p.claims.P18);
    if (f) files.add(f);
  }
  const todo = [...files].filter((f) => !(f in media));
  console.log(`${files.size} bilder, ${todo.length} att hämta.`);

  const batches = chunk(todo, config.commonsBatchSize);
  for (const [i, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(config.thumbWidth),
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
      titles: batch.map((f) => `File:${f}`).join('|'),
    });
    const res = await httpFetch(`${API}?${params}`);
    const json = (await res.json()) as {
      query?: { pages: ApiPage[]; normalized?: { from: string; to: string }[] };
    };
    const fromNormalized = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of json.query?.pages ?? []) {
      const original = (fromNormalized.get(page.title) ?? page.title).replace(/^File:/, '');
      const ii = page.imageinfo?.[0];
      if (page.missing !== undefined || !ii?.thumburl) {
        media[original] = null;
        continue;
      }
      const meta = ii.extmetadata ?? {};
      media[original] = {
        file: original,
        thumb: ii.thumburl,
        page: ii.descriptionurl,
        artist: meta.Artist ? stripHtml(meta.Artist.value).slice(0, 200) : undefined,
        license: meta.LicenseShortName?.value,
        licenseUrl: meta.LicenseUrl?.value,
      };
    }
    // Filer som inte kom tillbaka alls markeras som saknade så vi inte frågar i evighet.
    for (const f of batch) if (!(f in media)) media[f] = null;
    console.log(`  [Bilder ${i + 1}/${batches.length}] (${Object.keys(media).length} bilder sparade)`);
    if ((i + 1) % 2 === 0 || i === batches.length - 1) {
      writeJson(mediaPath, media, false);
    }
    await sleep(400);
  }
  writeJson(mediaPath, media, false);
  console.log('Klart: data/cache/media.json');
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('pipeline/03-media.ts');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
