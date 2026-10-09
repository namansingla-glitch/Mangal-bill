// Draws the estimate the customer receives, as a picture or as a PDF.
// Drawn on a canvas so it looks the same on every phone and needs no internet.

import { amountText, rupees, percentText } from './money.js';

const W = 1240; // canvas width in pixels (2x of a 620 wide page)
const PAGE_H = 1754; // A4 at this width
const M = 72; // side margin
const INK = '#0F1E33';
const MUTED = '#33415A';
const LINE = '#C3CDD9';
const FONT = "'Mukta', system-ui, sans-serif";
const COL = { no: M, item: M + 62, qty: 690, rate: 852, disc: 962, amount: W - M };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateText(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function timeText(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function font(ctx, weight, size) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}
/** Draws text, shrinking it (down to 60%) and then cutting it with "..." so it never overflows. */
function fitText(ctx, text, x, y, maxW, weight, size, align = 'left') {
  let s = size;
  font(ctx, weight, s);
  while (ctx.measureText(text).width > maxW && s > size * 0.6) font(ctx, weight, --s);
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 4) t = t.slice(0, -2).trimEnd() + '…';
  ctx.textAlign = align;
  ctx.fillText(t, x, y);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The estimate as a list of blocks, each knowing its height and how to draw itself at y. */
export function receiptBlocks(saved) {
  const blocks = [];
  const f = saved.figures;
  blocks.push({
    kind: 'header',
    h: 184,
    draw(ctx, y) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, y, W, 184);
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'alphabetic';
      fitText(ctx, saved.shop.name, M, y + 88, W - 2 * M - 250, 800, 56);
      ctx.fillStyle = '#D5DEE9';
      fitText(ctx, `Phone: ${saved.shop.phones.join(', ')}`, M, y + 140, W - 2 * M - 250, 400, 32);
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, W - M - 208, y + 60, 208, 64, 18);
      ctx.fill();
      ctx.fillStyle = INK;
      fitText(ctx, 'Estimate', W - M - 104, y + 104, 190, 800, 34, 'center');
    },
  });
  blocks.push({
    kind: 'meta',
    h: 96,
    draw(ctx, y) {
      ctx.fillStyle = INK;
      const date = dateText(saved.finishedAt);
      fitText(ctx, date, W - M, y + 66, 300, 600, 34, 'right');
      if (saved.customer) {
        font(ctx, 400, 34);
        ctx.textAlign = 'left';
        ctx.fillText('Customer: ', M, y + 66);
        const lead = ctx.measureText('Customer: ').width;
        fitText(ctx, saved.customer, M + lead, y + 66, W - 2 * M - lead - 330, 800, 34);
      }
    },
  });
  const tableHead = {
    kind: 'thead',
    h: 68,
    draw(ctx, y) {
      ctx.fillStyle = MUTED;
      font(ctx, 800, 28);
      ctx.textAlign = 'left';
      ctx.fillText('No.', COL.no, y + 44);
      ctx.fillText('Item', COL.item, y + 44);
      ctx.textAlign = 'right';
      ctx.fillText('Qty', COL.qty, y + 44);
      ctx.fillText('Rate ₹', COL.rate, y + 44);
      ctx.fillText('Disc.', COL.disc, y + 44);
      ctx.fillText('Amount ₹', COL.amount, y + 44);
      ctx.fillStyle = INK;
      ctx.fillRect(M, y + 64, W - 2 * M, 4);
    },
  };
  blocks.push(tableHead);
  let no = 0;
  for (const brand of saved.brands) {
    blocks.push({
      kind: 'brand',
      keepWithNext: true,
      h: 84,
      draw(ctx, y) {
        ctx.fillStyle = brand.tint;
        roundRect(ctx, M, y + 16, W - 2 * M, 68, 16);
        ctx.fill();
        ctx.fillStyle = brand.color;
        fitText(ctx, brand.name, M + 24, y + 62, W - 2 * M - 48, 800, 34);
      },
    });
    for (const line of brand.lines) {
      const n = ++no;
      blocks.push({
        kind: 'row',
        h: 68,
        draw(ctx, y) {
          ctx.fillStyle = MUTED;
          font(ctx, 400, 32);
          ctx.textAlign = 'left';
          ctx.fillText(String(n), COL.no, y + 46);
          ctx.fillStyle = INK;
          fitText(ctx, line.name, COL.item, y + 46, COL.qty - 96 - COL.item, 600, 32);
          font(ctx, 400, 32);
          ctx.textAlign = 'right';
          ctx.fillText(String(line.qty), COL.qty, y + 46);
          fitText(ctx, amountText(line.rate), COL.rate, y + 46, COL.rate - COL.qty - 18, 400, 32, 'right');
          font(ctx, 400, 32);
          ctx.textAlign = 'right';
          ctx.fillText(`${percentText(line.discountBp)}%`, COL.disc, y + 46);
          fitText(ctx, amountText(line.net), COL.amount, y + 46, COL.amount - COL.disc - 22, 600, 32, 'right');
          ctx.fillStyle = LINE;
          ctx.fillRect(M, y + 66, W - 2 * M, 2);
        },
      });
    }
    blocks.push({
      kind: 'brandTotal',
      h: 72,
      draw(ctx, y) {
        ctx.fillStyle = INK;
        font(ctx, 800, 32);
        ctx.textAlign = 'right';
        ctx.fillText(amountText(brand.subtotal), COL.amount, y + 48);
        fitText(ctx, `${brand.name} total`, COL.amount - 250, y + 48, 520, 800, 32, 'right');
      },
    });
  }
  const rows = [['Total', amountText(f.total)]];
  if (f.withGst) rows.push([`GST ${percentText(f.gstBp)}%`, amountText(f.gst)]);
  rows.push(['Round off', `${f.roundOff < 0 ? '−' : '+'} ${amountText(Math.abs(f.roundOff))}`]);
  const boxH = 36 + rows.length * 56 + 24 + 92 + 20;
  blocks.push({
    kind: 'totals',
    h: boxH + 40,
    draw(ctx, y) {
      const bw = 660;
      const bx = W - M - bw;
      ctx.fillStyle = '#EEF2F6';
      roundRect(ctx, bx, y + 32, bw, boxH, 28);
      ctx.fill();
      let ry = y + 32 + 36;
      for (const [label, value] of rows) {
        ctx.fillStyle = INK;
        font(ctx, 400, 34);
        ctx.textAlign = 'left';
        ctx.fillText(label, bx + 32, ry + 36);
        font(ctx, 600, 34);
        ctx.textAlign = 'right';
        ctx.fillText(value, bx + bw - 32, ry + 36);
        ry += 56;
      }
      ctx.fillStyle = INK;
      ctx.fillRect(bx + 32, ry + 8, bw - 64, 4);
      font(ctx, 800, 38);
      ctx.textAlign = 'left';
      ctx.fillText('Grand total', bx + 32, ry + 82);
      fitText(ctx, rupees(f.grand), bx + bw - 32, ry + 86, bw - 290, 800, 62, 'right');
    },
  });
  blocks.push({
    kind: 'footer',
    h: 96,
    draw(ctx, y) {
      ctx.fillStyle = LINE;
      ctx.fillRect(M, y + 28, W - 2 * M, 2);
      ctx.fillStyle = MUTED;
      font(ctx, 400, 28);
      ctx.textAlign = 'left';
      ctx.fillText(f.withGst ? 'This is an estimate, not a tax invoice.' : 'This is an estimate, not a tax invoice. GST is not included.', M, y + 72);
    },
  });
  return { blocks, tableHead };
}

