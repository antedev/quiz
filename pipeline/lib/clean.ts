/**
 * Rensning av Wikidata-beskrivningar så att de inte avslöjar årtal/sekel.
 * Ex: "italiensk konstnär (1452–1519)" -> "italiensk konstnär"
 *     "19th-century French painter"     -> "French painter"
 */
export function cleanDescription(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let s = text;
  // Parenteser som innehåller siffror: "(1452–1519)", "(född 1950)", "(c. 1400)"
  s = s.replace(/\s*[([][^)\]]*\d[^)\]]*[)\]]/g, '');
  // Sekel: "19th-century", "19th century", "1800-talets", "1800-tals-", "1500-talet"
  s = s.replace(/\b\d{1,2}(st|nd|rd|th)[\s-]+centur(y|ies)\b\s*/gi, '');
  s = s.replace(/\b\d{1,2}00-tal(et|ets|s)?(-|\b)\s*/gi, '');
  // "born 1950", "född 1950", "died 1600", "död 1600", "b. 1950", "d. 1600", "c. 1450", "ca 1450", "fl. 1500"
  s = s.replace(/\b(born|died|född|död|b\.|d\.|c\.|ca\.?|circa|fl\.|active|aktiv)\s*\d{3,4}\b/gi, '');
  // Årtalsintervall: "1452–1519", "1452-1519", "1452 – 1519"
  s = s.replace(/\b\d{3,4}\s*[–—-]\s*\d{2,4}\b/g, '');
  // "from 1611 to 1632", "från 1611 till 1632", "since 2010", "sedan 2010"
  s = s.replace(/\b(from|från|since|sedan|until|till|to|in|i|år)\s+\d{3,4}\b/gi, '');
  // Kvarvarande fristående årtal
  s = s.replace(/\b1\d{3}\b|\b20\d{2}\b/g, '');
  // Städa upp skiljetecken/blanksteg
  s = s
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/([,;:])(?=[,;:.]|\s*$)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();
  return s.length >= 3 ? s : undefined;
}
