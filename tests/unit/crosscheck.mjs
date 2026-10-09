// Cross-check: thousands of random bills are worked out by the app's code and,
// separately, by Python's Decimal arithmetic (tests/unit/crosscheck.py). Every figure must match.
// usage: node crosscheck.mjs gen > cases.json ; python3 crosscheck.py cases.json > expected.json ; node crosscheck.mjs check cases.json expected.json
import fs from 'node:fs';
import { lineAmounts, gstAmount, roundToRupee, amountText } from '../../src/js/money.js';

let seed = 20261010;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function gen() {
  const bills = [];
  for (let b = 0; b < 3000; b++) {
    const n = b < 50 ? 1 : int(1, 14);
    const lines = [];
    for (let i = 0; i < n; i++) {
      const style = int(0, 9);
      const rate = style === 0 ? int(1, 99) : style === 1 ? int(100000, 1000000000) : pick([2130, 4230, 8860, 21933, 65800, 100800, 13780, 37100]) + (style === 2 ? int(0, 99) : 0);
      const qty = style === 3 ? int(1000, 99999) : int(1, 120);
      const disc = pick([0, 10000, 4250, 4000, 2500, 1250, 3333, 5000, 4255, 5, 9999, int(0, 10000)]);
      lines.push({ rate, qty, disc });
    }
    bills.push({ lines, gst: pick([1800, 1800, 1200, 500, 2800, 0]) });
  }
  return bills;
}

function compute(bill) {
  let total = 0;
  const nets = bill.lines.map((l) => {
    const a = lineAmounts(l.rate, l.qty, l.disc);
    total += a.net;
    return a.net;
  });
  const gst = gstAmount(total, bill.gst);
  return { nets, total, gst, withGst: roundToRupee(total + gst), withoutGst: roundToRupee(total), totalText: amountText(total) };
}

const [mode, casesFile, expectedFile] = process.argv.slice(2);
if (mode === 'gen') {
  process.stdout.write(JSON.stringify(gen()));
} else {
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  let lines = 0;
  let bad = 0;
  cases.forEach((bill, i) => {
    const got = compute(bill);
    lines += bill.lines.length;
    if (JSON.stringify(got) !== JSON.stringify(expected[i])) {
      bad++;
      if (bad <= 5) console.log('MISMATCH bill', i, JSON.stringify(bill), '\n  app   ', JSON.stringify(got), '\n  python', JSON.stringify(expected[i]));
    }
  });
  console.log(`${cases.length} bills, ${lines} lines checked against Python Decimal: ${bad} mismatches`);
  process.exit(bad ? 1 : 0);
}
