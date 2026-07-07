// Super admin: single customer view — plan (read-only), performance, settings.
//
// Plan tab is deliberately READ-ONLY: the console must never change a
// customer's plan (decided 2026-07-07). Plan writes stay limited to the
// billing callback, the dev switcher, and syncSubscriptionToPlan.
//
// Settings tab edits only fields the storefront/server reads from the DB
// (see apps.exit-intent.api.shop-settings.jsx) so every edit takes real
// effect. Discount/brand/plan fields are excluded — those flows create
// Shopify-side resources and must go through the merchant app.
import { useLoaderData, useSearchParams, Form, useNavigation, useActionData } from "react-router";
import { useState } from "react";
import {
  Page,
  Card,
  Tabs,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  TextField,
  Select,
  Checkbox,
  Button,
  DataTable,
  Divider,
} from "@shopify/polaris";
import { requireSuperAdmin, ADMIN_RESPONSE_HEADERS } from "../utils/admin-auth.server.js";
import { logAdminAction, diffFields } from "../utils/admin-audit.server.js";
import db from "../db.server.js";

export function headers() {
  return ADMIN_RESPONSE_HEADERS;
}

// Fields editable from the console. Single source of truth for the action's
// allowlist AND the audit diff — nothing outside this list can be written.
const EDITABLE_FIELDS = {
  mode: "string",
  aiGoal: "string",
  aggression: "int",
  budgetEnabled: "bool",
  budgetAmount: "float",
  budgetPeriod: "string",
  exitIntentEnabled: "bool",
  timeDelayEnabled: "bool",
  timeDelaySeconds: "int",
  cartValueEnabled: "bool",
  cartValueMin: "float",
  cartValueMax: "float",
  modalHeadline: "string",
  modalBody: "string",
  ctaButton: "string",
  redirectDestination: "string",
  socialProofEnabled: "bool",
  socialProofType: "string",
  socialProofMinimum: "int",
  storeVertical: "nullableString",
  contributeToMetaLearning: "bool",
  promotionalIntelligenceEnabled: "bool",
  mutationRate: "int",
  crossoverRate: "int",
  selectionPressure: "int",
  populationSize: "int",
};

function parseField(type, raw) {
  switch (type) {
    case "bool":
      return raw === "on" || raw === "true";
    case "int":
      return parseInt(raw, 10);
    case "float":
      return parseFloat(raw);
    case "nullableString":
      return raw ? String(raw) : null;
    default:
      return String(raw ?? "");
  }
}

