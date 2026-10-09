// Turns what someone types in the rate sheet ("3/4", "1 1/4x3/4", "1.25") into a
// tidy size label (¾", 1¼" × ¾") and a stable key.

const FRACTION_CHARS = { '1/4': '¼', '1/2': '½', '3/4': '¾' };
const UNICODE_FRACTIONS = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4' };
const DECIMALS = { '25': '1/4', '5': '1/2', '50': '1/2', '75': '3/4' };

function parsePart(raw) {
  let t = String(raw).trim();
  if (!t) return null;
  t = t.replace(/[¼½¾]/g, (c) => UNICODE_FRACTIONS[c]).replace(/\s+/g, ' ').trim();
  let whole = '';
  let frac = '';
  let m;
  if ((m = /^(\d+)$/.exec(t))) {
    whole = m[1];
  } else if ((m = /^(\d+)\/(\d+)$/.exec(t))) {
    // "11/4" is how 1 1/4 often gets typed without the space
    if (m[1].length === 2 && Number(m[1]) > Number(m[2]) && FRACTION_CHARS[`${m[1][1]}/${m[2]}`]) {
      whole = m[1][0];
      frac = `${m[1][1]}/${m[2]}`;
    } else frac = `${m[1]}/${m[2]}`;
  } else if ((m = /^(\d+)[ -](\d+)\/(\d+)$/.exec(t))) {
    whole = m[1];
    frac = `${m[2]}/${m[3]}`;
  } else if ((m = /^(\d*)\.(\d+)$/.exec(t)) && DECIMALS[m[2]]) {
    whole = m[1];
    frac = DECIMALS[m[2]];
  } else {
    return null;
  }
  whole = whole.replace(/^0+/, '');
  if (!whole && !frac) return null;
  const key = [whole, frac].filter(Boolean).join(' ');
  const label = `${whole}${frac ? FRACTION_CHARS[frac] || (whole ? ' ' : '') + frac : ''}"`;
  return { key, label };
}

function parseParts(text) {
  const parts = text.split(/\s*x\s*/).map(parsePart);
  if (!parts.length || !parts.every(Boolean)) return null;
  return { key: parts.map((p) => p.key).join('x'), label: parts.map((p) => p.label).join(' × ') };
}

// Words after a size that are a unit, not a kind: "20 mm" stays "20 mm".
const UNITS = new Set(['mm', 'cm', 'm', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres', 'ft', 'feet', 'foot', 'kg', 'kgs', 'g', 'gm', 'gms', 'l', 'ltr', 'litre', 'liter', 'pc', 'pcs', 'no', 'nos']);
const kindWord = (w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));

/**
 * normaliseSize('1 1/4 x 3/4') -> { key: '1 1/4x3/4', label: '1¼" × ¾"' }
 *
 * A size can carry a kind after it, for the same size sold in two makes:
 * normaliseSize('3/4x1/2 Heavy') -> { key: '3/4x1/2 heavy', label: '¾" × ½" Heavy', base: '¾" × ½"', kind: 'Heavy' }
 *
 * Anything it does not recognise is kept exactly as typed.
 */
export function normaliseSize(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .replace(/["″”“]|''/g, '')
    .replace(/\b(inch(es)?|in)\b\.?/g, '')
    .replace(/×|\*|\bby\b/g, 'x')
    .trim();
  const plain = parseParts(cleaned);
  if (plain) return plain;
  const m = /^([^a-wyz]*?[\d¼½¾])\s*[-–(\[]?\s*([a-z][a-z ]*?)\s*[)\]]?$/.exec(cleaned);
  if (m) {
    const size = parseParts(m[1].trim());
    const words = m[2].split(/\s+/).filter(Boolean);
    if (size && words.length && words.length <= 3 && !words.some((w) => UNITS.has(w))) {
      const kind = words.map(kindWord).join(' ');
      return { key: `${size.key} ${kind.toLowerCase()}`, label: `${size.label} ${kind}`, base: size.label, kind };
    }
  }
  return { key: text.toLowerCase().replace(/\s+/g, ' '), label: text };
}
