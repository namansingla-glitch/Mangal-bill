// Screens and taps. All money maths lives in money.js and bill.js; this file only shows it.

import { CONFIG, pictureFor, brandColor } from './config.js';
import bundledCsv from '../data/rates.csv';
import * as store from './store.js';
import { parseCatalog, findItem } from './catalog.js';
import { rupees, rupeesWhole, amountText, parsePercent, percentText, lineAmounts, MAX_QTY } from './money.js';
import { newBill, addLine, removeLine, restoreLine, setDiscount, discountFor, computeTotals, finalFigures, lineName } from './bill.js';
import { receiptPng, receiptPdf, shareFile, fileName, dateText, timeText } from './receipt.js';

const MAX_SAVED_BILLS = 1000;
const RATES_RECHECK_MS = 10 * 60 * 1000;

const S = {
  catalog: null,
  settings: null,
  rates: null, // { source: 'app' | 'sheet', firstSeenAt, checkedAt }
  bill: null,
  brandId: null,
  typeId: null,
  stack: [{ name: 'home' }],
  toast: null,
  busy: false,
};

// ---------- small helpers ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  check: '<path d="M5 12.5 L9.5 17 L19 7.5" />',
  back: '<path d="M14.5 5 L7.5 12 L14.5 19" />',
  next: '<path d="M9 5 L16 12 L9 19" />',
  close: '<path d="M6 6 L18 18 M18 6 L6 18" />',
  plus: '<path d="M12 5 V19 M5 12 H19" />',
  erase: '<path d="M9 5 H21 V19 H9 L3 12 Z M12.5 9.5 L17.5 14.5 M17.5 9.5 L12.5 14.5" />',
};
function icon(name, size = 24, stroke = 3) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span.firstChild;
}

function assetUrl(name) {
  const inline = globalThis.__MB_ASSETS;
  return (inline && inline[name]) || `img/${name}.webp`;
}

function picture(typeId, itemId, itemName, cls) {
  const name = pictureFor(typeId, itemId);
  if (name) return h('img', { class: cls, src: assetUrl(name), alt: '', loading: 'lazy', decoding: 'async' });
  const initials = itemName.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return h('span', { class: `${cls} no-pic` }, initials);
}

function tintOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.88);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
function shadeOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c * 0.78);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
function accentStyle(hex) {
  return `--accent:${hex};--accent-tint:${tintOf(hex)};--accent-dark:${shadeOf(hex)}`;
}
function colorOfBrand(brandId) {
  const index = S.catalog.brands.findIndex((b) => b.id === brandId);
  return brandColor(brandId, index < 0 ? 0 : index);
}

/** Long amounts get a smaller size so they stay on one line instead of breaking mid-number. */
function lenClass(text) {
  const n = text.length;
  return n >= 14 ? ' len-xl' : n >= 12 ? ' len-l' : n >= 10 ? ' len-m' : '';
}
function amount(tag, cls, text) {
  return h(tag, { class: cls + lenClass(text) }, text);
}
const amountEl = amount;

function saveBill() {
  store.save('bill', S.bill);
}
function totals() {
  return computeTotals(S.bill, S.settings.gstBp);
}

// ---------- rates ----------

function applyCsv(csv, fallbackDate) {
  const r = parseCatalog(csv);
  if (!r.ok) return r;
  S.catalog = r.catalog;
  S.settings = {
    shopName: r.settings.shopName || CONFIG.shopName,
    phones: r.settings.phones.length ? r.settings.phones : CONFIG.phones,
    gstBp: r.settings.gstBp ?? CONFIG.gstBp,
    ratesDate: r.settings.ratesDate || fallbackDate || '',
  };
  const brand = S.catalog.brands.find((b) => b.id === S.brandId) || S.catalog.brands[0];
  S.brandId = brand.id;
  const type = brand.types.find((t) => t.id === S.typeId) || brand.types.find((t) => t.id === 'plain') || brand.types[0];
  S.typeId = type.id;
  return r;
}

function loadRatesAtStart() {
  const cached = store.load('rates');
  if (cached && cached.csv && applyCsv(cached.csv, dateText(cached.firstSeenAt)).ok) {
    S.rates = { source: 'sheet', firstSeenAt: cached.firstSeenAt, checkedAt: cached.checkedAt, csv: cached.csv };
    return;
  }
  const r = applyCsv(bundledCsv, '');
  if (!r.ok) throw new Error('The rates inside the app are broken: ' + r.errors.join(' '));
  S.rates = { source: 'app', firstSeenAt: null, checkedAt: store.load('ratesCheckedAt'), csv: bundledCsv };
}

function ratesUrl() {
  return store.load('ratesUrl') || CONFIG.ratesUrl || '';
}

