# Mangal Bill

Billing app for Mangal Hardware and Sanitary. It is a small installable web app: it opens from a
home-screen icon, works without internet, and reads its rates from one shared sheet.

Live app: https://namansingla-glitch.github.io/Mangal-bill/

The `docs/` folder is the built app that GitHub Pages serves (Settings > Pages > Deploy from a
branch > `main` / `docs`). After changing anything in `src/`, run `node tools/build.mjs` and
commit the new `docs/`.

## Put it on the phones

1. Put the contents of the `dist/` folder on any static web host that serves HTTPS
   (Netlify, Cloudflare Pages, GitHub Pages and similar are free for this).
2. Open the site's address in Chrome on each phone and choose **Install app** (or
   **Add to Home screen**) from the menu.
3. Open it once with internet. After that it works offline.

When a new version of the app is uploaded to the same address, each phone picks it up by
itself the next time it is opened with internet.

## Connect the rate sheet

1. Upload `Mangal-rates.xlsx` to Google Drive and open it with Google Sheets.
2. File > Share > Publish to web. Choose the **Rates** tab and **Comma-separated values (.csv)**.
3. Put the link in `dist/settings.json`:

   ```json
   { "ratesUrl": "https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv" }
   ```

Until a link is set, the app uses the rates in `src/data/rates.csv` that were built into it.
A sheet with a mistake is never used: the phones keep the last good rates and show the row and
column of the mistake under "Rates updated".

## How the code is laid out

| File | What it does |
|---|---|
| `src/js/money.js` | All money maths, in whole paise. Half-up rounding. No floating point. |
| `src/js/sizes.js` | Turns `1 1/4x3/4` into `1¼" × ¾"`. |
| `src/js/catalog.js` | Reads the rate sheet, checks it, reports mistakes by row and column. |
| `src/js/bill.js` | The bill: lines, one discount per brand and group, totals, GST, round-off. |
| `src/js/receipt.js` | Draws the estimate as a picture and as an A4 PDF. |
| `src/js/store.js` | What is saved on the phone (keys carry a version). |
| `src/js/app.js` | Screens and taps only. |
| `src/js/config.js` | Shop defaults, brand colours, which picture belongs to which item. |
| `src/sw.js` | Offline copy of the app. |

Adding a feature usually touches one of these. The money, sheet and bill files have no screen
code, so they can be tested (and reused) on their own.

## Build and test

```
npm install
node tools/build.mjs            # makes dist/ and preview.html
npm run test:unit               # engine tests
npm run test:cross              # 3,000 random bills checked against Python's Decimal
node --test --test-concurrency=1 tests/e2e/app.test.mjs   # the app in a real browser at phone sizes
node tools/serve.mjs            # try it on this computer at http://127.0.0.1:8080
```

## Pictures and font

The item pictures in `src/img/` are computer-made renders of typical fittings, not manufacturer
photos. To use your own, replace a file with a square WebP of the same name. The font is Mukta
(SIL Open Font License, see `src/fonts/OFL-LICENSE.txt`).
