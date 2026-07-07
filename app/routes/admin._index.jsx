// Super admin: customer list — the "switch between customers" entry point.
import { useLoaderData, Link, useSearchParams } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  TextField,
  ChoiceList,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { requireSuperAdmin, ADMIN_RESPONSE_HEADERS } from "../utils/admin-auth.server.js";
import { isDevShop } from "../utils/dev-shop-guard.server.js";
import db from "../db.server.js";

export function headers() {
  return ADMIN_RESPONSE_HEADERS;
}

export async function loader({ request }) {
  requireSuperAdmin(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const planFilter = url.searchParams.get("plan") || "";

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [shops, impressions, starterImpressions, conversions] = await Promise.all([
    db.shop.findMany({
      select: {
        id: true,
        shopifyDomain: true,
        plan: true,
        mode: true,
        storeVertical: true,
        subscriptionId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.variantImpression.groupBy({
      by: ["shopId"],
      where: { timestamp: { gte: since } },
      _count: { _all: true },
    }),
    db.starterImpression.groupBy({
      by: ["shopId"],
      where: { timestamp: { gte: since } },
      _count: { _all: true },
    }),
    db.conversion.groupBy({
      by: ["shopId"],
      where: { orderedAt: { gte: since } },
      _count: { _all: true },
      _sum: { orderValue: true },
    }),
  ]);

  const impByShop = new Map(impressions.map((r) => [r.shopId, r._count._all]));
  const starterByShop = new Map(starterImpressions.map((r) => [r.shopId, r._count._all]));
  const convByShop = new Map(
    conversions.map((r) => [r.shopId, { count: r._count._all, revenue: r._sum.orderValue || 0 }]),
  );

  let rows = shops.map((shop) => ({
    ...shop,
    isDev: isDevShop(shop.shopifyDomain),
    impressions30d: (impByShop.get(shop.id) || 0) + (starterByShop.get(shop.id) || 0),
    conversions30d: convByShop.get(shop.id)?.count || 0,
    revenue30d: convByShop.get(shop.id)?.revenue || 0,
  }));

  if (q) rows = rows.filter((r) => r.shopifyDomain.toLowerCase().includes(q));
  if (planFilter) rows = rows.filter((r) => r.plan === planFilter);

  return { rows, q, planFilter };
}

const PLAN_TONE = { starter: "info", pro: "attention", enterprise: "success" };

export default function AdminCustomers() {
  const { rows, q, planFilter } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <Page title="Customers" subtitle={`${rows.length} stores`} fullWidth>
      <Card>
        <div style={{ padding: "12px 12px 0" }}>
          <InlineStack gap="400" blockAlign="center">
            <div style={{ minWidth: 280 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by domain"
                value={q}
                onChange={(value) => setParam("q", value)}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setParam("q", "")}
              />
            </div>
            <ChoiceList
              title="Plan"
              titleHidden
              choices={[
                { label: "All plans", value: "" },
                { label: "Starter", value: "starter" },
                { label: "Pro", value: "pro" },
                { label: "Enterprise", value: "enterprise" },
              ]}
              selected={[planFilter]}
              onChange={([value]) => setParam("plan", value)}
            />
          </InlineStack>
        </div>
        <IndexTable
          itemCount={rows.length}
          selectable={false}
          headings={[
            { title: "Store" },
            { title: "Plan" },
            { title: "Mode" },
            { title: "Vertical" },
            { title: "Installed" },
            { title: "Impressions (30d)" },
            { title: "Conversions (30d)" },
            { title: "Revenue (30d)" },
          ]}
        >
          {rows.map((shop, index) => (
            <IndexTable.Row id={shop.id} key={shop.id} position={index}>
              <IndexTable.Cell>
                <InlineStack gap="200" blockAlign="center">
                  <Link to={`/admin/shops/${shop.id}`}>
                    <Text as="span" fontWeight="semibold">
                      {shop.shopifyDomain}
                    </Text>
                  </Link>
                  {shop.isDev && <Badge tone="warning">dev</Badge>}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Badge tone={PLAN_TONE[shop.plan] || "info"}>{shop.plan}</Badge>
                {!shop.subscriptionId && shop.plan !== "starter" && (
                  <Badge tone="critical">no sub</Badge>
                )}
              </IndexTable.Cell>
              <IndexTable.Cell>{shop.mode}</IndexTable.Cell>
              <IndexTable.Cell>{shop.storeVertical || "—"}</IndexTable.Cell>
              <IndexTable.Cell>{new Date(shop.createdAt).toLocaleDateString()}</IndexTable.Cell>
              <IndexTable.Cell>{shop.impressions30d.toLocaleString()}</IndexTable.Cell>
              <IndexTable.Cell>{shop.conversions30d.toLocaleString()}</IndexTable.Cell>
              <IndexTable.Cell>
                ${shop.revenue30d.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}