async function loadRemoteSettings() {
  if (!location.protocol.startsWith('http') || globalThis.__MB_ASSETS) return; // single-file preview has no settings file
  try {
    const res = await fetch('settings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (json && typeof json.ratesUrl === 'string') store.save('ratesUrl', json.ratesUrl.trim());
  } catch {
    /* offline or no settings file: keep what we have */
  }
}

let checking = false;
async function checkRates(manual) {
  const url = ratesUrl();
  if (!url) {
    if (manual) toast('The shared rate sheet is not connected yet. The app is using the rates inside it.');
    return;
  }
  if (checking) return;
  checking = true;
  if (manual) toast('Checking for new rates…');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let text;
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const now = Date.now();
    store.save('ratesCheckedAt', now);
    S.rates.checkedAt = now;
    if (text === S.rates.csv) {
      store.remove('ratesError');
      if (S.rates.source === 'sheet') store.save('rates', { csv: text, firstSeenAt: S.rates.firstSeenAt, checkedAt: now });
      if (manual) toast('Rates are already up to date.');
      return;
    }
    const looksLikePage = /^\s*</.test(text);
    const r = looksLikePage ? { ok: false, errors: ['The rate sheet link opened a web page, not the sheet. Publish the sheet to the web as CSV and use that link.'] } : parseCatalog(text);
    if (!r.ok) {
      const before = store.load('ratesError');
      store.save('ratesError', { at: now, errors: r.errors.slice(0, 30), sample: text.slice(0, 200) });
      if (manual || !before || before.sample !== text.slice(0, 200)) toast('The new rate sheet has mistakes. The old rates are still in use.', { label: 'See', run: () => push({ name: 'rates' }) });
      return;
    }
    store.save('rates', { csv: text, firstSeenAt: now, checkedAt: now });
    store.remove('ratesError');
    applyCsv(text, dateText(now));
    S.rates = { source: 'sheet', firstSeenAt: now, checkedAt: now, csv: text };
    toast('New rates loaded.');
    render();
  } catch {
    if (manual) toast('Could not reach the rate sheet. Check the internet and try again.');
  } finally {
    checking = false;
    if (top().name === 'rates') render();
  }
}

// ---------- moving between screens ----------

let useHistory = true;
function top() {
  return S.stack[S.stack.length - 1];
}
function push(view) {
  S.toast = null;
  S.stack.push(view);
  if (useHistory) {
    try {
      history.pushState({ n: S.stack.length }, '');
    } catch {
      useHistory = false;
    }
  }
  render();
}
/** Goes back `count` steps. With `then`, runs it once the step back has happened. */
function pop(count = 1, then) {
  count = Math.min(count, S.stack.length - 1);
  if (count <= 0) {
    if (then) then();
    return;
  }
  if (useHistory) {
    afterPop = then || null;
    history.go(-count);
  } else {
    S.stack.length -= count;
    S.toast = null;
    if (then) then();
    render();
  }
}
let afterPop = null;
function onPopState(e) {
  const want = Math.max(1, (e.state && e.state.n) || 1);
  if (want < S.stack.length) S.stack.length = want;
  S.toast = null;
  const then = afterPop;
  afterPop = null;
  if (then) then();
  render();
}

// ---------- toast ----------

let toastTimer = 0;
function toast(text, action) {
  S.toast = { text, action };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    renderToast();
  }, action ? 6000 : 3200);
  renderToast();
}
function renderToast() {
  const root = document.getElementById('toast');
  root.replaceChildren();
  if (!S.toast) return;
  const t = S.toast;
  root.append(
    h('div', { class: 'toast', role: 'status' }, h('span', null, t.text), t.action && h('button', { class: 'toast-btn', onclick: () => { S.toast = null; renderToast(); t.action.run(); } }, t.action.label)),
  );
}

// ---------- home ----------

