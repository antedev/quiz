import type { DatePrecision, HistDate } from '../../src/types/person.ts';
import type { RawDate } from '../02-entities.ts';

const JULIAN = 'Q1985786';

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/**
 * Wikidatas wbgetentities returnerar datumet i den historiska kalendern (t.ex. 1452-04-15 för Leonardo da Vinci).
 */
export function toHistDate(raw: RawDate): HistDate | null {
  if (raw.precision < 9) return null; // decennium/sekel är för osäkert för spelet
  const m = raw.time.match(/^([+-]?\d+)-(\d\d)-(\d\d)/);
  if (!m) return null;
  const year = Number(m[1]);
  let month = Number(m[2]) || 1;
  let day = Number(m[3]) || 1;
  const julian = raw.calendar === JULIAN || raw.calendar.endsWith('Q1985786');
  const precision: DatePrecision = raw.precision >= 11 ? 'day' : raw.precision === 10 ? 'month' : 'year';
  if (precision !== 'day') day = 1;
  if (precision === 'year') month = 1;
  const iso = `${year < 0 ? '-' : ''}${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return { iso, year, precision, calendar: julian ? 'julian' : 'gregorian' };
}

/** Bästa datumet: preferred rank före normal, sedan högst precision. */
export function bestDate(list: RawDate[]): HistDate | null {
  const sorted = [...list]
    .filter((d) => d.precision >= 9)
    .sort((a, b) => (a.rank === b.rank ? b.precision - a.precision : a.rank === 'preferred' ? -1 : 1));
  for (const d of sorted) {
    const h = toHistDate(d);
    if (h) return h;
  }
  return null;
}
