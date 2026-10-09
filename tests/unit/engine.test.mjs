import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRupees, parsePercent, percentText, amountText, rupees, rupeesWhole, lineAmounts, gstAmount, roundToRupee } from '../../src/js/money.js';
import { normaliseSize } from '../../src/js/sizes.js';
import { parseCsv, parseCatalog, findItem } from '../../src/js/catalog.js';
import { newBill, addLine, removeLine, restoreLine, updateLine, setDiscount, discountFor, computeTotals, finalFigures, lineName } from '../../src/js/bill.js';

test('parseRupees reads plain amounts exactly', () => {
  assert.equal(parseRupees('219.33'), 21933);
  assert.equal(parseRupees('62'), 6200);
  assert.equal(parseRupees('16.9'), 1690);
  assert.equal(parseRupees('1,008'), 100800);
  assert.equal(parseRupees('1,23,456.70'), 12345670);
  assert.equal(parseRupees('₹ 62.50'), 6250);
  assert.equal(parseRupees('Rs. 62'), 6200);
  assert.equal(parseRupees(' 0.05 '), 5);
  assert.equal(parseRupees(1426), 142600);
});

test('parseRupees rejects anything doubtful', () => {
  for (const bad of ['', ' ', 'abc', '12o', '62.555', '-5', '1.2.3', '1,0', '12,34', '62/-', '1e3', '.', '6 2']) {
    assert.equal(parseRupees(bad), null, `"${bad}"`);
  }
  assert.equal(parseRupees('99999999999'), null);
  assert.equal(parseRupees(null), null);
});

test('parsePercent', () => {
  assert.equal(parsePercent('42.5'), 4250);
  assert.equal(parsePercent('40'), 4000);
  assert.equal(parsePercent('0'), 0);
  assert.equal(parsePercent('100'), 10000);
  assert.equal(parsePercent('42.55'), 4255);
  assert.equal(parsePercent('.5'), 50);
  assert.equal(parsePercent('18%'), 1800);
  assert.equal(parsePercent('7.'), 700);
  for (const bad of ['', '.', '100.01', '101', '42.555', 'abc', '-1']) assert.equal(parsePercent(bad), null, `"${bad}"`);
});

test('percentText round-trips', () => {
  for (const [bp, s] of [[4250, '42.5'], [4000, '40'], [4255, '42.55'], [0, '0'], [10000, '100'], [5, '0.05'], [50, '0.5']]) {
    assert.equal(percentText(bp), s);
    assert.equal(parsePercent(s), bp);
  }
});

test('amount formatting uses Indian grouping', () => {
  assert.equal(amountText(484745), '4,847.45');
  assert.equal(amountText(5), '0.05');
  assert.equal(amountText(100000), '1,000.00');
  assert.equal(amountText(12345678), '1,23,456.78');
  assert.equal(amountText(1234567890), '1,23,45,678.90');
  assert.equal(rupees(31510), '₹315.10');
  assert.equal(rupees(-45), '-₹0.45');
  assert.equal(rupeesWhole(572000), '₹5,720');
  assert.equal(rupeesWhole(12345600), '₹1,23,456');
});

test('line amounts: the sample bill', () => {
  assert.deepEqual(lineAmounts(2130, 20, 4250), { gross: 42600, net: 24495, discount: 18105 });
  assert.deepEqual(lineAmounts(5480, 10, 4250), { gross: 54800, net: 31510, discount: 23290 });
  assert.deepEqual(lineAmounts(13780, 6, 2500), { gross: 82680, net: 62010, discount: 20670 });
  assert.deepEqual(lineAmounts(80800, 5, 3000), { gross: 404000, net: 282800, discount: 121200 });
  assert.deepEqual(lineAmounts(6300, 6, 3500), { gross: 37800, net: 24570, discount: 13230 });
  assert.deepEqual(lineAmounts(37100, 2, 2000), { gross: 74200, net: 59360, discount: 14840 });
});

test('line amounts: half paise rounds up, edges', () => {
  // 219.33 x 7 = 1535.31; less 12.5% = 1343.39625 -> 1343.40
  assert.equal(lineAmounts(21933, 7, 1250).net, 134340);
  // 0.01 x 1 less 50% = 0.005 -> 0.01
  assert.equal(lineAmounts(1, 1, 5000).net, 1);
  // 0.01 x 1 less 51% = 0.0049 -> 0.00
  assert.equal(lineAmounts(1, 1, 5100).net, 0);
  assert.equal(lineAmounts(12345, 3, 0).net, 37035);
  assert.equal(lineAmounts(12345, 3, 10000).net, 0);
  // biggest allowed values stay exact
  assert.equal(lineAmounts(1_000_000_000, 99_999, 1).net, 99989000100000);
  assert.throws(() => lineAmounts(100, 1.5, 0));
  assert.throws(() => lineAmounts(100, -1, 0));
  assert.throws(() => lineAmounts(100, 1, 10001));
  assert.throws(() => lineAmounts(10.5, 1, 0));
});