function homeScreen() {
  const brand = S.catalog.brands.find((b) => b.id === S.brandId);
  const type = brand.types.find((t) => t.id === S.typeId);
  const t = totals();
  const accent = colorOfBrand(brand.id);
  return h(
    'div',
    { class: 'screen home', style: `--accent:${accent}` },
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'top-row' },
        h('div', { class: 'top-text' }, h('div', { class: 'shop' }, S.settings.shopName), h('button', { class: 'rates-link', onclick: () => push({ name: 'rates' }) }, S.settings.ratesDate ? `Rates updated ${S.settings.ratesDate}` : 'Rates')),
        h('button', { class: 'pill-btn', onclick: () => push({ name: 'old' }) }, 'Old bills'),
      ),
      h(
        'div',
        { class: 'brands' },
        S.catalog.brands.map((b) => {
          const on = b.id === brand.id;
          const c = colorOfBrand(b.id);
          return h(
            'button',
            { class: `brand-btn${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', style: `--brand:${c}`, onclick: () => selectBrand(b.id) },
            on && icon('check', 22, 3.4),
            h('span', null, b.name),
          );
        }),
      ),
    ),
    h(
      'main',
      { class: 'home-body' },
      h(
        'div',
        { class: 'types', style: `--n:${Math.min(brand.types.length, 4)}` },
        brand.types.map((ty) => h('button', { class: `type-btn${ty.id === type.id ? ' on' : ''}`, 'aria-pressed': ty.id === type.id ? 'true' : 'false', onclick: () => selectType(ty.id) }, ty.name)),
      ),
      h(
        'div',
        { class: 'grid' },
        type.items.map((item) =>
          item.sizes.some((sz) => sz.rate !== null)
            ? h(
                'button',
                { class: 'tile', onclick: () => openItem(brand.id, type.id, item.id) },
                h('span', { class: 'tile-pic' }, picture(type.id, item.id, item.name, 'tile-img')),
                h('span', { class: 'tile-name' }, item.name),
                h('span', { class: 'tile-plus' }, icon('plus', 14, 4)),
              )
            : h(
                'button',
                { class: 'tile off', 'aria-disabled': 'true', onclick: () => toast(`${brand.name} ${type.name} ${item.name} has no rate yet. Add its rate in the rate sheet.`) },
                h('span', { class: 'tile-pic' }, picture(type.id, item.id, item.name, 'tile-img')),
                h('span', { class: 'tile-name' }, item.name),
                h('span', { class: 'tile-off' }, 'No rate yet'),
              ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'billbar' },
      h('div', { class: 'billbar-count' }, String(t.lineCount)),
      h('div', { class: 'billbar-text' }, h('div', { class: 'billbar-label' }, t.lineCount === 1 ? 'item in bill' : 'items in bill'), amount('div', 'billbar-total', rupees(t.total))),
      h('button', { class: 'btn action billbar-btn', onclick: () => push({ name: 'bill' }) }, h('span', null, 'View bill'), icon('next', 22)),
    ),
  );
}

function selectBrand(id) {
  S.brandId = id;
  const brand = S.catalog.brands.find((b) => b.id === id);
  if (!brand.types.some((t) => t.id === S.typeId)) S.typeId = (brand.types.find((t) => t.id === 'plain') || brand.types[0]).id;
  store.save('ui', { brandId: S.brandId, typeId: S.typeId });
  render();
}
function selectType(id) {
  S.typeId = id;
  store.save('ui', { brandId: S.brandId, typeId: S.typeId });
  render();
}

// ---------- item sheet (size, quantity, discount) ----------

function openItem(brandId, typeId, itemId, line) {
  const found = findItem(S.catalog, brandId, typeId, itemId);
  const existing = discountFor(S.bill, brandId, typeId);
  const sizes = found ? found.item.sizes.filter((sz) => sz.rate !== null) : [];
  push({
    name: 'item',
    brandId,
    typeId,
    itemId,
    sizeKey: line ? line.sizeKey : sizes.length === 1 ? sizes[0].key : null,
    qty: line ? String(line.qty) : '',
    disc: existing === null ? '' : percentText(existing),
    active: 'qty',
    fresh: !!line,
    editId: line ? line.id : null,
    line: line || null,
  });
}

function pressKey(v, key) {
  const field = v.active === 'disc' || v.name === 'discount' ? 'disc' : 'qty';
  let s = v[field];
  if (key === 'back') {
    s = v.fresh ? '' : s.slice(0, -1);
  } else {
    if (v.fresh) s = '';
    if (field === 'qty') {
      if (key === '.') return;
      const next = (s + key).replace(/^0+(?=\d)/, '');
      if (next === '0' || Number(next) > MAX_QTY) return;
      s = next;
    } else {
      const next = key === '.' ? (s.includes('.') ? s : (s || '0') + '.') : s === '0' ? key : s + key;
      if (!/^\d{0,3}(\.\d{0,2})?$/.test(next)) return;
      if (parsePercent(next.replace(/\.$/, '') || '0') === null) return;
      s = next;
    }
  }
  v[field] = s;
  v.fresh = false;
  renderSheetOnly();
}

function keypad(v, allowDot) {
  const key = (label, value, cls, aria) => h('button', { class: `key ${cls || ''}`, 'aria-label': aria || null, disabled: value === '.' && !allowDot ? true : null, onclick: () => pressKey(v, value) }, label);
  return h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d)), key('.', '.', 'key-soft', 'Decimal point'), key('0', '0'), key(icon('erase', 28, 2.2), 'back', 'key-soft', 'Delete last digit'));
}

function itemSheet(v) {
  const found = findItem(S.catalog, v.brandId, v.typeId, v.itemId);
  if (!found && !v.line) {
    return h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grab' }), h('div', { class: 'ask' }, h('div', { class: 'ask-title' }, 'This item is not in the rate list any more'), h('div', { class: 'ask-sub' }, 'The rates were updated while this was open.')), h('button', { class: 'btn soft', onclick: () => pop() }, 'Close'));
  }
  // An item being edited may have left the rate sheet since it was added: fall back to the line itself.
  const brandName = found ? found.brand.name : v.line.brandName;
  const typeName = found ? found.type.name : v.line.typeName;
  const itemName = found ? found.item.name : v.line.itemName;
  const sizes = found ? found.item.sizes.slice() : [];
  if (v.line && !sizes.some((s) => s.key === v.line.sizeKey)) sizes.push({ key: v.line.sizeKey, label: v.line.sizeLabel, rate: v.line.rate });
  const size = sizes.find((s) => s.key === v.sizeKey && s.rate !== null) || null;
  const qty = v.qty === '' ? 0 : Number(v.qty);
  const discBp = v.disc === '' ? null : parsePercent(v.disc.replace(/\.$/, ''));
  const accent = colorOfBrand(v.brandId);
  const group = `${brandName} ${typeName}`;
  const hadDiscount = discountFor(S.bill, v.brandId, v.typeId) !== null;

  let need = null;
  if (!size) need = 'Choose a size';
  else if (qty < 1) need = 'Type the quantity';
  else if (discBp === null) need = 'Type the discount';

  const amounts = size && qty >= 1 ? lineAmounts(size.rate, qty, discBp ?? 0) : null;
  const setActive = (field) => {
    v.active = field;
    v.fresh = v[field] !== '';
    renderSheetOnly();
  };
  const field = (name, label, value, suffix) =>
    h(
      'button',
      { class: `field${v.active === name ? ' on' : ''}${name === 'disc' && discBp === null && v.active !== 'disc' && size && qty >= 1 ? ' wanted' : ''}`, 'aria-pressed': v.active === name ? 'true' : 'false', 'data-field': name, onclick: () => setActive(name) },
      h('span', { class: 'field-label' }, label),
      h('span', { class: `field-value${v.active === name && v.fresh ? ' fresh' : ''}` }, value === '' ? h('span', { class: v.active === name ? 'caret' : 'field-empty' }, v.active === name ? '' : '—') : [value, suffix && h('span', { class: 'field-suffix' }, suffix), v.active === name && !v.fresh && h('span', { class: 'caret' })]),
    );

  return h(
    'div',
    { class: 'sheet item-sheet', style: accentStyle(accent), role: 'dialog', 'aria-label': itemName },
    h('div', { class: 'grab' }),
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'sheet-pic' }, picture(v.typeId, v.itemId, itemName, 'sheet-img')),
      h('div', { class: 'sheet-title' }, h('div', { class: 'sheet-name' }, itemName), h('div', { class: 'sheet-sub' }, h('span', { class: 'tag' }, brandName), h('span', null, typeName))),
      h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => pop() }, icon('close', 22, 2.6)),
    ),
    h(
      'div',
      { class: 'sizes' },
      sizes.map((s) =>
        s.rate === null
          ? h('button', { class: 'size off', disabled: true }, h('span', { class: 'size-label' }, s.label), h('span', { class: 'size-rate' }, 'No rate yet'))
          : h(
              'button',
              { class: `size${s.key === v.sizeKey ? ' on' : ''}`, 'aria-pressed': s.key === v.sizeKey ? 'true' : 'false', onclick: () => { v.sizeKey = s.key; renderSheetOnly(); } },
              h('span', { class: 'size-label' }, s.label),
              h('span', { class: 'size-rate' }, rupees(s.rate)),
            ),
      ),
    ),
    h('div', { class: 'fields' }, field('qty', 'Quantity', v.qty), field('disc', 'Discount %', v.disc, '%')),
    h('div', { class: `hint${hadDiscount ? '' : ' hint-accent'}` }, hadDiscount ? `Discount is the same for every ${group} item in this bill.` : `Type the discount for ${group}. Every ${group} item in this bill will use it.`),
    keypad(v, v.active === 'disc'),
    h(
      'div',
      { class: 'price-row' },
      h('div', { class: 'price-work' }, amounts ? [h('div', { class: 'price-calc' }, `${qty} × ${rupees(size.rate)}`), h('div', { class: 'price-less' }, discBp === null ? 'discount not typed yet' : `less ${percentText(discBp)}%`)] : h('div', { class: 'price-less' }, size ? rupees(size.rate) + ' each' : 'Choose a size')),
      amount('div', 'price', amounts ? rupees(amounts.net) : '—'),
    ),
    h(
      'div',
      { class: 'sheet-actions' },
      v.editId !== null && h('button', { class: 'btn ghost danger', onclick: () => removeFromSheet(v) }, 'Remove'),
      h('button', { class: 'btn accent grow', disabled: need ? true : null, 'data-testid': 'add', onclick: () => commitItem(v, found, size, qty, discBp) }, need || (v.editId !== null ? 'Save' : 'Add to bill')),
    ),
  );
}

function commitItem(v, found, size, qty, discBp) {
  if (!size || qty < 1 || discBp === null) return;
  const entry = {
    brandId: v.brandId,
    brandName: found ? found.brand.name : v.line.brandName,
    typeId: v.typeId,
    typeName: found ? found.type.name : v.line.typeName,
    itemId: v.itemId,
    itemName: found ? found.item.name : v.line.itemName,
    sizeKey: size.key,
    sizeLabel: size.label,
    rate: size.rate,
  };
  setDiscount(S.bill, v.brandId, v.typeId, discBp);
  let line;
  if (v.editId !== null) {
    const index = S.bill.lines.findIndex((l) => l.id === v.editId);
    const clash = S.bill.lines.find((l) => l.id !== v.editId && l.brandId === entry.brandId && l.typeId === entry.typeId && l.itemId === entry.itemId && l.sizeKey === entry.sizeKey);
    if (clash) {
      // changed to a size that is already on the bill: join the two lines
      clash.qty = Math.min(MAX_QTY, clash.qty + qty);
      clash.rate = entry.rate;
      if (index >= 0) S.bill.lines.splice(index, 1);
      line = clash;
    } else if (index >= 0) {
      line = Object.assign(S.bill.lines[index], entry, { qty });
    } else line = addLine(S.bill, entry, qty);
  } else {
    const before = S.bill.lines.find((l) => l.brandId === entry.brandId && l.typeId === entry.typeId && l.itemId === entry.itemId && l.sizeKey === entry.sizeKey);
    if (before && before.qty + qty > MAX_QTY) {
      toast(`That is more than ${MAX_QTY} of one item.`);
      return;
    }
    line = addLine(S.bill, entry, qty);
  }
  saveBill();
  const text = v.editId !== null ? `Saved: ${lineName(line)} × ${line.qty}` : line.qty !== qty ? `${lineName(line)}: now ${line.qty} in the bill` : `Added: ${lineName(line)} × ${qty}`;
  pop(1, () => toast(text));
}

function removeFromSheet(v) {
  const removed = removeLine(S.bill, v.editId);
  saveBill();
  pop(1, () => {
    if (!removed) return;
    toast(`Removed: ${lineName(removed.line)}`, {
      label: 'Undo',
      run: () => {
        restoreLine(S.bill, removed);
        saveBill();
        render();
      },
    });
  });
}

// ---------- discount sheet (from the bill) ----------

function discountSheet(v) {
  const brand = S.catalog.brands.find((b) => b.id === v.brandId);
  const accent = colorOfBrand(v.brandId);
  const bp = v.disc === '' ? null : parsePercent(v.disc.replace(/\.$/, ''));
  const group = `${v.brandName} ${v.typeName}`;
  return h(
    'div',
    { class: 'sheet', style: accentStyle(accent), role: 'dialog', 'aria-label': 'Discount' },
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, h('div', { class: 'sheet-name' }, 'Discount'), h('div', { class: 'sheet-sub' }, h('span', { class: 'tag' }, brand ? brand.name : v.brandName), h('span', null, v.typeName))), h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => pop() }, icon('close', 22, 2.6))),
    h('div', { class: 'big-field' }, h('span', { class: `field-value${v.fresh ? ' fresh' : ''}` }, v.disc === '' ? h('span', { class: 'caret' }) : [v.disc, !v.fresh && h('span', { class: 'caret' })]), h('span', { class: 'big-suffix' }, '%')),
    keypad(v, true),
    h('div', { class: 'note' }, `This changes every ${group} item in this bill.`),
    h('button', { class: 'btn accent', disabled: bp === null ? true : null, onclick: () => { setDiscount(S.bill, v.brandId, v.typeId, bp); saveBill(); pop(1, () => toast(`${group} discount is now ${percentText(bp)}%`)); } }, bp === null ? 'Type the discount' : 'Save discount'),
  );
}

// ---------- bill ----------

function billScreen() {
  const t = totals();
  const empty = t.lineCount === 0;
  return h(
    'div',
    { class: 'screen bill' },
    h(
      'header',
      { class: 'bar' },
      h('button', { class: 'bar-back', 'aria-label': 'Back', onclick: () => pop() }, icon('back', 26)),
      h('div', { class: 'bar-title' }, 'Bill'),
      h('div', { class: 'bar-side' }, empty ? dateText(Date.now()) : h('button', { class: 'pill-btn', onclick: () => push({ name: 'confirm', title: 'Clear this bill?', text: `All ${t.lineCount} ${t.lineCount === 1 ? 'item' : 'items'} will be removed.`, yes: 'Clear the bill', no: 'Keep the bill', run: clearBill }) }, 'Clear')),
    ),
    h(
      'main',
      { class: 'bill-body' },
      h('div', { class: 'customer' }, h('label', { for: 'cust' }, 'Customer name (optional)'), h('input', { id: 'cust', type: 'text', autocomplete: 'off', enterkeyhint: 'done', maxlength: '60', placeholder: 'Type name', value: S.bill.customer, oninput: (e) => { S.bill.customer = e.target.value; saveBill(); }, onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } })),
      empty && h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No items in this bill yet'), h('div', null, 'Go back and tap an item to add it.')),
      t.brands.map((b) => {
        const c = colorOfBrand(b.id);
        return h(
          'section',
          { class: 'brand-card', style: `--brand:${c};--brand-tint:${tintOf(c)}` },
          h('div', { class: 'brand-head' }, h('div', { class: 'brand-name' }, b.name), h('div', { class: 'brand-sub' }, rupees(b.subtotal))),
          h(
            'div',
            { class: 'disc-strip' },
            h('div', { class: 'disc-label' }, 'Discount, tap to change'),
            h(
              'div',
              { class: 'disc-chips' },
              b.groups.map((g) => h('button', { class: 'chip', onclick: () => push({ name: 'discount', brandId: b.id, brandName: b.name, typeId: g.typeId, typeName: g.name, disc: g.discountBp === null ? '' : percentText(g.discountBp), fresh: g.discountBp !== null }) }, `${g.name} ${g.discountBp === null ? '?' : percentText(g.discountBp)}%`)),
            ),
          ),
          b.lines.map((l) =>
            h(
              'button',
              { class: 'line', onclick: () => openItem(l.brandId, l.typeId, l.itemId, S.bill.lines.find((x) => x.id === l.id)) },
              h('span', { class: 'line-pic' }, picture(l.typeId, l.itemId, l.itemName, 'line-img')),
              h('span', { class: 'line-text' }, h('span', { class: 'line-name' }, l.name), h('span', { class: 'line-calc' }, `${l.qty} × ${rupees(l.rate)}`)),
              h('span', { class: 'line-amount' }, rupees(l.net)),
            ),
          ),
        );
      }),
      h('button', { class: 'btn outline', onclick: () => pop() }, icon('plus', 22), h('span', null, 'Add item')),
      !empty && h('div', { class: 'tip' }, 'Tap an item to change or remove it.'),
    ),
    h(
      'footer',
      { class: 'bill-foot' },
      h('div', { class: 'foot-row' }, h('div', { class: 'foot-label' }, empty ? 'Total' : `Total of ${t.lineCount} ${t.lineCount === 1 ? 'item' : 'items'}`), amount('div', 'foot-total', rupees(t.total))),
      h('button', { class: 'btn action', disabled: empty ? true : null, onclick: () => push({ name: 'gst' }) }, 'Finish bill'),
    ),
  );
}

function clearBill() {
  const customer = '';
  S.bill = newBill();
  S.bill.customer = customer;
  saveBill();
  pop(2, () => toast('The bill is cleared.'));
}

// ---------- GST question and finishing ----------

function gstSheet() {
  const t = totals();
  const option = (title, sub, amount, withGst) => h('button', { class: 'choice', onclick: () => finishBill(withGst) }, h('span', { class: 'choice-text' }, h('span', { class: 'choice-title' }, title), h('span', { class: 'choice-sub' }, sub)), amountEl('span', 'choice-amount', rupeesWhole(amount)));
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'With GST or without GST?' },
    h('div', { class: 'grab' }),
    h('div', { class: 'ask' }, h('div', { class: 'ask-title' }, 'With GST or without GST?'), h('div', { class: 'ask-sub' }, `Total of ${t.lineCount} ${t.lineCount === 1 ? 'item' : 'items'} is ${rupees(t.total)}`)),
    option('With GST', `Adds ${percentText(t.gstBp)}% GST, ${rupees(t.withGst.gst)}`, t.withGst.grand, true),
    option('Without GST', 'No GST added', t.withoutGst.grand, false),
    h('div', { class: 'tip' }, 'The final amount is rounded to the nearest rupee.'),
    h('button', { class: 'btn soft', onclick: () => pop() }, 'Back to bill'),
  );
}

function snapshot(bill, withGst) {
  const t = computeTotals(bill, S.settings.gstBp);
  const now = Date.now();
  return {
    v: 1,
    id: bill.id,
    createdAt: bill.createdAt,
    finishedAt: now,
    customer: bill.customer.trim(),
    shop: { name: S.settings.shopName, phones: S.settings.phones.slice() },
    brands: t.brands.map((b) => {
      const c = colorOfBrand(b.id);
      return { id: b.id, name: b.name, color: c, tint: tintOf(c), subtotal: b.subtotal, lines: b.lines.map((l) => ({ name: l.name, qty: l.qty, rate: l.rate, discountBp: l.discountBp, gross: l.gross, net: l.net })) };
    }),
    lineCount: t.lineCount,
    figures: finalFigures(t, withGst),
  };
}

function finishBill(withGst) {
  if (S.busy || S.bill.lines.length === 0) return;
  S.busy = true;
  const saved = snapshot(S.bill, withGst);
  const all = store.load('saved', []);
  all.unshift(saved);
  if (all.length > MAX_SAVED_BILLS) all.length = MAX_SAVED_BILLS;
  const kept = store.save('saved', all);
  S.bill = newBill();
  saveBill();
  // home > bill > gst  becomes  home > done
  S.stack = [S.stack[0], { name: 'done', saved, fresh: true }, { name: 'gone' }];
  if (useHistory) {
    afterPop = () => {
      S.busy = false;
      if (!kept) toast('This phone is out of space, so the bill could not be saved to Old bills. Share it now.');
    };
    history.go(-1);
  } else {
    S.stack.pop();
    S.busy = false;
    render();
  }
}

// ---------- finished bill (also used for old bills) ----------

function receiptCard(saved) {
  const f = saved.figures;
  return h(
    'div',
    { class: 'paper-wrap' },
    h(
      'div',
      { class: 'paper' },
      h('div', { class: 'paper-head' }, h('div', { class: 'paper-shop' }, saved.shop.name), h('div', { class: 'paper-small' }, saved.shop.phones.join(', ')), h('div', { class: 'paper-small' }, `Estimate, ${dateText(saved.finishedAt)}`), saved.customer && h('div', { class: 'paper-cust' }, saved.customer)),
      h('div', { class: 'dash' }),
      saved.brands.map((b) => h('div', { class: 'paper-brand' }, h('div', { class: 'paper-brand-name', style: `color:${b.color}` }, b.name), b.lines.map((l) => h('div', { class: 'paper-line' }, h('span', null, `${l.name} × ${l.qty}`), h('span', { class: 'num' }, amountText(l.net)))))),
      h('div', { class: 'dash' }),
      h('div', { class: 'paper-line' }, h('span', null, 'Total'), h('span', { class: 'num' }, amountText(f.total))),
      f.withGst && h('div', { class: 'paper-line' }, h('span', null, `GST ${percentText(f.gstBp)}%`), h('span', { class: 'num' }, amountText(f.gst))),
      h('div', { class: 'paper-line' }, h('span', null, 'Round off'), h('span', { class: 'num' }, `${f.roundOff < 0 ? '−' : '+'} ${amountText(Math.abs(f.roundOff))}`)),
      !f.withGst && h('div', { class: 'paper-small' }, 'GST is not included.'),
      h('div', { class: 'paper-grand' }, h('span', null, 'Grand total'), amount('span', 'paper-grand-num', rupeesWhole(f.grand))),
    ),
    h('div', { class: 'paper-edge' }),
  );
}

// The single-file preview runs inside a locked frame where phones cannot share or download.
const PREVIEW = !!globalThis.__MB_ASSETS;

function pictureSheet(v) {
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'Estimate' },
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, h('div', { class: 'sheet-name' }, 'The customer gets this')), h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => pop() }, icon('close', 22, 2.6))),
    h('div', { class: 'note' }, `Sharing is switched off in this preview. In the installed app this button opens WhatsApp and other apps with the ${v.kind === 'pdf' ? 'PDF' : 'picture'} attached.`),
    h('div', { class: 'pic-view' }, h('img', { src: v.url, alt: 'The estimate' })),
    h('button', { class: 'btn soft', onclick: () => pop() }, 'Close'),
  );
}

async function share(saved, kind) {
  if (S.busy) return;
  S.busy = true;
  toast(kind === 'pdf' ? 'Making the PDF…' : 'Making the picture…');
  try {
    if (PREVIEW) {
      if (kind === 'pdf') await receiptPdf(saved); // made as well, so the preview exercises the same code
      const png = await receiptPng(saved);
      push({ name: 'picture', url: URL.createObjectURL(png), kind });
      return;
    }
    const blob = kind === 'pdf' ? await receiptPdf(saved) : await receiptPng(saved);
    const result = await shareFile(blob, fileName(saved, kind === 'pdf' ? 'pdf' : 'png'), `Estimate from ${saved.shop.name}`);
    if (result === 'saved') toast(kind === 'pdf' ? 'The PDF is saved in Downloads.' : 'The picture is saved in Downloads.');
    else {
      S.toast = null;
      renderToast();
    }
  } catch {
    toast('Could not make the file. Please try again.');
  } finally {
    S.busy = false;
  }
}

function doneScreen(v) {
  const saved = v.saved;
  return h(
    'div',
    { class: 'screen done' },
    h(
      'header',
      { class: 'done-head' },
      v.fresh ? h('div', { class: 'done-tick' }, icon('check', 24, 3.4)) : h('button', { class: 'bar-back', 'aria-label': 'Back', onclick: () => pop() }, icon('back', 26)),
      h('div', { class: 'done-text' }, h('div', { class: 'done-title' }, v.fresh ? `Bill saved, ${rupeesWhole(saved.figures.grand)}` : saved.customer || 'Old bill'), h('div', { class: 'done-sub' }, v.fresh ? 'You can find it later in Old bills' : `${dateText(saved.finishedAt)}, ${timeText(saved.finishedAt)} · ${rupeesWhole(saved.figures.grand)}`)),
    ),
    h('main', { class: 'done-body' }, receiptCard(saved)),
    h(
      'footer',
      { class: 'done-foot' },
      h('div', { class: 'two' }, h('button', { class: 'btn white', onclick: () => share(saved, 'png') }, 'Share picture'), h('button', { class: 'btn white', onclick: () => share(saved, 'pdf') }, 'Share PDF')),
      v.fresh
        ? h('button', { class: 'btn line-btn', onclick: () => pop() }, 'Start a new bill')
        : h('button', { class: 'btn line-btn', onclick: () => push({ name: 'confirm', title: 'Delete this old bill?', text: 'It will be removed from this phone.', yes: 'Delete the bill', no: 'Keep it', run: () => deleteSaved(saved.id) }) }, 'Delete this bill'),
    ),
  );
}

function deleteSaved(id) {
  store.save('saved', store.load('saved', []).filter((b) => b.id !== id));
  pop(2, () => toast('The old bill is deleted.'));
}

// ---------- old bills ----------

function oldScreen() {
  const all = store.load('saved', []);
  return h(
    'div',
    { class: 'screen old' },
    h('header', { class: 'bar' }, h('button', { class: 'bar-back', 'aria-label': 'Back', onclick: () => pop() }, icon('back', 26)), h('div', { class: 'bar-title' }, 'Old bills'), h('div', { class: 'bar-side' }, all.length ? `${all.length} saved` : '')),
    h(
      'main',
      { class: 'old-body' },
      all.length === 0 && h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No old bills yet'), h('div', null, 'A bill is saved here when you finish it.')),
      all.map((b) =>
        h(
          'button',
          { class: 'old-row', onclick: () => push({ name: 'done', saved: b, fresh: false }) },
          h('span', { class: 'old-text' }, h('span', { class: 'old-name' }, b.customer || 'No name'), h('span', { class: 'old-sub' }, `${dateText(b.finishedAt)}, ${timeText(b.finishedAt)} · ${b.lineCount} ${b.lineCount === 1 ? 'item' : 'items'}${b.figures.withGst ? ' · with GST' : ''}`)),
          h('span', { class: 'old-amount' }, rupeesWhole(b.figures.grand)),
        ),
      ),
    ),
  );
}

// ---------- rates status and confirm ----------

function ratesSheet() {
  const err = store.load('ratesError');
  const connected = !!ratesUrl();
  const r = S.rates;
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': 'Rates' },
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, h('div', { class: 'sheet-name' }, 'Rates')), h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => pop() }, icon('close', 22, 2.6))),
    h(
      'div',
      { class: 'facts' },
      h('div', { class: 'fact' }, h('span', null, 'Rates updated'), h('strong', null, S.settings.ratesDate || 'Not known')),
      h('div', { class: 'fact' }, h('span', null, 'Rates come from'), h('strong', null, r.source === 'sheet' ? 'The shared rate sheet' : 'Inside the app')),
      connected && h('div', { class: 'fact' }, h('span', null, 'Last checked'), h('strong', null, r.checkedAt ? `${dateText(r.checkedAt)}, ${timeText(r.checkedAt)}` : 'Not yet')),
    ),
    !connected && h('div', { class: 'note' }, 'The shared rate sheet is not connected yet, so this phone uses the rates that came with the app.'),
    err && h('div', { class: 'error-box' }, h('div', { class: 'error-title' }, 'The new rate sheet has mistakes, so the old rates are still in use.'), h('ul', null, err.errors.slice(0, 8).map((e) => h('li', null, e))), err.errors.length > 8 && h('div', null, `…and ${err.errors.length - 8} more.`)),
    connected && h('button', { class: 'btn action', onclick: () => checkRates(true) }, 'Check for new rates'),
    h('div', { class: 'tip' }, `App version ${CONFIG.appVersion}`),
  );
}

function confirmSheet(v) {
  return h('div', { class: 'sheet', role: 'alertdialog', 'aria-label': v.title }, h('div', { class: 'grab' }), h('div', { class: 'ask' }, h('div', { class: 'ask-title' }, v.title), h('div', { class: 'ask-sub' }, v.text)), h('button', { class: 'btn danger-fill', onclick: v.run }, v.yes), h('button', { class: 'btn soft', onclick: () => pop() }, v.no));
}

// ---------- drawing the current view ----------

const SHEETS = { item: itemSheet, discount: discountSheet, gst: gstSheet, rates: ratesSheet, confirm: confirmSheet, picture: pictureSheet };
const SCREENS = { home: homeScreen, bill: billScreen, done: doneScreen, old: oldScreen };
let shownScreen = null;

function currentScreenView() {
  for (let i = S.stack.length - 1; i >= 0; i--) if (SCREENS[S.stack[i].name]) return S.stack[i];
  return S.stack[0];
}

function renderSheetOnly() {
  const root = document.getElementById('overlay');
  const view = top();
  const make = SHEETS[view.name];
  if (!make) {
    root.replaceChildren();
    root.className = '';
    document.body.classList.remove('sheet-open');
    return;
  }
  const old = root.querySelector('.sheet');
  const scroll = old ? old.scrollTop : 0;
  const sheet = make(view);
  root.replaceChildren(h('div', { class: 'scrim', onclick: () => pop() }), sheet);
  root.className = 'open';
  document.body.classList.add('sheet-open');
  sheet.scrollTop = scroll;
}

function render() {
  const view = currentScreenView();
  const root = document.getElementById('screen');
  const keep = shownScreen === view ? { y: window.scrollY, focus: document.activeElement && document.activeElement.id } : null;
  root.replaceChildren(SCREENS[view.name](view));
  document.body.dataset.screen = view.name;
  shownScreen = view;
  if (keep) {
    window.scrollTo(0, keep.y);
    if (keep.focus === 'cust') {
      const el = document.getElementById('cust');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  } else window.scrollTo(0, 0);
  renderSheetOnly();
  renderToast();
}

// ---------- start ----------

export function start() {
  const ui = store.load('ui');
  if (ui) {
    S.brandId = ui.brandId;
    S.typeId = ui.typeId;
  }
  loadRatesAtStart();
  const bill = store.load('bill');
  S.bill = bill && bill.v === 1 && Array.isArray(bill.lines) ? bill : newBill();

  try {
    history.replaceState({ n: 1 }, '');
  } catch {
    useHistory = false;
  }
  window.addEventListener('popstate', onPopState);
  window.addEventListener('online', () => checkRates(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!S.rates.checkedAt || Date.now() - S.rates.checkedAt > RATES_RECHECK_MS)) checkRates(false);
  });
  render();
  loadRemoteSettings().then(() => checkRates(false));
  try {
    // not available inside a preview frame or when opened as a plain file: the app still works, just not offline
    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator && !globalThis.__MB_ASSETS) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch {
    /* no offline copy in this kind of window */
  }
}

// Used by the automated tests to read what the screens are showing.
globalThis.__MB = { S, totals, store };
