// Read-only. Every surface that shows a merchant a performance number must
// agree with the super-admin console for the same shop and window.
import db from '../../app/db.server.js';
import { getShopMetrics } from '../../app/utils/shop-metrics.server.js';
import { getKpis } from '../../app/utils/admin-metrics.server.js';

const WINDOWS = [7, 30];
const shops = await db.shop.findMany({ select: { id: true, shopifyDomain: true, mode: true } });
let failures = 0;

for (const shop of shops) {
  for (const days of WINDOWS) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    // Merchant dashboard (app._index) and merchant Analytics page (app.analytics)
    // both call getShopMetrics with the shop's mode — same call, one source.
    const merchant = await getShopMetrics({ shopId: shop.id, days, mode: shop.mode });
    // Super admin shop page calls the identical function.
    const adminShopPage = await getShopMetrics({ shopId: shop.id, days, mode: shop.mode });
    // Super admin global dashboard.
    const adminGlobal = await getKpis({ shopIds: [shop.id], from, to }, [shop]);

    const rows = [
      ['impressions', merchant.impressions, adminShopPage.impressions, adminGlobal.impressions],
      ['clicks', merchant.clicks, adminShopPage.clicks, adminGlobal.clicks],
      ['conversions', merchant.conversions, adminShopPage.conversions, adminGlobal.conversions],
      ['revenue', Math.round(merchant.revenue), Math.round(adminShopPage.revenue), Math.round(adminGlobal.revenue)],
      ['profit', Math.round(merchant.profit), Math.round(adminShopPage.profit), Math.round(adminGlobal.profit)],
      ['CVR', +merchant.conversionRate.toFixed(2), +adminShopPage.conversionRate.toFixed(2), +(adminGlobal.cvr * 100).toFixed(2)],
    ];
    console.log(`\n${shop.shopifyDomain} — last ${days}d`);
    for (const [name, a, b, c] of rows) {
      const ok = a === b && b === c;
      if (!ok) failures++;
      console.log(`  ${ok ? 'MATCH ' : 'DIFFER'} ${name.padEnd(12)} merchant=${a}  admin/shop=${b}  admin/global=${c}`);
    }
  }
}
console.log(failures === 0 ? '\nAll three surfaces reconcile.' : `\n${failures} mismatch(es).`);
await db.$disconnect();
