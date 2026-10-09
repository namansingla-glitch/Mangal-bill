// Money maths. Everything is whole paise (integers). No floating-point money anywhere.
// Percentages are whole "basis points": 42.5% = 4250.

const MAX_RATE_PAISE = 1_000_000_000; // ₹1,00,00,000.00 per piece
export const MAX_QTY = 99_999;

/** Half-up division of two non-negative BigInts. */
function divRoundBig(n, d) {
  return (n * 2n + d) / (d * 2n);
}

/**
 * "219.33" -> 21933, "1,008" -> 100800, "₹ 62" -> 6200.
 * Returns null when the text is not a plain rupee amount with at most 2 decimals.
 */
export function parseRupees(text) {
  if (typeof text === 'number') text = String(text);
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/^(₹|rs\.?|inr)\s*/i, '');
  // commas are only allowed as thousands separators (1,234 or 1,23,456) in the whole part
  const m = /^(\d{1,3}(?:,\d{2,3})*,\d{3}|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = m[1].replace(/,/g, '');
  if (whole.length > 9) return null;
  const frac = ((m[2] || '') + '00').slice(0, 2);
  const paise = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(paise) || paise > MAX_RATE_PAISE) return null;
  return paise;
}

/** "42.5" -> 4250, "40" -> 4000. Range 0 to 100, at most 2 decimals. Otherwise null. */
export function parsePercent(text) {
  if (typeof text === 'number') text = String(text);
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/%$/, '').trim();
  const m = /^(\d{1,3})?(?:\.(\d{0,2}))?$/.exec(t);
  if (!m || (m[1] === undefined && !m[2])) return null;
  const bp = Number(m[1] || '0') * 100 + Number(((m[2] || '') + '00').slice(0, 2));
  if (bp > 10000) return null;
  return bp;
}

/** 4250 -> "42.5", 4000 -> "40", 4255 -> "42.55" */
export function percentText(bp) {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Indian digit grouping: 1234567 -> "12,34,567" */
function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** 484745 -> "4,847.45" (no symbol). Negative values get a leading minus. */
export function amountText(paise) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const s = `${groupIndian(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** 484745 -> "₹4,847.45" */
export function rupees(paise) {
  return paise < 0 ? `-₹${amountText(-paise)}` : `₹${amountText(paise)}`;
}

/** 572000 -> "₹5,720" (only for amounts that are whole rupees) */
export function rupeesWhole(paise) {
  const neg = paise < 0;
  const s = groupIndian(String(Math.floor(Math.abs(paise) / 100)));
  return `${neg ? '-' : ''}₹${s}`;
}

/**
 * One bill line. gross = rate x qty; the discount is taken off the gross and the
 * result is rounded to the nearest paisa (half rounds up).
 */
export function lineAmounts(ratePaise, qty, discountBp) {
  if (!Number.isInteger(ratePaise) || ratePaise < 0 || ratePaise > MAX_RATE_PAISE) throw new Error('bad rate');
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) throw new Error('bad quantity');
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10000) throw new Error('bad discount');
  const gross = BigInt(ratePaise) * BigInt(qty);
  const net = divRoundBig(gross * BigInt(10000 - discountBp), 10000n);
  return { gross: Number(gross), net: Number(net), discount: Number(gross - net) };
}

/** GST on a total, rounded to the nearest paisa (half up). */
export function gstAmount(totalPaise, gstBp) {
  return Number(divRoundBig(BigInt(totalPaise) * BigInt(gstBp), 10000n));
}

/** Nearest whole rupee (50 paise rounds up), returned in paise. */
export function roundToRupee(paise) {
  return Number(divRoundBig(BigInt(paise), 100n)) * 100;
}
