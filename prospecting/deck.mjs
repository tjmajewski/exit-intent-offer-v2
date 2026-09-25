// Renders the current batch as a PowerPoint deck, one slide per email.
//
// A spreadsheet is the wrong shape for this work: the thing you actually need
// to read is a paragraph of prose, and prose in a cell is unreadable. A slide
// gives the body room and keeps the facts that justify it alongside.
//
// Called by draft-emails.mjs --pptx. Requires `npm install` inside prospecting/.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Resparq's own palette, lifted from the website: near-black ground, navy
// cards, periwinkle accent, muted lavender for secondary text.
const INK = '0A0A0F';
const CARD = '14142A';
const ACCENT = '8B8BFF';
const MUTED = 'B4B4C8';
const WHITE = 'FFFFFF';

const W = 13.33;
const H = 7.5;

// Left card geometry, fixed so a long fact list cannot overrun the slide.
const CARD_TOP = 1.5;
const CARD_H = 5.4;
const FACTS_TOP = 2.15;
const FACT_STEP = 0.52;
const MAX_FACTS = 6;
const WHY_LABEL_Y = 5.75;
const WHY_BODY_Y = 6.03;

const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function factLines(d) {
  const out = [];
  const cat = d.catalog || {};
  if (cat.available && d.currency === 'USD') {
    out.push(['Median item', money(cat.medianPrice)]);
    if (cat.maxPrice) out.push(['Top item', money(cat.maxPrice)]);
    // Same honesty split as the email: months only when one order actually
    // covers one, orders per month when it does not.
    if (d.paybackMonths) out.push(['One order covers', `${d.paybackMonths} mo at $50/mo`]);
    else if (d.ordersPerMonth) out.push(['Pays for itself at', `${d.ordersPerMonth} recovered orders/mo`]);
  } else if (cat.available) {
    out.push(['Prices', `${d.currency || 'unknown'}, not converted`]);
  } else {
    out.push(['Catalog', 'not readable']);
  }
  out.push(['Popup vendor', d.vendors?.length ? d.vendors.join(', ') : 'none detected']);
  if (d.discountHints?.length) out.push(['Site offers', d.discountHints.slice(0, 2).join(', ')]);
  if (cat.productCount) out.push(['Products', String(cat.productCount)]);
  if (d.storeName) out.push(['Store', d.storeName]);
  if (d.country) out.push(['Country', d.country]);
  // The card reserves its lower band for the score breakdown, so the fact list
  // gets a fixed number of rows rather than pushing that band off the slide.
  return out.slice(0, MAX_FACTS);
}