test('gst and round-off', () => {
  assert.equal(gstAmount(484745, 1800), 87254); // 872.541 -> 872.54
  assert.equal(gstAmount(25, 1800), 5); // 0.045 -> 0.05 (half up)
  assert.equal(roundToRupee(571999), 572000);
  assert.equal(roundToRupee(484745), 484700);
  assert.equal(roundToRupee(484750), 484800);
  assert.equal(roundToRupee(49), 0);
  assert.equal(roundToRupee(50), 100);
});

test('sizes', () => {
  const cases = {
    '3/4': ['3/4', '¾"'], '1': ['1', '1"'], '1 1/4': ['1 1/4', '1¼"'], '1-1/4': ['1 1/4', '1¼"'], '1.25': ['1 1/4', '1¼"'],
    '11/4': ['1 1/4', '1¼"'], '1¼': ['1 1/4', '1¼"'], '¾"': ['3/4', '¾"'], '0.75': ['3/4', '¾"'], '.5': ['1/2', '½"'],
    '1x3/4': ['1x3/4', '1" × ¾"'], '1 1/4 x 3/4': ['1 1/4x3/4', '1¼" × ¾"'], '1¼"×1"': ['1 1/4x1', '1¼" × 1"'],
    '3/4 X 1/2': ['3/4x1/2', '¾" × ½"'], '1"x1/2"': ['1x1/2', '1" × ½"'], '2 inch': ['2', '2"'], '1 1/2': ['1 1/2', '1½"'],
    '3/8': ['3/8', '3/8"'], '1 3/8': ['1 3/8', '1 3/8"'], '11/4x1': ['1 1/4x1', '1¼" × 1"'],
  };
  for (const [raw, [key, label]] of Object.entries(cases)) assert.deepEqual(normaliseSize(raw), { key, label }, raw);
  assert.deepEqual(normaliseSize('20 mm'), { key: '20 mm', label: '20 mm' });
  assert.equal(normaliseSize('  '), null);
});

test('csv reader', () => {
  assert.deepEqual(parseCsv('a,b\r\n"c,1","d ""q"""\n\n e ,'), [['a', 'b'], ['c,1', 'd "q"'], [''], [' e ', '']]);
  assert.deepEqual(parseCsv('﻿x,y'), [['x', 'y']]);
  assert.deepEqual(parseCsv('3/4",1'), [['3/4"', '1']]);
});

const GOOD = `#Shop name,Test Shop
#Phone,111,222
#GST percent,18
#Rates updated,6 Oct 2026
Brand,Type,Item,3/4,1,1 1/4,1x3/4
Supreme,Plain,Elbow,21.30,42.30,88.60,56.80
,,Tee,34.90,54.80,113.20,73.60
Supreme,Plain,Union,,149,201
Supreme,Brass,Tee,137.80,272.70,501.80
Ashirvad,Pipe,Pipe SDR 11,522,808,"1,382"
`;

test('catalog: a good sheet', () => {
  const r = parseCatalog(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.rateCount, 16);
  assert.deepEqual(r.settings, { phones: ['111', '222'], shopName: 'Test Shop', gstBp: 1800, ratesDate: '6 Oct 2026' });
  assert.deepEqual(r.catalog.brands.map((b) => b.name), ['Supreme', 'Ashirvad']);
  const tee = findItem(r.catalog, 'supreme', 'plain', 'tee');
  assert.deepEqual(tee.item.sizes, [{ key: '3/4', label: '¾"', rate: 3490 }, { key: '1', label: '1"', rate: 5480 }, { key: '1 1/4', label: '1¼"', rate: 11320 }, { key: '1x3/4', label: '1" × ¾"', rate: 7360 }]);
  const union = findItem(r.catalog, 'supreme', 'plain', 'union');
  assert.deepEqual(union.item.sizes.map((s) => s.key), ['1', '1 1/4']);
  assert.equal(findItem(r.catalog, 'ashirvad', 'pipe', 'pipe-sdr-11').item.sizes[2].rate, 138200);
  assert.equal(findItem(r.catalog, 'supreme', 'plain', 'nothing'), null);
  const empty = parseCatalog('Brand,Type,Item,3/4,1\nSupreme,Brass,Tee,,\nSupreme,Brass,Elbow,5,\n');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.catalog.brands[0].types[0].items.map((i) => [i.name, i.sizes.length]), [['Tee', 0], ['Elbow', 1]], 'an item with no rates is kept, with no sizes');
  const pending = parseCatalog('Brand,Type,Item,3/4,1,1 1/4\nAshirvad,Plain,Over Step Bend,?,?,365\n');
  assert.equal(pending.ok, true);
  assert.equal(pending.rateCount, 1);
  assert.deepEqual(pending.catalog.brands[0].types[0].items[0].sizes, [{ key: '3/4', label: '¾"', rate: null }, { key: '1', label: '1"', rate: null }, { key: '1 1/4', label: '1¼"', rate: 36500 }], '? keeps the size, with no rate');
  assert.equal(parseCatalog('Brand,Type,Item,3/4\nA,Plain,Elbow,??\n').ok, false);
});

