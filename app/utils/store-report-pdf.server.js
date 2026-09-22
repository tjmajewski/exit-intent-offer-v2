// Renders a report object from store-report.server.js as a PDF.
//
// LAYOUT ONLY. Nothing here queries, derives or decides a number — if a figure
// is wrong the fix is in the builder, and if the document looks wrong the fix
// is here. The split is what makes the content safe to iterate on.
//
// pdfkit rather than a headless browser: the app runs on a small Fly machine
// and bundling Chromium to set some text in a box is not a trade worth making.

import PDFDocument from "pdfkit";

const INK = "#14161a";
const MUTED = "#5b6472";
const RULE = "#dfe3ea";
const BAND = "#f4f6f9";
const BRAND = "#5b4bd6";

/**
 * Dates are stored as UTC instants and must render as the calendar day they
 * represent, not the day it happens to be in the server's timezone. Without an
 * explicit zone a shop installed 2026-09-14T00:00Z prints as 13 September on
 * any machine west of Greenwich — which is what this document did before the
 * first render was checked.
 */
function day(date) {
  return new Date(date).toLocaleDateString("en-US", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const PAGE = { width: 612, height: 792 };
const M = { left: 58, right: 58, top: 56, bottom: 64 };
const CONTENT_W = PAGE.width - M.left - M.right;

/** "pro" -> "Pro". Plan and mode come out of the DB lowercased. */
function titleCase(s) {
  return String(s || "").replace(/\b[a-z]/g, c => c.toUpperCase());
}

/** Room needed below the cursor before a block is worth starting on this page. */
function ensure(doc, needed) {
  if (doc.y + needed > PAGE.height - M.bottom) doc.addPage();
}

function heading(doc, text) {
  ensure(doc, 46);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK)
    .text(text, M.left, doc.y, { width: CONTENT_W });
  doc.moveDown(0.35);
}

function body(doc, text, opts = {}) {
  const size = opts.small ? 8.6 : 10;
  ensure(doc, size * 3);
  doc.font("Helvetica").fontSize(size).fillColor(opts.small ? MUTED : INK)
    .text(text, M.left, doc.y, {
      width: CONTENT_W,
      align: "left",
      lineGap: opts.small ? 2.2 : 3.4,
    });
  doc.moveDown(opts.small ? 0.5 : 0.6);
}

/** Three big numbers across the page. */
function statRow(doc, stats) {
  if (!stats.length) return;
  const h = 56;
  ensure(doc, h + 12);
  const top = doc.y;
  const w = CONTENT_W / stats.length;
  doc.save().rect(M.left, top, CONTENT_W, h).fill(BAND).restore();
  stats.forEach((s, i) => {
    const x = M.left + i * w;
    if (i) {
      doc.save().moveTo(x, top + 10).lineTo(x, top + h - 10)
        .lineWidth(0.5).stroke(RULE).restore();
    }
    doc.font("Helvetica-Bold").fontSize(17).fillColor(INK)
      .text(String(s.value), x + 13, top + 12, { width: w - 26, ellipsis: true });
    doc.font("Helvetica").fontSize(8.4).fillColor(MUTED)
      .text(s.label, x + 13, top + 35, { width: w - 26, ellipsis: true });
  });
  doc.y = top + h + 12;
}

/** Two-column label/value table with a header row. */
function table(doc, head, rows) {
  if (!rows.length) return;
  const colL = CONTENT_W * 0.62;
  const colR = CONTENT_W - colL;
  const rowH = 22;
  ensure(doc, rowH * Math.min(rows.length + 1, 4));

  const drawRow = (left, right, { bold = false, header = false } = {}) => {
    if (doc.y + rowH > PAGE.height - M.bottom) {
      doc.addPage();
      // Repeat the header so a split table still reads on the next page.
      if (!header) drawRow(head[0], head[1], { header: true });
    }
    const top = doc.y;
    doc.save().rect(M.left, top, CONTENT_W, rowH).fill(BAND).restore();
    doc.save().moveTo(M.left, top + rowH).lineTo(M.left + CONTENT_W, top + rowH)
      .lineWidth(header ? 0.9 : 0.5).stroke(RULE).restore();
    doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9.4)
      .fillColor(INK)
      .text(left, M.left + 11, top + 6.5, { width: colL - 22, ellipsis: true });
    doc.font(header || bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.4)
      .fillColor(INK)
      .text(right, M.left + colL, top + 6.5, { width: colR - 11, ellipsis: true });
    doc.y = top + rowH;
  };

  drawRow(head[0], head[1], { header: true });
  rows.forEach(([l, r]) => drawRow(l, r, { bold: true }));
  doc.moveDown(0.55);
}

