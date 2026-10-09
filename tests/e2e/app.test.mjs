// End-to-end tests: the built app is opened in a real (headless) Chrome at phone sizes
// and used the way the shop will use it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../../tools/serve.mjs';
import { lineAmounts, gstAmount, roundToRupee, rupees, rupeesWhole } from '../../src/js/money.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.MB_OUT || path.join(root, 'test-output');
fs.mkdirSync(OUT, { recursive: true });
const BUNDLED = fs.readFileSync(path.join(root, 'src/data/rates.csv'), 'utf8');

let browser;
let app; // the app's own server
let sheet; // a second server on another address that plays the part of the Google Sheet
const remote = { ratesUrl: '', csv: BUNDLED, hits: 0, fail: false };

before(async () => {
  browser = await chromium.launch();
  app = await serve(path.join(root, 'dist'), 0, {
    '/settings.json': (req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ratesUrl: remote.ratesUrl })),
  });
  const server = http.createServer((req, res) => {
    remote.hits++;
    if (remote.fail) return res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }).end('down');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Access-Control-Allow-Origin': '*' }).end(remote.csv);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  sheet = { server, url: `http://127.0.0.1:${server.address().port}/rates.csv` };
});
after(async () => {
  await browser.close();
  app.server.close();
  sheet.server.close();
});

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function open({ width = 390, height = 844, init, offlineReady = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: offlineReady ? 'allow' : 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  if (init) await page.addInitScript(init);
  await page.goto(app.url);
  await page.waitForSelector('.tile');
  return { ctx, page, errors };
}

const brandBtn = (page, name) => page.locator('.brand-btn', { hasText: new RegExp(`^${esc(name)}$`) });
const typeBtn = (page, name) => page.locator('.type-btn', { hasText: new RegExp(`^${esc(name)}$`) });
const tile = (page, name) => page.locator('.tile').filter({ has: page.locator('.tile-name', { hasText: new RegExp(`^${esc(name)}$`) }) });
const sizeBtn = (page, label) => page.locator(`.size[data-size="${label.replace(/"/g, '\\"')}"]`);
const key = (page, ch) => page.locator('.keypad .key').nth('123456789.0<'.indexOf(ch));
async function keys(page, s) {
  for (const ch of String(s)) await key(page, ch).click();
}
const sheetClosed = (page) => page.waitForSelector('#overlay:not(.open)', { state: 'attached' });
const text = async (loc) => (await loc.first().textContent()).trim();

async function addItem(page, { brand, type, item, size, qty, disc }) {
  if (brand) await brandBtn(page, brand).click();
  if (type) await typeBtn(page, type).click();
  await tile(page, item).click();
  await sizeBtn(page, size).click();
  await keys(page, qty);
  if (disc !== undefined) {
    await page.locator('.field[data-field=disc]').click();
    await keys(page, disc);
  }
  await page.locator('[data-testid=add]').click();
  await sheetClosed(page);
}

const SAMPLE = [
  { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 20, disc: '42.5', rate: 2130, bp: 4250, name: 'Elbow ¾"' },
  { brand: 'Supreme', type: 'Plain', item: 'Tee', size: '1"', qty: 10, rate: 5480, bp: 4250, name: 'Tee 1"' },
  { brand: 'Supreme', type: 'Brass', item: 'Tee', size: '¾"', qty: 6, disc: '25', rate: 13780, bp: 2500, name: 'Tee (Brass) ¾"' },
  { brand: 'Ashirvad', type: 'Pipe', item: 'Pipe SDR 11', size: '1"', qty: 5, disc: '30', rate: 80800, bp: 3000, name: 'Pipe SDR 11 1"' },
  { brand: 'Ashirvad', type: 'Plain', item: 'Socket', size: '1" × ¾"', qty: 6, disc: '35', rate: 6300, bp: 3500, name: 'Socket 1" × ¾"' },
  { brand: 'Ashirvad', type: 'Brass', item: 'FTA', size: '¾"', qty: 2, disc: '20', rate: 37100, bp: 2000, name: 'FTA (Brass) ¾"' },
];
async function buildSample(page) {
  let running = 0;
  for (const s of SAMPLE) {
    await addItem(page, s);
    running += lineAmounts(s.rate, s.qty, s.bp).net;
    assert.equal(await text(page.locator('.billbar-total')), rupees(running), `bill bar after ${s.name}`);
  }
  return running;
}

test('the sample bill, with GST, end to end', async () => {
  const { ctx, page, errors } = await open();
  const total = await buildSample(page);
  assert.equal(total, 484745);
  assert.equal(await text(page.locator('.billbar-count')), '6');

  await page.getByRole('button', { name: 'View bill' }).click();
  const cards = page.locator('.brand-card');
  assert.equal(await cards.count(), 2);
  assert.equal(await text(cards.nth(0).locator('.brand-name')), 'Supreme');
  assert.equal(await text(cards.nth(0).locator('.brand-sub')), '₹1,180.15');
  assert.equal(await text(cards.nth(1).locator('.brand-name')), 'Ashirvad');
  assert.equal(await text(cards.nth(1).locator('.brand-sub')), '₹3,667.30');
  assert.deepEqual(await page.locator('.line-name').allTextContents(), SAMPLE.map((s) => s.name));
  assert.deepEqual(await page.locator('.line-amount').allTextContents(), ['₹244.95', '₹315.10', '₹620.10', '₹2,828.00', '₹245.70', '₹593.60']);
  assert.deepEqual(await page.locator('.chip').allTextContents(), ['Plain 42.5%', 'Brass 25%', 'Pipe 30%', 'Plain 35%', 'Brass 20%']);
  assert.equal(await text(page.locator('.foot-total')), '₹4,847.45');

  await page.fill('#cust', 'Ramesh Kumar');
  await page.getByRole('button', { name: 'Finish bill' }).click();
  const choices = page.locator('.choice');
  assert.equal(await text(choices.nth(0).locator('.choice-amount')), '₹5,720');
  assert.match(await text(choices.nth(0).locator('.choice-sub')), /Adds 18% GST, ₹872\.54/);
  assert.equal(await text(choices.nth(1).locator('.choice-amount')), '₹4,847');
  await choices.nth(0).click();
  await page.waitForSelector('.paper');

  const paper = await page.locator('.paper').innerText();
  for (const want of ['Mangal Hardware and Sanitary', '9872545358, 9876299358', 'Ramesh Kumar', 'Elbow ¾" × 20', '244.95', 'Pipe SDR 11 1" × 5', '2,828.00', 'Total', '4,847.45', 'GST 18%', '872.54', 'Round off', '+ 0.01', 'Grand total', '₹5,720']) assert.ok(paper.includes(want), `receipt shows ${want}`);
  await page.screenshot({ path: path.join(OUT, 'done.png') });

  await page.getByRole('button', { name: 'Start a new bill' }).click();
  await page.waitForSelector('.tile');
  assert.equal(await text(page.locator('.billbar-total')), '₹0.00');
  assert.equal(await text(page.locator('.billbar-count')), '0');

  await page.getByRole('button', { name: 'Old bills' }).click();
  assert.equal(await page.locator('.old-row').count(), 1);
  assert.equal(await text(page.locator('.old-name')), 'Ramesh Kumar');
  assert.equal(await text(page.locator('.old-amount')), '₹5,720');
  // still there after the app is closed and opened again
  await page.reload();
  await page.waitForSelector('.tile');
  await page.getByRole('button', { name: 'Old bills' }).click();
  await page.locator('.old-row').click();
  assert.ok((await page.locator('.paper').innerText()).includes('₹5,720'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the same bill without GST', async () => {
  const { ctx, page, errors } = await open();
  await buildSample(page);
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.getByRole('button', { name: 'Finish bill' }).click();
  await page.locator('.choice').nth(1).click();
  await page.waitForSelector('.paper');
  const paper = await page.locator('.paper').innerText();
  assert.ok(paper.includes('4,847.45'));
  assert.ok(paper.includes('− 0.45'));
  assert.ok(paper.includes('₹4,847'));
  assert.ok(paper.includes('GST is not included.'));
  assert.ok(!paper.includes('GST 18%'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('discount: asked once per brand and group, starts empty, decimals, changing it changes the group', async () => {
  const { ctx, page, errors } = await open();
  await brandBtn(page, 'Supreme').click();
  await tile(page, 'Elbow').click();
  const add = page.locator('[data-testid=add]');
  assert.equal(await text(add), 'Choose a size');
  assert.equal(await add.isDisabled(), true);
  await sizeBtn(page, '1"').click();
  assert.equal(await text(add), 'Type the quantity');
  assert.equal(await key(page, '.').isDisabled(), true, 'no decimal point for quantity');
  await keys(page, '0');
  assert.equal(await text(page.locator('.field[data-field=qty] .field-value')), '', 'quantity cannot start with 0');
  await keys(page, '12');
  assert.equal(await text(add), 'Type the discount');
  assert.equal(await add.isDisabled(), true);
  assert.equal(await text(page.locator('.price')), '₹507.60'); // 12 x 42.30 before discount
  await page.locator('.field[data-field=disc]').click();
  await keys(page, '101');
  assert.equal(await text(page.locator('.field[data-field=disc] .field-value')), '10%', 'more than 100 is refused');
  await keys(page, '<<42.557');
  assert.equal(await text(page.locator('.field[data-field=disc] .field-value')), '42.55%', 'two decimals at most');
  assert.equal(await text(page.locator('.price')), rupees(lineAmounts(4230, 12, 4255).net));
  await add.click();
  await sheetClosed(page);

  // second item of the same group: the discount is already filled in
  await tile(page, 'Tee').click();
  assert.equal(await text(page.locator('.field[data-field=disc] .field-value')), '42.55%');
  await sizeBtn(page, '¾"').click();
  await keys(page, '3');
  assert.equal(await text(add), 'Add to bill');
  await add.click();
  await sheetClosed(page);

  // another brand has its own, still empty
  await brandBtn(page, 'Ashirvad').click();
  await tile(page, 'Elbow').click();
  assert.equal(await text(page.locator('.field[data-field=disc] .field-value')), '—');
  await sizeBtn(page, '¾"').click();
  await keys(page, '10');
  await page.locator('.field[data-field=disc]').click();
  await keys(page, '0');
  assert.equal(await text(add), 'Add to bill', '0% is allowed');
  await add.click();
  await sheetClosed(page);

  const expectTotal = (bp) => lineAmounts(4230, 12, bp).net + lineAmounts(3490, 3, bp).net + lineAmounts(3200, 10, 0).net;
  assert.equal(await text(page.locator('.billbar-total')), rupees(expectTotal(4255)));

  // change the Supreme Plain discount on the bill: both Supreme lines change, Ashirvad does not
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.locator('.chip', { hasText: 'Plain 42.55%' }).click();
  await keys(page, '40');
  await page.getByRole('button', { name: 'Save discount' }).click();
  await sheetClosed(page);
  assert.deepEqual(await page.locator('.line-amount').allTextContents(), [rupees(lineAmounts(4230, 12, 4000).net), rupees(lineAmounts(3490, 3, 4000).net), '₹320.00']);
  assert.equal(await text(page.locator('.foot-total')), rupees(expectTotal(4000)));

  // a new bill starts with no discounts
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Clear the bill' }).click();
  await page.waitForSelector('.tile');
  await brandBtn(page, 'Supreme').click();
  await tile(page, 'Elbow').click();
  assert.equal(await text(page.locator('.field[data-field=disc] .field-value')), '—');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('same item twice adds up; edit, change size, remove, undo', async () => {
  const { ctx, page, errors } = await open();
  await addItem(page, { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 5, disc: '10' });
  await addItem(page, { item: 'Elbow', size: '¾"', qty: 7 });
  await addItem(page, { item: 'Elbow', size: '1"', qty: 2 });
  assert.equal(await text(page.locator('.billbar-count')), '2');
  await page.getByRole('button', { name: 'View bill' }).click();
  assert.deepEqual(await page.locator('.line-calc').allTextContents(), ['12 × ₹21.30', '2 × ₹42.30']);

  // edit the quantity: typing replaces the old number
  await page.locator('.line').nth(0).click();
  await keys(page, '30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await sheetClosed(page);
  assert.deepEqual(await page.locator('.line-calc').allTextContents(), ['30 × ₹21.30', '2 × ₹42.30']);

  // change the 1" line to ¾": it joins the ¾" line
  await page.locator('.line').nth(1).click();
  await sizeBtn(page, '¾"').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await sheetClosed(page);
  assert.deepEqual(await page.locator('.line-calc').allTextContents(), ['32 × ₹21.30']);

  // remove, then undo
  await page.locator('.line').nth(0).click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await sheetClosed(page);
  assert.equal(await page.locator('.line').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Finish bill' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.deepEqual(await page.locator('.line-calc').allTextContents(), ['32 × ₹21.30']);
  assert.equal(await text(page.locator('.foot-total')), rupees(lineAmounts(2130, 32, 1000).net));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a half-made bill survives closing the app; the phone back button closes sheets', async () => {
  const { ctx, page, errors } = await open();
  await addItem(page, { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 20, disc: '42.5' });
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.fill('#cust', 'Sunita');
  await page.reload();
  await page.waitForSelector('.tile');
  assert.equal(await text(page.locator('.billbar-total')), '₹244.95');
  assert.equal(await text(page.locator('.brand-btn.on')), 'Supreme', 'remembers the last brand');
  await page.getByRole('button', { name: 'View bill' }).click();
  assert.equal(await page.inputValue('#cust'), 'Sunita');

  // back button: sheet -> bill -> home, never out of the app
  await page.locator('.chip').first().click();
  await page.waitForSelector('#overlay.open');
  await page.goBack();
  await sheetClosed(page);
  assert.equal(await page.locator('.bill').count(), 1);
  await page.goBack();
  await page.waitForSelector('.tile');
  assert.equal(await page.locator('.home').count(), 1);
  // tapping the dark area also closes a sheet
  await tile(page, 'Tee').click();
  await page.locator('.scrim').click({ position: { x: 20, y: 6 } });
  await sheetClosed(page);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('rates come from the shared sheet; a sheet with mistakes never replaces good rates', async () => {
  remote.ratesUrl = sheet.url;
  remote.csv = BUNDLED.replace('Supreme,Plain,Elbow,21.30', 'Supreme,Plain,Elbow,25').replace('#Rates updated,6 Oct 2026', '#Rates updated,9 Oct 2026') + 'Astral,Plain,Long Radius Bend,11,22,33\n';
  const { ctx, page, errors } = await open();
  await page.waitForFunction(() => document.querySelector('.rates-link').textContent.includes('9 Oct 2026'));
  assert.deepEqual(await page.locator('.brand-btn').allTextContents(), ['Ashirvad', 'Supreme', 'Astral']);
  await brandBtn(page, 'Astral').click();
  assert.equal(await text(page.locator('.tile .no-pic')), 'LRB', 'an item with no picture shows its initials');
  await brandBtn(page, 'Supreme').click();
  await tile(page, 'Elbow').click();
  assert.equal(await text(sizeBtn(page, '¾"').locator('.size-rate')), '₹25.00');
  await sizeBtn(page, '¾"').click();
  await keys(page, '4');
  await page.locator('.field[data-field=disc]').click();
  await keys(page, '0');
  await page.locator('[data-testid=add]').click();
  await sheetClosed(page);

  // the sheet now has a typing mistake: old rates stay, the mistake is listed
  remote.csv = remote.csv.replace('Supreme,Plain,Tee,34.90', 'Supreme,Plain,Tee,34.9o');
  await page.locator('.rates-link').click();
  await page.getByRole('button', { name: 'Check for new rates' }).click();
  await page.waitForSelector('.error-box');
  assert.match(await page.locator('.error-box').innerText(), /"34\.9o" is not a valid rate \(Tee, ¾"\)/);
  await page.goBack();
  await sheetClosed(page);
  await tile(page, 'Tee').click();
  assert.equal(await text(sizeBtn(page, '¾"').locator('.size-rate')), '₹34.90', 'old rate still in use');
  await page.goBack();
  await sheetClosed(page);

  // the sheet is corrected with a new elbow rate: it loads; the line already on the bill keeps its rate
  remote.csv = remote.csv.replace('34.9o', '36').replace('Supreme,Plain,Elbow,25', 'Supreme,Plain,Elbow,27');
  await page.locator('.rates-link').click();
  await page.getByRole('button', { name: 'Check for new rates' }).click();
  await page.waitForFunction(() => !document.querySelector('.error-box'));
  await page.goBack();
  await sheetClosed(page);
  await tile(page, 'Tee').click();
  assert.equal(await text(sizeBtn(page, '¾"').locator('.size-rate')), '₹36.00');
  await page.goBack();
  await sheetClosed(page);
  assert.equal(await text(page.locator('.billbar-total')), '₹100.00', 'the bill keeps the rate it was made with');

  // no internet for the sheet: the app keeps working with what it has
  remote.fail = true;
  await page.reload();
  await page.waitForSelector('.tile');
  await brandBtn(page, 'Supreme').click();
  await tile(page, 'Elbow').click();
  assert.equal(await text(sizeBtn(page, '¾"').locator('.size-rate')), '₹27.00');
  remote.fail = false;
  remote.ratesUrl = '';
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('works with no internet after the first visit', async () => {
  const { ctx, page, errors } = await open({ offlineReady: true });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.tile');
  await page.waitForFunction(() => [...document.querySelectorAll('.tile-img')].every((img) => img.tagName !== 'IMG' || (img.complete && img.naturalWidth > 0)), null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => document.fonts.check("800 20px 'Mukta'", '₹1')), true, 'the font is available offline');
  await addItem(page, { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 20, disc: '42.5' });
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.getByRole('button', { name: 'Finish bill' }).click();
  await page.locator('.choice').nth(0).click();
  await page.waitForSelector('.paper');
  assert.ok((await page.locator('.paper').innerText()).includes('₹289'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('share as picture and as PDF; a long bill stays exact and readable', async () => {
  const shareStub = () => {
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      const f = data.files[0];
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      window.__shared.push({ name: f.name, type: f.type, b64: btoa(bin) });
    };
  };
  const { ctx, page, errors } = await open({ init: shareStub });
  // every item and size of both brands: a long bill
  const catalog = await page.evaluate(() => window.__MB.S.catalog);
  let expected = 0;
  let lines = 0;
  for (const brand of catalog.brands) {
    await brandBtn(page, brand.name).click();
    for (const type of brand.types) {
      await typeBtn(page, type.name).click();
      let first = true;
      const bp = { pipe: 3000, plain: 4250, brass: 2255 }[type.id];
      for (const item of type.items) {
        for (const size of item.sizes.filter((x) => x.rate !== null)) {
          const qty = 1 + ((lines * 7) % 23);
          await tile(page, item.name).click();
          await sizeBtn(page, size.label).click();
          await keys(page, qty);
          if (first) {
            await page.locator('.field[data-field=disc]').click();
            await keys(page, String(bp / 100));
            first = false;
          }
          await page.locator('[data-testid=add]').click();
          await sheetClosed(page);
          expected += lineAmounts(size.rate, qty, bp).net;
          lines++;
        }
      }
    }
  }
  assert.ok(lines > 100, `long bill has ${lines} lines`);
  // sizes whose rate is not known yet are shown but cannot be chosen
  await brandBtn(page, 'Ashirvad').click();
  await typeBtn(page, 'Plain').click();
  await tile(page, 'Over Step Bend').click();
  assert.deepEqual(await page.locator('.size').evaluateAll((els) => els.map((e) => [e.querySelector('.size-label').textContent, e.querySelector('.size-rate').textContent, e.disabled])), [['¾"', 'No rate yet', true], ['1"', 'No rate yet', true], ['1¼"', '₹365.00', false]]);
  await page.goBack();
  await sheetClosed(page);
  await typeBtn(page, 'Brass').click();
  assert.equal(await tile(page, 'Tee').getAttribute('aria-disabled'), 'true', 'an item with no rates at all is greyed out');
  assert.equal(await text(page.locator('.billbar-total')), rupees(expected));
  assert.equal(await text(page.locator('.billbar-count')), String(lines));
  await page.getByRole('button', { name: 'View bill' }).click();
  assert.equal(await text(page.locator('.foot-total')), rupees(expected));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
  await page.fill('#cust', 'Long Bill Test');
  await page.getByRole('button', { name: 'Finish bill' }).click();
  const gst = gstAmount(expected, 1800);
  assert.equal(await text(page.locator('.choice').nth(0).locator('.choice-amount')), rupeesWhole(roundToRupee(expected + gst)));
  await page.locator('.choice').nth(0).click();
  await page.waitForSelector('.paper');

  await page.getByRole('button', { name: 'Share picture' }).click();
  await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Share PDF' }).click();
  await page.waitForFunction(() => window.__shared.length === 2, null, { timeout: 30000 });
  const shared = await page.evaluate(() => window.__shared);
  const png = Buffer.from(shared[0].b64, 'base64');
  const pdf = Buffer.from(shared[1].b64, 'base64');
  assert.match(shared[0].name, /^Estimate-\d{4}-\d{2}-\d{2}-Long-Bill-Test\.png$/);
  assert.equal(shared[0].type, 'image/png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1240, 'picture is 1240 px wide');
  assert.equal(shared[1].type, 'application/pdf');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pages = (pdf.toString('latin1').match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 4, `long PDF has ${pages} pages`);
  fs.writeFileSync(path.join(OUT, 'long-estimate.png'), png);
  fs.writeFileSync(path.join(OUT, 'long-estimate.pdf'), pdf);
  assert.deepEqual(errors, []);
  await ctx.close();

  // and the ordinary sample bill, kept for looking at
  const b = await open({ init: shareStub });
  await buildSample(b.page);
  await b.page.getByRole('button', { name: 'View bill' }).click();
  await b.page.fill('#cust', 'Ramesh Kumar');
  await b.page.getByRole('button', { name: 'Finish bill' }).click();
  await b.page.locator('.choice').nth(0).click();
  await b.page.waitForSelector('.paper');
  await b.page.getByRole('button', { name: 'Share picture' }).click();
  await b.page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 30000 });
  await b.page.getByRole('button', { name: 'Share PDF' }).click();
  await b.page.waitForFunction(() => window.__shared.length === 2, null, { timeout: 30000 });
  const s2 = await b.page.evaluate(() => window.__shared);
  fs.writeFileSync(path.join(OUT, 'estimate.png'), Buffer.from(s2[0].b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'estimate.pdf'), Buffer.from(s2[1].b64, 'base64'));
  assert.equal((Buffer.from(s2[1].b64, 'base64').toString('latin1').match(/\/Type \/Page /g) || []).length, 1);
  assert.deepEqual(b.errors, []);
  await b.ctx.close();
});

test('where the phone cannot share files, the file is downloaded instead', async () => {
  const { ctx, page, errors } = await open({ init: () => { navigator.canShare = undefined; navigator.share = undefined; } });
  await addItem(page, { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 20, disc: '42.5' });
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.getByRole('button', { name: 'Finish bill' }).click();
  await page.locator('.choice').nth(1).click();
  await page.waitForSelector('.paper');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Share PDF' }).click()]);
  assert.match(download.suggestedFilename(), /^Estimate-\d{4}-\d{2}-\d{2}\.pdf$/);
  await page.waitForSelector('.toast');
  assert.match(await text(page.locator('.toast')), /saved in Downloads/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('if the phone refuses to store anything, the app still makes bills', async () => {
  const { ctx, page, errors } = await open({ init: () => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; Storage.prototype.getItem = () => { throw new Error('SecurityError'); }; } });
  await addItem(page, { brand: 'Supreme', type: 'Plain', item: 'Elbow', size: '¾"', qty: 20, disc: '42.5' });
  assert.equal(await text(page.locator('.billbar-total')), '₹244.95');
  await page.getByRole('button', { name: 'View bill' }).click();
  await page.getByRole('button', { name: 'Finish bill' }).click();
  await page.locator('.choice').nth(0).click();
  await page.waitForSelector('.paper');
  assert.ok((await page.locator('.paper').innerText()).includes('₹289'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the same size in two makes: Ashirvad brass MTA ¾" × ½" Heavy and Light', async () => {
  const shareStub = () => {
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      const f = data.files[0];
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      window.__shared.push({ name: f.name, type: f.type, b64: btoa(bin) });
    };
  };
  const { ctx, page, errors } = await open({ init: shareStub });
  await typeBtn(page, 'Brass').click();
  await tile(page, 'MTA').click();
  // seven sizes; Heavy and Light are two separate buttons, each with its own rate
  assert.deepEqual(
    await page.locator('.size').evaluateAll((els) => els.map((e) => [e.dataset.size, e.querySelector('.size-label').textContent, e.querySelector('.size-kind')?.textContent ?? '', e.querySelector('.size-rate').textContent])),
    [['¾"', '¾"', '', '₹365.00'], ['1"', '1"', '', '₹685.00'], ['1¼"', '1¼"', '', '₹1,276.00'], ['1" × ¾"', '1" × ¾"', '', '₹413.00'], ['1" × ½"', '1" × ½"', '', '₹413.00'], ['¾" × ½" Heavy', '¾" × ½"', 'Heavy', '₹283.00'], ['¾" × ½" Light', '¾" × ½"', 'Light', '₹210.00']],
  );
  await sizeBtn(page, '¾" × ½" Heavy').click();
  assert.equal(await sizeBtn(page, '¾" × ½" Heavy').getAttribute('aria-pressed'), 'true');
  assert.equal(await sizeBtn(page, '¾" × ½" Light').getAttribute('aria-pressed'), 'false', 'choosing Heavy does not choose Light');
  await keys(page, '3');
  await page.locator('.field[data-field=disc]').click();
  await keys(page, '20');
  assert.equal(await text(page.locator('.price')), '₹679.20'); // 3 x 283 less 20%
  await page.locator('[data-testid=add]').click();
  await sheetClosed(page);
  await addItem(page, { item: 'MTA', size: '¾" × ½" Light', qty: 4 });
  assert.equal(await text(page.locator('.billbar-total')), '₹1,351.20'); // 679.20 + 4 x 210 less 20%
  await addItem(page, { item: 'MTA', size: '¾" × ½" Heavy', qty: 2 }); // joins the Heavy line, not the Light one
  await addItem(page, { item: 'MTA', size: '1" × ½"', qty: 1 });
  assert.equal(await text(page.locator('.billbar-count')), '3');
  assert.equal(await text(page.locator('.billbar-total')), '₹2,134.40');

  await page.getByRole('button', { name: 'View bill' }).click();
  assert.deepEqual(await page.locator('.line-name').allTextContents(), ['MTA (Brass) ¾" × ½" Heavy', 'MTA (Brass) ¾" × ½" Light', 'MTA (Brass) 1" × ½"']);
  assert.deepEqual(await page.locator('.line-amount').allTextContents(), ['₹1,132.00', '₹672.00', '₹330.40']);
  // edit the Light line: it opens on Light, and can be changed to a different quantity
  await page.locator('.line').nth(1).click();
  assert.equal(await sizeBtn(page, '¾" × ½" Light').getAttribute('aria-pressed'), 'true');
  assert.equal(await sizeBtn(page, '¾" × ½" Heavy').getAttribute('aria-pressed'), 'false');
  await keys(page, '10');
  await page.locator('[data-testid=add]').click();
  await sheetClosed(page);
  assert.deepEqual(await page.locator('.line-amount').allTextContents(), ['₹1,132.00', '₹1,680.00', '₹330.40']);
  assert.equal(await text(page.locator('.foot-total')), '₹3,142.40');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
  await page.screenshot({ path: path.join(OUT, 'mta-bill.png') });

  await page.getByRole('button', { name: 'Finish bill' }).click();
  await page.locator('.choice').nth(1).click();
  await page.waitForSelector('.paper');
  const paper = await page.locator('.paper').innerText();
  for (const want of ['MTA (Brass) ¾" × ½" Heavy × 5', '1,132.00', 'MTA (Brass) ¾" × ½" Light × 10', '1,680.00', 'MTA (Brass) 1" × ½" × 1', '330.40', '3,142.40', '₹3,142']) assert.ok(paper.includes(want), `receipt shows ${want}`);
  await page.getByRole('button', { name: 'Share picture' }).click();
  await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 30000 });
  fs.writeFileSync(path.join(OUT, 'mta-estimate.png'), Buffer.from((await page.evaluate(() => window.__shared))[0].b64, 'base64'));
  // saved bills keep the make
  await page.reload();
  await page.waitForSelector('.tile');
  await page.getByRole('button', { name: 'Old bills' }).click();
  await page.locator('.old-row').click();
  assert.ok((await page.locator('.paper').innerText()).includes('MTA (Brass) ¾" × ½" Heavy × 5'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

const SIZES = [
  { name: 'small old phone', width: 320, height: 568 },
  { name: 'common budget phone', width: 360, height: 640 },
  { name: 'tall budget phone', width: 360, height: 780 },
  { name: 'large phone', width: 412, height: 915 },
  { name: 'budget phone with large text', width: 360, height: 740, fontScale: 1.3 },
];
for (const size of SIZES) {
  test(`fits the screen: ${size.name} (${size.width}x${size.height})`, async () => {
    const { ctx, page, errors } = await open({ width: size.width, height: size.height, init: size.fontScale ? `document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '${size.fontScale * 100}%'; })` : undefined });
    const check = async (label) => {
      const problems = await page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
        for (const el of document.querySelectorAll('button, .price, .foot-total, .billbar-total, .line-amount, .brand-sub, .sheet-name, .field-value, .choice-amount, .paper-line, .paper-grand, .tile-name, .size-label, .size-kind, .size-rate, .old-amount')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < -1 || r.right > vw + 1) out.push(`off the side: ${el.className} "${el.textContent.trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
          if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push(`text cut: ${el.className} "${el.textContent.trim().slice(0, 24)}"`);
        }
        // children must stay inside their own button
        for (const b of document.querySelectorAll('button')) {
          const br = b.getBoundingClientRect();
          if (br.width === 0) continue;
          for (const c of b.querySelectorAll('span, div')) {
            const r = c.getBoundingClientRect();
            if (r.width && (r.left < br.left - 2 || r.right > br.right + 2) && !c.classList.contains('tile-plus')) out.push(`spills out of its button: "${c.textContent.trim().slice(0, 24)}" in ${b.className}`);
          }
        }
        return out;
      });
      assert.deepEqual(problems, [], `${label} at ${size.name}`);
      await page.screenshot({ path: path.join(OUT, `fit-${size.width}x${size.height}${size.fontScale ? '-large-text' : ''}-${label}.png`) });
    };
    await check('home');
    await brandBtn(page, 'Supreme').click();
    await typeBtn(page, 'Brass').click();
    await tile(page, 'Tee').click();
    await sizeBtn(page, '1¼"').click();
    await keys(page, '99999');
    await page.locator('.field[data-field=disc]').click();
    await keys(page, '12.25');
    await check('sheet');
    if (size.height >= 640 && !size.fontScale) {
      const fits = await page.evaluate(() => {
        const s = document.querySelector('.sheet');
        const b = document.querySelector('[data-testid=add]').getBoundingClientRect();
        return s.scrollHeight <= s.clientHeight + 1 && b.bottom <= window.innerHeight;
      });
      assert.equal(fits, true, 'the whole sheet, keypad and Add button are visible without scrolling');
    } else {
      await page.locator('[data-testid=add]').scrollIntoViewIfNeeded();
    }
    await page.locator('[data-testid=add]').click();
    await sheetClosed(page);
    // an item with more than six sizes, two of them the same size in two makes
    await brandBtn(page, 'Ashirvad').click();
    await typeBtn(page, 'Brass').click();
    await tile(page, 'MTA').click();
    assert.equal(await page.locator('.size').count(), 7);
    await sizeBtn(page, '¾" × ½" Heavy').click();
    await keys(page, '99999');
    await page.locator('.field[data-field=disc]').click();
    await keys(page, '12.25');
    await check('sheet-many-sizes');
    if (size.height >= 640 && !size.fontScale) {
      const fits = await page.evaluate(() => {
        const s = document.querySelector('.sheet');
        const b = document.querySelector('[data-testid=add]').getBoundingClientRect();
        return s.scrollHeight <= s.clientHeight + 1 && b.bottom <= window.innerHeight;
      });
      assert.equal(fits, true, 'a sheet with seven sizes still shows the keypad and Add button without scrolling');
    }
    await page.goBack();
    await sheetClosed(page);
    await addItem(page, { brand: 'Ashirvad', type: 'Pipe', item: 'Pipe SDR 11', size: '1¼"', qty: 99999, disc: '0.05' });
    await check('home-big-total');
    await page.getByRole('button', { name: 'View bill' }).click();
    await page.fill('#cust', 'Shri Venkateshwara Constructions and Builders Pvt Ltd');
    await check('bill');
    await page.locator('.chip').first().click();
    await check('discount');
    await page.goBack();
    await sheetClosed(page);
    await page.getByRole('button', { name: 'Finish bill' }).click();
    await check('gst');
    await page.locator('.choice').nth(0).click();
    await page.waitForSelector('.paper');
    await check('done');
    await page.getByRole('button', { name: 'Start a new bill' }).click();
    await page.waitForSelector('.tile');
    await page.getByRole('button', { name: 'Old bills' }).click();
    await check('old');
    await page.goBack();
    await page.locator('.rates-link').click();
    await check('rates');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('stays quick on a slow phone (processor slowed 6 times)', async () => {
  const { ctx, page, errors } = await open({ width: 360, height: 740 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await brandBtn(page, 'Supreme').click();
  // time from a tap until the screen has finished changing, measured inside the page
  const timed = (selector, index = 0) =>
    page.evaluate(
      ([sel, i]) =>
        new Promise((resolve) => {
          const el = document.querySelectorAll(sel)[i];
          const t0 = performance.now();
          el.click();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
        }),
      [selector, index],
    );
  const results = {};
  results.openItem = await timed('.tile', 1);
  results.pickSize = await timed('.size', 1);
  const pressKeys = [];
  for (const i of [0, 9, 10]) pressKeys.push(await timed('.keypad .key', i));
  results.keyPress = Math.max(...pressKeys);
  await page.locator('.field[data-field=disc]').click();
  await keys(page, '40');
  results.addToBill = await timed('[data-testid=add]');
  await sheetClosed(page);
  results.switchBrand = await timed('.brand-btn', 0);
  results.openBill = await timed('.billbar-btn');
  await page.waitForSelector('.bill');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  fs.writeFileSync(path.join(OUT, 'speed.json'), JSON.stringify(results, null, 2));
  console.log('slow-phone timings (ms):', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Math.round(v)]))));
  for (const [k, v] of Object.entries(results)) assert.ok(v < 250, `${k} took ${Math.round(v)} ms on a 6x slowed processor`);
  assert.deepEqual(errors, []);
  await ctx.close();
});
