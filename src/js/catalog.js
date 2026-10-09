// Reads the rate sheet (CSV text) into the catalog the app uses.
//
// Sheet layout (wide, like the paper rate sheet):
//   #Shop name, Mangal Hardware and Sanitary        <- optional setting rows start with #
//   #Phone, 9872545358
//   #GST percent, 18
//   Brand, Type, Item, 3/4, 1, 1 1/4, 1x3/4 ...      <- header row: sizes are the column names
//   Ashirvad, Plain, Elbow, 32, 62, 140, 128 ...     <- one row per item, blank = not sold,
//                                                       ? = sold but the rate is not known yet
//
// A "long" layout (Brand, Type, Item, Size, Rate - one rate per row) also works.
// Any mistake rejects the whole sheet, so a half-right sheet never reaches a bill.

import { parseRupees, parsePercent } from './money.js';
import { normaliseSize } from './sizes.js';

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/°/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Small CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const colName = (i) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * Returns { ok, catalog, settings, errors, rateCount }.
 * catalog = { brands: [{ id, name, types: [{ id, name, items: [{ id, name, sizes: [{ key, label, rate }] }] }] }] }
 */
export function parseCatalog(csvText) {
  const errors = [];
  const settings = { phones: [] };
  const brands = [];
  const seen = new Set();
  let rateCount = 0;
  let header = null;
  let lastBrand = '';
  let lastType = '';

  const rows = parseCsv(csvText);
  rows.forEach((cells, index) => {
    const rowNo = index + 1;
    const c = cells.map((x) => String(x ?? '').trim());
    if (c.every((x) => x === '')) return;

    if (c[0].startsWith('#')) {
      const key = c[0].slice(1).trim().toLowerCase();
      const value = c[1] || '';
      if (!value) return;
      if (key === 'shop name' || key === 'shop') settings.shopName = value;
      else if (key === 'phone' || key === 'phones') {
        c.slice(1).filter(Boolean).forEach((v) => v.split(/[;/]/).map((p) => p.trim()).filter(Boolean).forEach((p) => settings.phones.push(p)));
      } else if (key === 'gst percent' || key === 'gst' || key === 'gst %') {
        const bp = parsePercent(value);
        if (bp === null) errors.push(`Row ${rowNo}: GST percent "${value}" is not a number between 0 and 100.`);
        else settings.gstBp = bp;
      } else if (key === 'rates updated' || key === 'rates date') settings.ratesDate = value;
      return; // unknown # rows are notes
    }

    if (!header) {
      if (c[0].toLowerCase() !== 'brand') {
        errors.push(`Row ${rowNo}: the first row of rates must be the heading row starting with "Brand, Type, Item".`);
        header = { broken: true };
        return;
      }
      const lower = c.map((x) => x.toLowerCase());
      if (lower[1] !== 'type' || lower[2] !== 'item') {
        errors.push(`Row ${rowNo}: the heading row must start with "Brand, Type, Item".`);
        header = { broken: true };
        return;
      }
      if (lower[3] === 'size' && lower[4] === 'rate') {
        header = { long: true };
      } else {
        const sizes = [];
        const keys = new Set();
        for (let i = 3; i < c.length; i++) {
          if (!c[i]) continue;
          const size = normaliseSize(c[i]);
          if (keys.has(size.key)) errors.push(`Row ${rowNo}: size "${c[i]}" appears twice in the heading row.`);
          keys.add(size.key);
          sizes.push({ col: i, ...size });
        }
        if (!sizes.length) errors.push(`Row ${rowNo}: the heading row has no sizes after "Item".`);
        header = { sizes };
      }
      return;
    }
    if (header.broken) return;

    const brandName = c[0] || lastBrand;
    const typeName = c[0] && !c[1] ? '' : c[1] || lastType;
    const itemName = c[2];
    if (!brandName || !typeName || !itemName) {
      errors.push(`Row ${rowNo}: Brand, Type and Item are all needed.`);
      return;
    }
    lastBrand = brandName;
    lastType = typeName;

    const rates = [];
    if (header.long) {
      const size = normaliseSize(c[3]);
      if (!size) {
        errors.push(`Row ${rowNo}: the size is missing.`);
        return;
      }
      rates.push({ size, text: c[4] || '', where: `Row ${rowNo}` });
    } else {
      for (const s of header.sizes) rates.push({ size: s, text: c[s.col] || '', where: `Row ${rowNo}, column ${colName(s.col)}` });
      for (let i = 3; i < c.length; i++) {
        if (c[i] && !header.sizes.some((s) => s.col === i)) errors.push(`Row ${rowNo}, column ${colName(i)}: "${c[i]}" is under a column with no size in the heading row.`);
      }
    }

    // In the wide layout an item with every box empty is still listed (the app shows it as "No rate yet").
    const place = () => {
      let brand = brands.find((b) => b.id === slug(brandName));
      if (!brand) brands.push((brand = { id: slug(brandName), name: brandName, types: [] }));
      let type = brand.types.find((t) => t.id === slug(typeName));
      if (!type) brand.types.push((type = { id: slug(typeName), name: typeName, items: [] }));
      let item = type.items.find((it) => it.id === slug(itemName));
      if (!item) type.items.push((item = { id: slug(itemName), name: itemName, sizes: [] }));
      return item;
    };
    if (!header.long) place();

    for (const r of rates) {
      if (r.text === '') {
        if (header.long) errors.push(`${r.where}: the rate is missing.`);
        continue; // wide layout: blank means this size is not sold
      }
      // "?" means: we sell this size but the rate is not known yet. The app shows it greyed out.
      const pending = r.text === '?';
      const paise = pending ? null : parseRupees(r.text);
      if (!pending && (paise === null || paise <= 0)) {
        errors.push(`${r.where}: "${r.text}" is not a valid rate (${itemName}, ${r.size.label}).`);
        continue;
      }
      const id = [slug(brandName), slug(typeName), slug(itemName), r.size.key].join('|');
      if (seen.has(id)) {
        errors.push(`${r.where}: ${brandName} ${typeName} ${itemName} ${r.size.label} is in the sheet twice.`);
        continue;
      }
      seen.add(id);
      place().sizes.push({ key: r.size.key, label: r.size.label, rate: paise });
      if (!pending) rateCount++;
    }
  });

  if (!header) errors.push('The sheet has no heading row starting with "Brand, Type, Item".');
  else if (!errors.length && rateCount === 0) errors.push('The sheet has no rates in it.');

  return { ok: errors.length === 0, catalog: { brands }, settings, errors, rateCount };
}

export function findItem(catalog, brandId, typeId, itemId) {
  const brand = catalog.brands.find((b) => b.id === brandId);
  const type = brand && brand.types.find((t) => t.id === typeId);
  const item = type && type.items.find((it) => it.id === itemId);
  return item ? { brand, type, item } : null;
}