function chrome(doc, report, pageNo, pageCount) {
  doc.save().rect(0, 0, PAGE.width, 7).fill(BRAND).restore();
  doc.save().moveTo(M.left, PAGE.height - 50).lineTo(PAGE.width - M.right, PAGE.height - 50)
    .lineWidth(0.5).stroke(RULE).restore();

  // Footer text sits BELOW the bottom margin, and pdfkit responds to that by
  // helpfully starting a new page — which is how a 3-page report rendered as 9,
  // every second page blank but for a footer. Zero the margin for the duration
  // of the write and restore it after.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(7.8).fillColor(MUTED)
    .text(`Resparq  |  Store analysis for ${report.shop.domain}  |  ${day(report.window.until)}`,
      M.left, PAGE.height - 42, { width: CONTENT_W - 130, lineBreak: false });
  doc.font("Helvetica").fontSize(7.8).fillColor(MUTED)
    .text(`Page ${pageNo} of ${pageCount}`,
      PAGE.width - M.right - 130, PAGE.height - 42,
      { width: 130, align: "right", lineBreak: false });
  doc.page.margins.bottom = savedBottom;
}

/**
 * @param {object} report from buildStoreReport
 * @returns {Promise<Buffer>} the rendered PDF
 */
export function renderStoreReportPdf(report) {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: { top: M.top, bottom: M.bottom, left: M.left, right: M.right },
    bufferPages: true,
    info: {
      Title: `Resparq — ${report.window.days}-Day Store Analysis, ${report.shop.domain}`,
      Author: "Resparq",
    },
  });

  const chunks = [];
  doc.on("data", c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const f = report.fmt;
  const d = report;

  // --- Title
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK)
    .text(`${d.window.days}-Day Store Analysis`, M.left, M.top + 8, { width: CONTENT_W });
  doc.moveDown(0.15);
  doc.font("Helvetica").fontSize(9.6).fillColor(MUTED).text(
    `${d.shop.domain}  ·  ${d.shop.mode === "ai" ? "AI mode" : d.shop.mode === "hybrid" ? "Guided mode" : "Manual mode"}` +
    `, ${titleCase(d.shop.plan)} plan  ·  installed ${day(d.shop.installedAt)}` +
    `  ·  window ending ${day(d.window.until)}`,
    M.left, doc.y, { width: CONTENT_W, lineGap: 2 });
  doc.moveDown(1);

  // --- 1. Activity
  heading(doc, `1. What happened in the last ${d.window.days} days`);
  statRow(doc, [
    { value: d.engagement.visitors.toLocaleString(), label: "shoppers seen" },
    { value: d.delivery.rendered.toLocaleString(), label: "offers displayed" },
    { value: f(d.money.revenue), label: "revenue after an offer" },
  ]);
  table(doc, ["Measure", `Last ${d.window.days} days`], [
    ["Shopper sessions evaluated", d.engagement.sessions.toLocaleString()],
    ["Offers actually displayed to a shopper", d.delivery.rendered.toLocaleString()],
    ["Orders placed after an offer was displayed", d.money.orders.toLocaleString()],
    ["Revenue on those orders", f(d.money.revenue)],
    ["Average order value", d.money.orders > 0 ? f(d.money.aov) : "—"],
    ["Discount given to earn it", f(d.money.discountGiven)],
    ["Discount codes issued / redeemed", `${d.codes.minted} / ${d.codes.redeemed}`],
  ]);
  body(doc,
    "Revenue here is attributed, not claimed as caused: it counts orders placed " +
    "after a Resparq offer was displayed in the same cart session. Whether those " +
    "orders would have happened anyway is a different question, and the last " +
    "section of this report is how it gets answered.",
    { small: true });

  // --- 2. Cart shape
  if (d.cart) {
    heading(doc, "2. Your cart profile");
    table(doc, ["Cart size", "Value"], [
      ["Smaller carts (10th percentile)", f(d.cart.p10)],
      ["Typical cart (median)", f(d.cart.median)],
      ["Larger carts (90th percentile)", f(d.cart.p90)],
    ]);
    body(doc,
      `Measured across ${d.cart.count.toLocaleString()} carts seen in this window. ` +
      "Offer sizing is derived from these numbers rather than from a fixed pool.",
      { small: true });
  }

  // --- 3. Delivery
  heading(doc, `${d.cart ? "3" : "2"}. Offer delivery`);
  table(doc, ["Offer delivery", `Last ${d.window.days} days`], [
    ["Times Resparq decided to make an offer", d.delivery.decided.toLocaleString()],
    ["Times the offer reached the shopper", d.delivery.rendered.toLocaleString()],
    ["Times it did not", d.delivery.notRendered.toLocaleString()],
    ["Delivery rate", `${d.delivery.ratePct.toFixed(0)}%`],
  ]);
  if (d.devices.total > 0) {
    table(doc, ["Where your shoppers are", `Last ${d.window.days} days`], [
      ["Mobile sessions", `${d.devices.mobile} of ${d.devices.total}`],
      ["Desktop sessions", `${d.devices.desktop} of ${d.devices.total}`],
    ]);
  }

  // --- 4. Measurement
  if (d.shop.hasControlArm) {
    heading(doc, `${d.cart ? "4" : "3"}. How we prove whether Resparq is working`);
    body(doc,
      "Most apps in this category count any order that follows a popup as revenue " +
      "they recovered. That number is always flattering and never checkable, " +
      "because it has no idea what would have happened without the popup.");
    body(doc,
      "Resparq holds back a random share of your shoppers and shows them nothing " +
      "at all. They are your control group. Comparing the two groups is the only " +
      "honest way to tell whether Resparq is adding orders or taking credit for " +
      "orders you would have won regardless.");
    if (d.arms) {
      table(doc, ["Group", `Last ${d.window.days} days`], [
        ["Shoppers with Resparq running",
          `${d.arms.treated.converted} of ${d.arms.treated.customers} ordered` +
          (d.arms.treated.customers > 0 ? ` (${d.arms.treated.rate.toFixed(1)}%)` : "")],
        ["Shoppers held back as a control",
          d.arms.controlReady
            ? `${d.arms.control.converted} of ${d.arms.control.customers} ordered` +
              ` (${d.arms.control.rate.toFixed(1)}%)`
            : `${d.arms.control.customers} so far — not yet enough to compare`],
      ]);
      if (!d.arms.controlReady) {
        body(doc,
          `The comparison needs ${d.arms.controlMinimum} held-back shoppers before ` +
          "it means anything, and your dashboard will read TBD until then. We would " +
          "rather show you nothing than a number built on a handful of people that " +
          "you might act on and later find was noise.");
      }
      body(doc,
        "Holding shoppers back has a real cost: a small number of people who might " +
        "have converted see no offer. It is worth it, because without a control " +
        "group every figure we ever show you is unfalsifiable.",
        { small: true });
    }
  }

  // --- 5. Findings
  if (d.findings.length) {
    heading(doc, "What stands out on your store");
    d.findings.forEach((fd, i) => {
      ensure(doc, 64);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK)
        .text(`${i + 1}. ${fd.title}`, M.left, doc.y, { width: CONTENT_W });
      doc.moveDown(0.2);
      body(doc, fd.body);
    });
  }

  // --- Close
  heading(doc, "What we would like to do next");
  body(doc,
    "Tell us what you actually want from Resparq. Recovering abandoning shoppers, " +
    "lifting average order value and protecting margin pull in different " +
    "directions, and the AI is currently tuned on a general-purpose assumption " +
    "rather than on your goal. Twenty minutes on a call and we can point it properly.");
  doc.moveDown(0.3);
  body(doc,
    `All figures measured from production data for the ${d.window.days} days ending ` +
    `${day(d.window.until)}. Revenue is attributed, not a causal claim.`,
    { small: true });

  // Chrome last, over every page, so page count is final.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    chrome(doc, report, i + 1, range.count);
  }
  // flushPages before end() so no further page can be appended behind the
  // chrome pass and end up without a header.
  doc.flushPages();

  doc.end();
  return done;
}