async function fetchLiveShopify(shopifyDomain) {
  // Uses the shop's stored offline token — works for any installed shop.
  try {
    const { unauthenticated } = await import("../shopify.server.js");
    const { admin } = await unauthenticated.admin(shopifyDomain);
    const response = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions { id name status createdAt test }
        }
        shop {
          planMetafield: metafield(namespace: "exit_intent", key: "plan") { value }
        }
      }
    `);
    const data = (await response.json()).data;
    return {
      ok: true,
      subscriptions: data?.currentAppInstallation?.activeSubscriptions || [],
      planMetafield: data?.shop?.planMetafield?.value
        ? JSON.parse(data.shop.planMetafield.value)
        : null,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export async function loader({ request, params }) {
  requireSuperAdmin(request);

  const shop = await db.shop.findUnique({ where: { id: params.shopId } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "30", 10) || 30, 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    live,
    impressionAgg,
    variants,
    outcomeShown,
    outcomeSkipped,
    starterAgg,
    conversionAgg,
    recentDecisions,
    auditEntries,
  ] = await Promise.all([
    fetchLiveShopify(shop.shopifyDomain),
    db.variantImpression.aggregate({
      where: { shopId: shop.id, timestamp: { gte: since } },
      _count: { _all: true },
      _sum: { revenue: true, profit: true },
    }),
    db.variant.findMany({
      where: { shopId: shop.id },
      orderBy: { profitPerImpression: "desc" },
      take: 25,
      select: {
        variantId: true,
        status: true,
        generation: true,
        segment: true,
        impressions: true,
        clicks: true,
        conversions: true,
        revenue: true,
        profitPerImpression: true,
      },
    }),
    db.interventionOutcome.aggregate({
      where: { shopId: shop.id, wasShown: true, timestamp: { gte: since } },
      _count: { _all: true },
    }),
    db.interventionOutcome.aggregate({
      where: { shopId: shop.id, wasShown: false, timestamp: { gte: since } },
      _count: { _all: true },
    }),
    db.starterImpression.aggregate({
      where: { shopId: shop.id, timestamp: { gte: since } },
      _count: { _all: true },
    }),
    db.conversion.aggregate({
      where: { shopId: shop.id, orderedAt: { gte: since } },
      _count: { _all: true },
      _sum: { orderValue: true },
    }),
    db.aIDecision.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, decision: true, createdAt: true },
    }),
    db.adminAuditLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const convClicks = await db.variantImpression.count({
    where: { shopId: shop.id, timestamp: { gte: since }, clicked: true },
  });
  const convCount = await db.variantImpression.count({
    where: { shopId: shop.id, timestamp: { gte: since }, converted: true },
  });

  return {
    shop,
    live,
    days,
    perf: {
      impressions: impressionAgg._count._all,
      clicks: convClicks,
      conversions: convCount,
      revenue: impressionAgg._sum.revenue || 0,
      profit: impressionAgg._sum.profit || 0,
      shown: outcomeShown._count._all,
      skipped: outcomeSkipped._count._all,
      starterImpressions: starterAgg._count._all,
      orders: conversionAgg._count._all,
      orderRevenue: conversionAgg._sum.orderValue || 0,
    },
    variants,
    recentDecisions,
    auditEntries,
  };
}

export async function action({ request, params }) {
  requireSuperAdmin(request);

  const shop = await db.shop.findUnique({ where: { id: params.shopId } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const update = {};
  for (const [field, type] of Object.entries(EDITABLE_FIELDS)) {
    if (type === "bool") {
      // The settings form always submits every field, so an absent checkbox
      // means unchecked, not "not on this form".
      update[field] = formData.get(field) === "on" || formData.get(field) === "true";
      continue;
    }
    const raw = formData.get(field);
    if (raw === null) continue;
    const parsed = parseField(type, raw);
    if (type === "int" && Number.isNaN(parsed)) continue;
    if (type === "float" && Number.isNaN(parsed)) continue;
    update[field] = parsed;
  }

  const changed = diffFields(shop, update);
  if (Object.keys(changed).length === 0) {
    return { success: true, message: "No changes." };
  }

  await db.shop.update({ where: { id: shop.id }, data: update });
  await logAdminAction(request, "settings_update", {
    shopId: shop.id,
    payload: { shopifyDomain: shop.shopifyDomain, changed },
  });

  return { success: true, message: `Saved ${Object.keys(changed).length} field(s).` };
}

function StatCell({ label, value }) {
  return (
    <BlockStack gap="100">
      <Text as="span" tone="subdued" variant="bodySm">
        {label}
      </Text>
      <Text as="span" variant="headingLg">
        {value}
      </Text>
    </BlockStack>
  );
}

export default function AdminShopDetail() {
  const { shop, live, days, perf, variants, recentDecisions, auditEntries } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") || "plan";
  const tabs = [
    { id: "plan", content: "Plan & Billing" },
    { id: "performance", content: "Performance" },
    { id: "settings", content: "Settings" },
    { id: "audit", content: "Audit log" },
  ];
  const selectedTab = Math.max(0, tabs.findIndex((t) => t.id === tabParam));

  const [form, setForm] = useState(() => {
    const initial = {};
    for (const field of Object.keys(EDITABLE_FIELDS)) initial[field] = shop[field];
    return initial;
  });
  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setNum = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const dbTier = shop.plan;
  const metafieldTier = live.ok ? live.planMetafield?.tier : null;
  const drift = live.ok && metafieldTier && metafieldTier !== dbTier;

  return (
    <Page
      title={shop.shopifyDomain}
      subtitle={`Installed ${new Date(shop.createdAt).toLocaleDateString()}`}
      backAction={{ content: "Customers", url: "/admin" }}
      fullWidth
    >
      <BlockStack gap="400">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"}>{actionData.message}</Banner>
        )}
        <Tabs
          tabs={tabs}
          selected={selectedTab}
          onSelect={(index) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", tabs[index].id);
            setSearchParams(next, { replace: true });
          }}
        />

        {tabs[selectedTab].id === "plan" && (
          <BlockStack gap="400">
            <Banner tone="info">
              Read-only. Plan changes only happen through the merchant billing flow — the console
              cannot change a customer&apos;s plan.
            </Banner>
            {drift && (
              <Banner tone="warning">
                Drift detected: DB says <b>{dbTier}</b> but the plan metafield says{" "}
                <b>{metafieldTier}</b>. The dashboard self-heal (syncSubscriptionToPlan) should
                reconcile on the merchant&apos;s next dashboard load.
              </Banner>
            )}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Database (source of truth)
                </Text>
                <InlineGrid columns={4} gap="400">
                  <StatCell label="Plan tier" value={<Badge tone="success">{dbTier}</Badge>} />
                  <StatCell label="Subscription ID" value={shop.subscriptionId || "—"} />
                  <StatCell label="Promo code" value={shop.promoCode || "—"} />
                  <StatCell
                    label="Promo applied"
                    value={shop.promoAppliedAt ? new Date(shop.promoAppliedAt).toLocaleDateString() : "—"}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Live from Shopify
                </Text>
                {!live.ok ? (
                  <Banner tone="warning">
                    Could not reach Shopify for this shop: {live.error}. The shop may be
                    uninstalled or its offline token missing.
                  </Banner>
                ) : (
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued">
                      Plan metafield: {live.planMetafield ? JSON.stringify(live.planMetafield) : "not set"}
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Subscription", "Status", "Created", "Test"]}
                      rows={
                        live.subscriptions.length
                          ? live.subscriptions.map((sub) => [
                              sub.name,
                              sub.status,
                              new Date(sub.createdAt).toLocaleDateString(),
                              sub.test ? "yes" : "no",
                            ])
                          : [["No active subscriptions", "—", "—", "—"]]
                      }
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {tabs[selectedTab].id === "performance" && (
          <BlockStack gap="400">
            <InlineStack gap="200">
              {[7, 30, 90].map((option) => (
                <Button
                  key={option}
                  pressed={days === option}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("days", String(option));
                    setSearchParams(next, { replace: true });
                  }}
                >
                  {option}d
                </Button>
              ))}
            </InlineStack>
            <Card>
              <InlineGrid columns={5} gap="400">
                <StatCell
                  label={shop.mode === "ai" ? "AI impressions" : "Impressions"}
                  value={(shop.mode === "ai" ? perf.impressions : perf.starterImpressions).toLocaleString()}
                />
                <StatCell label="Clicks" value={perf.clicks.toLocaleString()} />
                <StatCell label="Conversions" value={perf.conversions.toLocaleString()} />
                <StatCell
                  label="Revenue"
                  value={`$${perf.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <StatCell
                  label="Profit"
                  value={`$${perf.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
              </InlineGrid>
            </Card>
            <Card>
              <InlineGrid columns={4} gap="400">
                <StatCell label="AI: shown" value={perf.shown.toLocaleString()} />
                <StatCell label="AI: skipped" value={perf.skipped.toLocaleString()} />
                <StatCell label="Orders attributed" value={perf.orders.toLocaleString()} />
                <StatCell
                  label="Order revenue"
                  value={`$${perf.orderRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
              </InlineGrid>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Variants (top 25 by profit/impression)
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Variant", "Status", "Gen", "Segment", "Impr.", "Conv.", "Revenue", "Profit/impr."]}
                  rows={variants.map((variant) => [
                    variant.variantId,
                    variant.status,
                    variant.generation,
                    variant.segment,
                    variant.impressions,
                    variant.conversions,
                    `$${variant.revenue.toFixed(0)}`,
                    `$${variant.profitPerImpression.toFixed(3)}`,
                  ])}
                />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Recent AI decisions
                </Text>
                <DataTable
                  columnContentTypes={["text", "text"]}
                  headings={["When", "Decision"]}
                  rows={recentDecisions.map((decision) => [
                    new Date(decision.createdAt).toLocaleString(),
                    decision.decision.length > 160
                      ? `${decision.decision.slice(0, 160)}…`
                      : decision.decision,
                  ])}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {tabs[selectedTab].id === "settings" && (
          <Form method="post">
            <BlockStack gap="400">
              <Banner tone="warning">
                Edits apply immediately to the live storefront and are audit-logged. Plan,
                discount-code, and branding changes are excluded — those must go through the
                merchant app.
              </Banner>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Mode & AI
                  </Text>
                  <InlineGrid columns={3} gap="400">
                    <Select
                      label="Mode"
                      name="mode"
                      options={[
                        { label: "Manual", value: "manual" },
                        { label: "AI", value: "ai" },
                      ]}
                      value={form.mode}
                      onChange={set("mode")}
                    />
                    <Select
                      label="AI goal"
                      name="aiGoal"
                      options={[
                        { label: "Revenue", value: "revenue" },
                        { label: "Conversion", value: "conversion" },
                        { label: "Profit", value: "profit" },
                      ]}
                      value={form.aiGoal}
                      onChange={set("aiGoal")}
                    />
                    <TextField
                      label="Aggression (1-10)"
                      name="aggression"
                      type="number"
                      value={String(form.aggression)}
                      onChange={setNum("aggression")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={3} gap="400">
                    <Checkbox
                      label="Budget enabled"
                      name="budgetEnabled"
                      checked={Boolean(form.budgetEnabled)}
                      onChange={set("budgetEnabled")}
                    />
                    <TextField
                      label="Budget amount"
                      name="budgetAmount"
                      type="number"
                      value={String(form.budgetAmount)}
                      onChange={setNum("budgetAmount")}
                      autoComplete="off"
                    />
                    <Select
                      label="Budget period"
                      name="budgetPeriod"
                      options={[
                        { label: "Month", value: "month" },
                        { label: "Week", value: "week" },
                      ]}
                      value={form.budgetPeriod}
                      onChange={set("budgetPeriod")}
                    />
                  </InlineGrid>
                  <InlineGrid columns={3} gap="400">
                    <Checkbox
                      label="Contribute to meta-learning"
                      name="contributeToMetaLearning"
                      checked={Boolean(form.contributeToMetaLearning)}
                      onChange={set("contributeToMetaLearning")}
                    />
                    <Checkbox
                      label="Promotional intelligence"
                      name="promotionalIntelligenceEnabled"
                      checked={Boolean(form.promotionalIntelligenceEnabled)}
                      onChange={set("promotionalIntelligenceEnabled")}
                    />
                    <TextField
                      label="Store vertical"
                      name="storeVertical"
                      value={form.storeVertical || ""}
                      onChange={set("storeVertical")}
                      placeholder="fashion, electronics, …"
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Triggers
                  </Text>
                  <InlineGrid columns={3} gap="400">
                    <Checkbox
                      label="Exit intent"
                      name="exitIntentEnabled"
                      checked={Boolean(form.exitIntentEnabled)}
                      onChange={set("exitIntentEnabled")}
                    />
                    <Checkbox
                      label="Time delay"
                      name="timeDelayEnabled"
                      checked={Boolean(form.timeDelayEnabled)}
                      onChange={set("timeDelayEnabled")}
                    />
                    <TextField
                      label="Time delay (seconds)"
                      name="timeDelaySeconds"
                      type="number"
                      value={String(form.timeDelaySeconds)}
                      onChange={setNum("timeDelaySeconds")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={3} gap="400">
                    <Checkbox
                      label="Cart value trigger"
                      name="cartValueEnabled"
                      checked={Boolean(form.cartValueEnabled)}
                      onChange={set("cartValueEnabled")}
                    />
                    <TextField
                      label="Min cart value"
                      name="cartValueMin"
                      type="number"
                      value={String(form.cartValueMin)}
                      onChange={setNum("cartValueMin")}
                      autoComplete="off"
                    />
                    <TextField
                      label="Max cart value"
                      name="cartValueMax"
                      type="number"
                      value={String(form.cartValueMax)}
                      onChange={setNum("cartValueMax")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Modal content (manual mode)
                  </Text>
                  <TextField
                    label="Headline"
                    name="modalHeadline"
                    value={form.modalHeadline || ""}
                    onChange={set("modalHeadline")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Body"
                    name="modalBody"
                    value={form.modalBody || ""}
                    onChange={set("modalBody")}
                    multiline={2}
                    autoComplete="off"
                  />
                  <InlineGrid columns={2} gap="400">
                    <TextField
                      label="CTA button"
                      name="ctaButton"
                      value={form.ctaButton || ""}
                      onChange={set("ctaButton")}
                      autoComplete="off"
                    />
                    <Select
                      label="Redirect"
                      name="redirectDestination"
                      options={[
                        { label: "Checkout", value: "checkout" },
                        { label: "Cart", value: "cart" },
                      ]}
                      value={form.redirectDestination || "checkout"}
                      onChange={set("redirectDestination")}
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Social proof & evolution
                  </Text>
                  <InlineGrid columns={3} gap="400">
                    <Checkbox
                      label="Social proof enabled"
                      name="socialProofEnabled"
                      checked={Boolean(form.socialProofEnabled)}
                      onChange={set("socialProofEnabled")}
                    />
                    <Select
                      label="Social proof type"
                      name="socialProofType"
                      options={[
                        { label: "Orders", value: "orders" },
                        { label: "Customers", value: "customers" },
                        { label: "Reviews", value: "reviews" },
                      ]}
                      value={form.socialProofType}
                      onChange={set("socialProofType")}
                    />
                    <TextField
                      label="Social proof minimum"
                      name="socialProofMinimum"
                      type="number"
                      value={String(form.socialProofMinimum)}
                      onChange={setNum("socialProofMinimum")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={4} gap="400">
                    <TextField
                      label="Mutation rate"
                      name="mutationRate"
                      type="number"
                      value={String(form.mutationRate)}
                      onChange={setNum("mutationRate")}
                      autoComplete="off"
                    />
                    <TextField
                      label="Crossover rate"
                      name="crossoverRate"
                      type="number"
                      value={String(form.crossoverRate)}
                      onChange={setNum("crossoverRate")}
                      autoComplete="off"
                    />
                    <TextField
                      label="Selection pressure"
                      name="selectionPressure"
                      type="number"
                      value={String(form.selectionPressure)}
                      onChange={setNum("selectionPressure")}
                      autoComplete="off"
                    />
                    <TextField
                      label="Population size"
                      name="populationSize"
                      type="number"
                      value={String(form.populationSize)}
                      onChange={setNum("populationSize")}
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
              <InlineStack align="end">
                <Button submit variant="primary" loading={navigation.state === "submitting"}>
                  Save settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        )}

        {tabs[selectedTab].id === "audit" && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Admin actions on this shop (latest 20)
              </Text>
              <Divider />
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["When", "Action", "IP", "Changes"]}
                rows={auditEntries.map((entry) => [
                  new Date(entry.createdAt).toLocaleString(),
                  entry.action,
                  entry.ip || "—",
                  entry.payload.length > 200 ? `${entry.payload.slice(0, 200)}…` : entry.payload,
                ])}
              />
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
