// The bill: lines, one discount per brand + group, totals, GST and round-off.
// Pure data in, pure data out. No screen code here.

import { lineAmounts, gstAmount, roundToRupee } from './money.js';

export const BILL_VERSION = 1;

/** Types whose name is not added in brackets on the bill ("Elbow ¾"" not "Elbow (Plain) ¾""). */
const NO_BRACKET = new Set(['plain', 'pipe']);

export function newBill(now = Date.now()) {
  return { v: BILL_VERSION, id: `b${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, createdAt: now, customer: '', lines: [], discounts: {}, gst: null, finishedAt: null, nextLine: 1 };
}

/** Each brand has one discount per group. The group is the item type (Pipe, Plain, Brass ...). */
export function groupKey(brandId, typeId) {
  return `${brandId}|${typeId}`;
}

export function lineName(line) {
  const bracket = NO_BRACKET.has(line.typeId) ? '' : ` (${line.typeName})`;
  return `${line.itemName}${bracket} ${line.sizeLabel}`;
}

/** Discount for a line's group, or null when nobody has typed it yet. */
export function discountFor(bill, brandId, typeId) {
  const bp = bill.discounts[groupKey(brandId, typeId)];
  return Number.isInteger(bp) ? bp : null;
}

export function setDiscount(bill, brandId, typeId, bp) {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error('bad discount');
  bill.discounts[groupKey(brandId, typeId)] = bp;
}

/**
 * Adds an item. The same item and size already on the bill gets its quantity increased
 * instead of a second line. Returns the line.
 */
export function addLine(bill, entry, qty) {
  if (!Number.isInteger(qty) || qty < 1) throw new Error('bad quantity');
  const existing = bill.lines.find((l) => l.brandId === entry.brandId && l.typeId === entry.typeId && l.itemId === entry.itemId && l.sizeKey === entry.sizeKey);
  if (existing) {
    existing.qty += qty;
    existing.rate = entry.rate;
    return existing;
  }
  const line = { id: bill.nextLine++, ...entry, qty };
  bill.lines.push(line);
  return line;
}

export function updateLine(bill, lineId, changes) {
  const line = bill.lines.find((l) => l.id === lineId);
  if (!line) return null;
  Object.assign(line, changes);
  return line;
}

/** Removes a line and returns { line, index } so it can be put back (undo). */
export function removeLine(bill, lineId) {
  const index = bill.lines.findIndex((l) => l.id === lineId);
  if (index < 0) return null;
  const [line] = bill.lines.splice(index, 1);
  return { line, index };
}

export function restoreLine(bill, removed) {
  bill.lines.splice(Math.min(removed.index, bill.lines.length), 0, removed.line);
}

/**
 * Everything the screens and the printed estimate need, worked out in whole paise.
 * A group with no discount typed yet counts as 0% and is listed in `missing`.
 */
export function computeTotals(bill, gstBp) {
  const brands = [];
  const missing = [];
  let total = 0;
  let pieces = 0;
  for (const line of bill.lines) {
    let brand = brands.find((b) => b.id === line.brandId);
    if (!brand) brands.push((brand = { id: line.brandId, name: line.brandName, subtotal: 0, groups: [], lines: [] }));
    let group = brand.groups.find((g) => g.typeId === line.typeId);
    if (!group) {
      const bp = discountFor(bill, line.brandId, line.typeId);
      group = { typeId: line.typeId, name: line.typeName, discountBp: bp };
      brand.groups.push(group);
      if (bp === null) missing.push({ brandId: line.brandId, brandName: line.brandName, typeId: line.typeId, typeName: line.typeName });
    }
    const bp = group.discountBp ?? 0;
    const a = lineAmounts(line.rate, line.qty, bp);
    brand.lines.push({ ...line, name: lineName(line), discountBp: bp, gross: a.gross, net: a.net });
    brand.subtotal += a.net;
    total += a.net;
    pieces += line.qty;
  }
  const gst = gstAmount(total, gstBp);
  const withSum = total + gst;
  const withRounded = roundToRupee(withSum);
  const withoutRounded = roundToRupee(total);
  return {
    brands,
    missing,
    lineCount: bill.lines.length,
    pieces,
    total,
    gstBp,
    withGst: { gst, sum: withSum, grand: withRounded, roundOff: withRounded - withSum },
    withoutGst: { gst: 0, sum: total, grand: withoutRounded, roundOff: withoutRounded - total },
  };
}

/** The final figures for a finished bill, depending on the GST choice. */
export function finalFigures(totals, withGst) {
  const f = withGst ? totals.withGst : totals.withoutGst;
  return { total: totals.total, withGst: !!withGst, gstBp: totals.gstBp, gst: f.gst, roundOff: f.roundOff, grand: f.grand };
}