export async function buildDeck(drafts, outPath, meta = {}) {
  const PptxGenJS = require('pptxgenjs');
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // must be set before any slide is added
  pres.author = 'Resparq';
  pres.title = 'Resparq outreach batch';

  // ---- title slide
  const title = pres.addSlide();
  title.background = { color: INK };
  title.addText('Resparq', {
    x: 0.9, y: 2.3, w: 11.5, h: 0.8, isTextBox: true, margin: 0,
    fontSize: 54, bold: true, color: WHITE, fontFace: 'Calibri',
  });
  title.addText('Outreach batch', {
    x: 0.9, y: 3.1, w: 11.5, h: 0.6, isTextBox: true, margin: 0,
    fontSize: 30, color: ACCENT, fontFace: 'Calibri',
  });
  title.addText(
    `${drafts.length} email${drafts.length === 1 ? '' : 's'}, best lead first  ·  ${meta.date || new Date().toISOString().slice(0, 10)}`,
    { x: 0.9, y: 3.95, w: 11.5, h: 0.4, isTextBox: true, margin: 0, fontSize: 16, color: MUTED, fontFace: 'Calibri' },
  );
  title.addText('Nothing here has been sent. After you send one, record it so the follow-up schedules itself.', {
    x: 0.9, y: 5.6, w: 11.5, h: 0.4, isTextBox: true, margin: 0, fontSize: 13, color: MUTED, italic: true, fontFace: 'Calibri',
  });
  title.addText('node prospecting/draft-emails.mjs --sent yourstore.com', {
    x: 0.9, y: 6.05, w: 11.5, h: 0.4, isTextBox: true, margin: 0, fontSize: 13, color: ACCENT, fontFace: 'Courier New',
  });

  // ---- one slide per email
  for (const d of drafts) {
    const s = pres.addSlide();
    s.background = { color: INK };

    // Rank badge: the repeated motif, no accent stripes anywhere.
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.6, y: 0.5, w: 0.62, h: 0.62, fill: { color: ACCENT },
    });
    s.addText(String(d.rank), {
      x: 0.6, y: 0.5, w: 0.62, h: 0.62, isTextBox: true, margin: 0,
      fontSize: 20, bold: true, color: INK, align: 'center', valign: 'middle', fontFace: 'Calibri',
    });

    s.addText(d.domain, {
      x: 1.4, y: 0.45, w: 8.6, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 28, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    const touchLabel = d.touch > 1
      ? `Follow-up ${d.touch}${d.overdueDays > 0 ? `, ${d.overdueDays}d overdue` : ''}`
      : 'First contact';
    s.addText(`${d.scenario}  ·  score ${d.score}  ·  ${touchLabel}`, {
      x: 1.4, y: 0.98, w: 8.6, h: 0.32, isTextBox: true, margin: 0,
      fontSize: 12, color: MUTED, fontFace: 'Calibri',
    });

    if (d.needsContact) {
      s.addShape(pres.ShapeType.roundRect, {
        x: 10.35, y: 0.52, w: 2.35, h: 0.42, fill: { color: CARD }, rectRadius: 0.2,
        line: { color: ACCENT, width: 1 },
      });
      s.addText('NEEDS CONTACT', {
        x: 10.35, y: 0.52, w: 2.35, h: 0.42, isTextBox: true, margin: 0,
        fontSize: 11, bold: true, color: ACCENT, align: 'center', valign: 'middle',
        charSpacing: 1, fontFace: 'Calibri',
      });
    }

    // ---- left card: the evidence behind the email
    s.addShape(pres.ShapeType.roundRect, {
      x: 0.6, y: CARD_TOP, w: 4.1, h: CARD_H, fill: { color: CARD }, rectRadius: 0.08, line: { color: CARD, width: 0 },
    });

    s.addText('WHAT THE SCAN FOUND', {
      x: 0.9, y: 1.75, w: 3.6, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
    });

    let y = FACTS_TOP;
    for (const [label, value] of factLines(d)) {
      s.addText(label, {
        x: 0.9, y, w: 3.6, h: 0.22, isTextBox: true, margin: 0,
        fontSize: 9, color: MUTED, charSpacing: 0.5, fontFace: 'Calibri',
      });
      s.addText(value, {
        x: 0.9, y: y + 0.2, w: 3.6, h: 0.28, isTextBox: true, margin: 0,
        fontSize: 14, bold: true, color: WHITE, fontFace: 'Calibri',
      });
      y += FACT_STEP;
    }

    if (d.why?.length) {
      s.addText('WHY IT RANKED HERE', {
        x: 0.9, y: WHY_LABEL_Y, w: 3.6, h: 0.24, isTextBox: true, margin: 0,
        fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
      });
      s.addText(d.why.join('   '), {
        x: 0.9, y: WHY_BODY_Y, w: 3.6, h: 0.78, isTextBox: true, margin: 0,
        fontSize: 10, color: MUTED, fontFace: 'Calibri',
      });
    }

    // ---- right: the email itself
    if (d.to) {
      s.addText('TO', {
        x: 5.1, y: 1.55, w: 7.6, h: 0.24, isTextBox: true, margin: 0,
        fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
      });
      s.addText(d.to, {
        x: 5.1, y: 1.8, w: 7.6, h: 0.28, isTextBox: true, margin: 0,
        fontSize: 13, color: WHITE, fontFace: 'Calibri',
      });
    } else {
      // No contact yet, so the slot that would hold the address holds the
      // searches that find one. Clickable straight out of the deck.
      s.addText('FIND THE CONTACT', {
        x: 5.1, y: 1.55, w: 7.6, h: 0.24, isTextBox: true, margin: 0,
        fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
      });
      const links = (d.research || []).slice(0, 4);
      const slot = 7.6 / Math.max(links.length, 1);
      links.forEach(([label, url], i) => {
        s.addShape(pres.ShapeType.roundRect, {
          x: 5.1 + i * slot, y: 1.82, w: slot - 0.12, h: 0.34,
          fill: { color: CARD }, rectRadius: 0.16, line: { color: ACCENT, width: 0.75 },
        });
        s.addText(label.replace(/^Google: /, '').replace(/^LinkedIn /, 'LI '), {
          x: 5.1 + i * slot, y: 1.82, w: slot - 0.12, h: 0.34, isTextBox: true, margin: 0,
          fontSize: 9.5, color: ACCENT, align: 'center', valign: 'middle', fontFace: 'Calibri',
          hyperlink: { url, tooltip: label },
        });
      });
    }

    s.addText('SUBJECT', {
      x: 5.1, y: 2.2, w: 7.6, h: 0.24, isTextBox: true, margin: 0,
      fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
    });
    s.addText(d.subject, {
      x: 5.1, y: 2.45, w: 7.6, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 14, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    s.addText('BODY', {
      x: 5.1, y: 3.05, w: 7.6, h: 0.24, isTextBox: true, margin: 0,
      fontSize: 10, bold: true, color: ACCENT, charSpacing: 1, fontFace: 'Calibri',
    });
    s.addShape(pres.ShapeType.roundRect, {
      x: 5.1, y: 3.32, w: 7.6, h: 3.58, fill: { color: CARD }, rectRadius: 0.06, line: { color: CARD, width: 0 },
    });
    s.addText(d.body, {
      x: 5.32, y: 3.48, w: 7.16, h: 3.26, isTextBox: true, margin: 0,
      fontSize: 11, color: WHITE, fontFace: 'Calibri', lineSpacingMultiple: 1.12, valign: 'top',
    });

    s.addNotes(`${d.domain} | score ${d.score} | ${d.scenario} | touch ${d.touch}\nRecord the send: node prospecting/draft-emails.mjs --sent ${d.domain}`);
  }

  // ---- closing slide
  const end = pres.addSlide();
  end.background = { color: INK };
  end.addText('After you send', {
    x: 0.9, y: 1.4, w: 11.5, h: 0.7, isTextBox: true, margin: 0,
    fontSize: 38, bold: true, color: WHITE, fontFace: 'Calibri',
  });
  const steps = [
    ['Record it', 'node prospecting/draft-emails.mjs --sent yourstore.com', 'Drops the lead out of the pool and schedules touch two for four days out.'],
    ['They answered', 'node prospecting/draft-emails.mjs --replied yourstore.com', 'Stops all follow-ups. Use this the moment anyone replies.'],
    ['Not interested', 'node prospecting/draft-emails.mjs --dead yourstore.com', 'Also stops follow-ups. The only thing preventing a third email to someone who declined.'],
    ['Next batch', 'node prospecting/draft-emails.mjs --pptx', 'Twelve more, with any due follow-ups mixed in wherever they rank.'],
  ];
  let sy = 2.5;
  for (const [label, cmd, note] of steps) {
    end.addShape(pres.ShapeType.ellipse, { x: 0.9, y: sy + 0.06, w: 0.18, h: 0.18, fill: { color: ACCENT } });
    end.addText(label, {
      x: 1.3, y: sy, w: 3.0, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 15, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    end.addText(cmd, {
      x: 4.3, y: sy, w: 8.2, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 12, color: ACCENT, fontFace: 'Courier New',
    });
    end.addText(note, {
      x: 4.3, y: sy + 0.3, w: 8.2, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 11, color: MUTED, fontFace: 'Calibri',
    });
    sy += 0.92;
  }

  await pres.writeFile({ fileName: outPath });
  return outPath;
}