/** Splits blocks into pages of at most maxH. The table heading is repeated on later pages. */
export function paginate({ blocks, tableHead }, maxH) {
  const pages = [[]];
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.h + (b.keepWithNext && blocks[i + 1] ? blocks[i + 1].h : 0);
    if (used + need > maxH && pages[pages.length - 1].length) {
      pages.push([]);
      used = 24;
      pages[pages.length - 1].push({ h: 24, draw() {} });
      if (b.kind === 'row' || b.kind === 'brand' || b.kind === 'brandTotal') {
        pages[pages.length - 1].push(tableHead);
        used += tableHead.h;
      }
    }
    pages[pages.length - 1].push(b);
    used += b.h;
  }
  return pages;
}

function drawPage(doc, blocks, height) {
  const canvas = doc.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, height);
  let y = 0;
  for (const b of blocks) {
    b.draw(ctx, y);
    y += b.h;
  }
  return canvas;
}

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all(['400', '600', '800'].flatMap((w) => [document.fonts.load(`${w} 32px 'Mukta'`, 'Aa1'), document.fonts.load(`${w} 32px 'Mukta'`, '₹')]));
  } catch {
    /* draw with the fallback font */
  }
}

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not make the picture'))), type, quality));

/** One tall picture of the whole estimate. */
export async function receiptPng(saved) {
  await fontsReady();
  const { blocks } = receiptBlocks(saved);
  const height = blocks.reduce((s, b) => s + b.h, 0) + 24;
  return toBlob(drawPage(document, blocks, height), 'image/png');
}

/** The estimate as an A4 PDF (more pages when the bill is long). */
export async function receiptPdf(saved) {
  await fontsReady();
  const pages = paginate(receiptBlocks(saved), PAGE_H - 40);
  const jpegs = [];
  for (const blocks of pages) {
    const blob = await toBlob(drawPage(document, blocks, PAGE_H), 'image/jpeg', 0.92);
    jpegs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return new Blob([buildPdf(jpegs, W, PAGE_H)], { type: 'application/pdf' });
}

/** A minimal PDF: each page is one JPEG picture filling an A4 page. */
export function buildPdf(jpegs, pxW, pxH) {
  const PW = 595.28;
  const PH = +((PW * pxH) / pxW).toFixed(2);
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length;
  const pageIds = jpegs.map((_, i) => 3 + i * 3);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`));
  jpegs.forEach((jpeg, i) => {
    const page = 3 + i * 3;
    const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`));
    obj(page + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(page + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      push('\nendstream');
    });
  });
  const count = 3 + n * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function fileName(saved, ext) {
  const d = new Date(saved.finishedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const who = (saved.customer || '').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return `Estimate-${stamp}${who ? '-' + who : ''}.${ext}`;
}

/**
 * Opens the phone's share sheet (WhatsApp and so on). Where sharing files is not
 * possible, the file is saved to Downloads instead. Returns 'shared', 'saved' or 'cancelled'.
 */
export async function shareFile(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}