test('catalog: long layout works too', () => {
  const r = parseCatalog('Brand,Type,Item,Size,Rate\nSupreme,Plain,Elbow,3/4,21.30\nSupreme,Plain,Elbow,1,42.30\n');
  assert.equal(r.ok, true);
  assert.equal(r.rateCount, 2);
  const bad = parseCatalog('Brand,Type,Item,Size,Rate\nSupreme,Plain,Elbow,3/4,\n');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /Row 2: the rate is missing/);
});

test('catalog: every kind of mistake is reported with its place, and the sheet is rejected', () => {
  const cases = [
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,Elbow,21.3o,42\n', /Row 2, column D: "21.3o" is not a valid rate \(Elbow, ¾"\)/],
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,Elbow,0,42\n', /Row 2, column D: "0" is not a valid rate/],
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,Elbow,-5,42\n', /Row 2, column D/],
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,Elbow,21,42\nSupreme,Plain,Elbow,22,\n', /Row 3, column D: Supreme Plain Elbow ¾" is in the sheet twice/],
    ['Brand,Type,Item,3/4,1\nSupreme,,Elbow,21,42\n', /Row 2: Brand, Type and Item are all needed/],
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,,21,42\n', /Row 2: Brand, Type and Item are all needed/],
    ['Brand,Type,Item,3/4,1\nSupreme,Plain,Elbow,21,42,99\n', /Row 2, column F: "99" is under a column with no size/],
    ['Brand,Type,Item,3/4,3/4\nSupreme,Plain,Elbow,21,42\n', /size "3\/4" appears twice/],
    ['Supreme,Plain,Elbow,21,42\n', /heading row/],
    ['Brand,Item,Type,3/4\nSupreme,Plain,Elbow,21\n', /must start with "Brand, Type, Item"/],
    ['Brand,Type,Item,3/4,1\n', /no rates/],
    ['', /no heading row/],
    ['#GST percent,abc\nBrand,Type,Item,3/4\nS,Plain,Elbow,2\n', /GST percent "abc"/],
    ['Brand,Type,Item\nS,Plain,Elbow\n', /no sizes/],
  ];
  for (const [csv, re] of cases) {
    const r = parseCatalog(csv);
    assert.equal(r.ok, false, csv);
    assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(csv)} -> ${JSON.stringify(r.errors)}`);
  }
});

const entry = (o) => ({ brandId: 'supreme', brandName: 'Supreme', typeId: 'plain', typeName: 'Plain', itemId: 'elbow', itemName: 'Elbow', sizeKey: '3/4', sizeLabel: '¾"', rate: 2130, ...o });

test('bill: the sample bill end to end', () => {
  const bill = newBill(1);
  addLine(bill, entry({}), 20);
  addLine(bill, entry({ itemId: 'tee', itemName: 'Tee', sizeKey: '1', sizeLabel: '1"', rate: 5480 }), 10);
  addLine(bill, entry({ typeId: 'brass', typeName: 'Brass', itemId: 'tee', itemName: 'Tee', rate: 13780 }), 6);
  const A = { brandId: 'ashirvad', brandName: 'Ashirvad' };
  addLine(bill, entry({ ...A, typeId: 'pipe', typeName: 'Pipe', itemId: 'pipe-sdr-11', itemName: 'Pipe SDR 11', sizeKey: '1', sizeLabel: '1"', rate: 80800 }), 5);
  addLine(bill, entry({ ...A, itemId: 'socket', itemName: 'Socket', sizeKey: '1x3/4', sizeLabel: '1" × ¾"', rate: 6300 }), 6);
  addLine(bill, entry({ ...A, typeId: 'brass', typeName: 'Brass', itemId: 'fta', itemName: 'FTA', rate: 37100 }), 2);

  let t = computeTotals(bill, 1800);
  assert.equal(t.missing.length, 5); // nothing typed yet
  assert.equal(t.total, 42600 + 54800 + 82680 + 404000 + 37800 + 74200);

  setDiscount(bill, 'supreme', 'plain', 4250);
  setDiscount(bill, 'supreme', 'brass', 2500);
  setDiscount(bill, 'ashirvad', 'pipe', 3000);
  setDiscount(bill, 'ashirvad', 'plain', 3500);
  setDiscount(bill, 'ashirvad', 'brass', 2000);
  t = computeTotals(bill, 1800);
  assert.deepEqual(t.missing, []);
  assert.deepEqual(t.brands.map((b) => [b.name, b.subtotal]), [['Supreme', 118015], ['Ashirvad', 366730]]);
  assert.deepEqual(t.brands[0].lines.map((l) => [l.name, l.net]), [['Elbow ¾"', 24495], ['Tee 1"', 31510], ['Tee (Brass) ¾"', 62010]]);
  assert.deepEqual(t.brands[1].lines.map((l) => [l.name, l.net]), [['Pipe SDR 11 1"', 282800], ['Socket 1" × ¾"', 24570], ['FTA (Brass) ¾"', 59360]]);
  assert.equal(t.total, 484745);
  assert.equal(t.lineCount, 6);
  assert.equal(t.pieces, 49);
  assert.deepEqual(t.withGst, { gst: 87254, sum: 571999, grand: 572000, roundOff: 1 });
  assert.deepEqual(t.withoutGst, { gst: 0, sum: 484745, grand: 484700, roundOff: -45 });
  assert.deepEqual(finalFigures(t, true), { total: 484745, withGst: true, gstBp: 1800, gst: 87254, roundOff: 1, grand: 572000 });
  assert.deepEqual(finalFigures(t, false), { total: 484745, withGst: false, gstBp: 1800, gst: 0, roundOff: -45, grand: 484700 });
});

test('bill: one discount per brand and group, changing it changes every line in the group', () => {
  const bill = newBill(1);
  addLine(bill, entry({}), 10);
  addLine(bill, entry({ itemId: 'tee', itemName: 'Tee', rate: 3490 }), 10);
  addLine(bill, entry({ brandId: 'ashirvad', brandName: 'Ashirvad', rate: 3200 }), 10);
  assert.equal(discountFor(bill, 'supreme', 'plain'), null);
  setDiscount(bill, 'supreme', 'plain', 1000);
  let t = computeTotals(bill, 1800);
  assert.deepEqual(t.brands[0].lines.map((l) => l.net), [19170, 31410]);
  assert.equal(t.brands[1].lines[0].net, 32000); // other brand untouched, still missing
  assert.deepEqual(t.missing.map((m) => m.brandId), ['ashirvad']);
  setDiscount(bill, 'supreme', 'plain', 5000);
  t = computeTotals(bill, 1800);
  assert.deepEqual(t.brands[0].lines.map((l) => l.net), [10650, 17450]);
  assert.throws(() => setDiscount(bill, 'supreme', 'plain', 10001));
  assert.throws(() => setDiscount(bill, 'supreme', 'plain', 42.5));
});

test('bill: same item and size adds to the quantity; edit, remove and undo', () => {
  const bill = newBill(1);
  const a = addLine(bill, entry({}), 5);
  const b = addLine(bill, entry({}), 7);
  assert.equal(a, b);
  assert.equal(bill.lines.length, 1);
  assert.equal(bill.lines[0].qty, 12);
  const c = addLine(bill, entry({ sizeKey: '1', sizeLabel: '1"', rate: 4230 }), 1);
  const d = addLine(bill, entry({ itemId: 'tee', itemName: 'Tee' }), 2);
  assert.deepEqual(bill.lines.map((l) => l.id), [1, 2, 3]);
  updateLine(bill, c.id, { qty: 9 });
  assert.equal(bill.lines[1].qty, 9);
  const removed = removeLine(bill, c.id);
  assert.deepEqual(bill.lines.map((l) => l.id), [1, 3]);
  restoreLine(bill, removed);
  assert.deepEqual(bill.lines.map((l) => l.id), [1, 2, 3]);
  assert.equal(removeLine(bill, 99), null);
  assert.equal(updateLine(bill, 99, {}), null);
  assert.throws(() => addLine(bill, entry({}), 0));
  assert.throws(() => addLine(bill, entry({}), 1.5));
  assert.equal(lineName(d), 'Tee ¾"');
  const empty = computeTotals(newBill(1), 1800);
  assert.equal(empty.total, 0);
  assert.equal(empty.withGst.grand, 0);
});
