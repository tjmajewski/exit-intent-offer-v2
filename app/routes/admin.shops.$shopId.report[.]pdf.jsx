// Super-admin PDF export: the store analysis document sent to a merchant.
//
// Resource route — no component, returns the file. The `[.]pdf` in the
// filename escapes the dot so the URL ends in a real .pdf extension, which is
// what makes a browser download it under a sensible name rather than treating
// it as a route segment.
//
//   /admin/shops/<id>/report.pdf?days=30
//
// Super-admin only, deliberately. This is an operator tool for producing a
// document a human then reads before sending. Exposing it merchant-side would
// make it a self-serve report that nobody checks first, and the content is not
// ready for that.

import { requireSuperAdmin } from "../utils/admin-auth.server.js";
import { buildStoreReport } from "../utils/store-report.server.js";
import { renderStoreReportPdf } from "../utils/store-report-pdf.server.js";
import db from "../db.server.js";

export async function loader({ request, params }) {
  requireSuperAdmin(request);

  const shop = await db.shop.findUnique({
    where: { id: params.shopId },
    select: { id: true, shopifyDomain: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const days = Math.min(
    Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1),
    365
  );

  const report = await buildStoreReport({ shopId: shop.id, days });
  const pdf = await renderStoreReportPdf(report);

  // Name the file after the store and the day it was produced: these get
  // emailed and then sit in someone's downloads folder for a month.
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = shop.shopifyDomain.replace(/\.myshopify\.com$/, "").replace(/[^a-z0-9-]/gi, "-");
  const filename = `Resparq-${days}d-Analysis-${slug}-${stamp}.pdf`;

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      // An operator regenerating after a data fix must not get a stale copy.
      "Cache-Control": "no-store",
    },
  });
}
