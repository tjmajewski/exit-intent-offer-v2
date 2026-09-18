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
import InfoPopover from "../components/admin/InfoPopover.jsx";
import { METRIC_INFO } from "../components/admin/metric-info.js";
import {
  describeMode,
  makesAIDecisions,
  describeOffer,
  describeTriggers,
  describeBudget,
  describeFrequency,
  describeCopy,
  settingsDrift,
} from "../components/admin/live-config.js";
import {
  summarizeDecision,
  describeResult,
  tallyResults,
  relativeTime,
} from "../components/admin/decision-summary.js";
import db from "../db.server.js";
import { getShopMetrics } from "../utils/shop-metrics.server.js";
import { offerCeilingPercent } from "../utils/ai-decision.server.js";

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
  // The pinned Guided offer. Safe to edit here: changing the type or amount
  // creates no Shopify-side resource, unlike the discount CODE fields, which
  // stay excluded.
  hybridOfferType: "string",
  hybridOfferAmount: "float",
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

// Fields the DECISION ENGINE and storefront read off the exit_intent.settings
// metafield rather than the Shop row (see the destructure at the top of
// apps.exit-intent.api.ai-decision.jsx). Editing the row alone leaves the
// storefront on the old value, so each of these has to be written to both.
// Anything not listed here is served from the DB by
// apps.exit-intent.api.shop-settings.jsx and needs no metafield write.
const METAFIELD_FIELDS = new Set([
  "mode",
  "aiGoal",
  "aggression",
  "budgetEnabled",
  "budgetAmount",
  "budgetPeriod",
  "hybridOfferType",
  "hybridOfferAmount",
  "exitIntentEnabled",
  "timeDelayEnabled",
  "timeDelaySeconds",
  "cartValueEnabled",
  "cartValueMin",
  "cartValueMax",
  "modalHeadline",
  "modalBody",
  "ctaButton",
  "redirectDestination",
]);

// The metafield stores the triggers twice — flat, and again under `triggers`
// with different key names. The merchant app writes both; so must we, or the
// storefront reads one shape while the engine reads the other.
const TRIGGER_MIRROR = {
  exitIntentEnabled: "exitIntent",
  timeDelayEnabled: "timeDelay",
  timeDelaySeconds: "timeDelaySeconds",
  cartValueEnabled: "cartValue",
  cartValueMin: "minCartValue",
  cartValueMax: "maxCartValue",
};

// Merge the console's edits into the live settings metafield and write it back.
// Read-modify-write, because the metafield holds much more than this form edits
// (brand, discount codes, templates, frequency) and none of it may be lost.
//
// `desired` is the whole submitted form, not a diff against the Shop row: the
// row and the metafield can already disagree (that is exactly the bug this
// fixes), so the delta that matters is against the metafield itself. A save
// therefore also heals drift left by earlier row-only edits.
async function writeSettingsMetafield(shopifyDomain, desired) {
  const candidates = Object.keys(desired).filter((field) => METAFIELD_FIELDS.has(field));
  if (candidates.length === 0) return { ok: true, fields: [] };

  try {
    const { unauthenticated } = await import("../shopify.server.js");
    const { admin } = await unauthenticated.admin(shopifyDomain);

    const readResponse = await admin.graphql(`
      query {
        shop {
          id
          metafield(namespace: "exit_intent", key: "settings") { value }
        }
      }
    `);
    const shopData = (await readResponse.json()).data?.shop;
    const ownerId = shopData?.id;
    const raw = shopData?.metafield?.value;
    if (!ownerId) return { ok: false, error: "Could not read the shop id from Shopify." };
    if (!raw) {
      return {
        ok: false,
        error:
          "This store has no settings metafield yet — the merchant has to save once in the app before the console can edit it.",
      };
    }

    const settings = JSON.parse(raw);
    const fields = candidates.filter((field) => settings[field] !== desired[field]);
    if (fields.length === 0) return { ok: true, fields: [] };

    for (const field of fields) {
      settings[field] = desired[field];
      const mirrored = TRIGGER_MIRROR[field];
      if (mirrored) {
        settings.triggers = { ...(settings.triggers || {}), [mirrored]: desired[field] };
      }
    }

    const writeResponse = await admin.graphql(
      `mutation SetSettings($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId
          namespace: "exit_intent"
          key: "settings"
          value: $value
          type: "json"
        }]) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      { variables: { ownerId, value: JSON.stringify(settings) } }
    );
    const errors = (await writeResponse.json()).data?.metafieldsSet?.userErrors || [];
    if (errors.length > 0) {
      return { ok: false, error: errors.map((error) => error.message).join("; ") };
    }
    return { ok: true, fields };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
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
          settingsMetafield: metafield(namespace: "exit_intent", key: "settings") { value }
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
      // The settings metafield is what the storefront and the decision engine
      // actually read (see apps.exit-intent.api.ai-decision.jsx, which pulls
      // mode/aggression/budget/hybrid straight off it). The DB row is a mirror
      // the merchant app keeps in sync — authoritative only until someone
      // edits the row without the metafield. Show the metafield.
      settings: data?.shop?.settingsMetafield?.value
        ? JSON.parse(data.shop.settingsMetafield.value)
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

  const [live, perf, variants, recentDecisions, auditEntries] = await Promise.all([
    fetchLiveShopify(shop.shopifyDomain),
    // Same module the merchant dashboard reads, so a number quoted here is the
    // number the customer sees. Never re-derive metrics in this route.
    getShopMetrics({ shopId: shop.id, days, mode: shop.mode }),
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
    db.aIDecision.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, decision: true, signals: true, createdAt: true },
    }),
    db.adminAuditLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // What each decision actually came to. InterventionOutcome is the only
  // record that links a decision to an impression and an order; a decision
  // with no outcome row never entered the tracked path at all (budget block,
  // promo pause, cart/idle pre-decision, or test traffic).
  const outcomeRows = recentDecisions.length
    ? await db.interventionOutcome.findMany({
        where: { aiDecisionId: { in: recentDecisions.map((decision) => decision.id) } },
        select: {
          aiDecisionId: true,
          wasShown: true,
          rendered: true,
          converted: true,
          revenue: true,
          profit: true,
          impressionId: true,
        },
      })
    : [];

  // Trigger performance. The learning loop scores a variant on
  // conversions/renderedImpressions, so a trigger that is chosen constantly but
  // rarely fires costs it nothing — its misses are simply absent from the
  // denominator. Nothing in the engine reports that, so report it here: per
  // trigger gene, how often a decision led to a render at all.
  const shopVariants = await db.variant.findMany({
    where: { shopId: shop.id },
    select: { id: true, triggerType: true },
  });
  const triggerByVariant = new Map(shopVariants.map((v) => [v.id, v.triggerType]));
  const variantIds = shopVariants.map((v) => v.id);

  const countBy = async (where) =>
    variantIds.length
      ? db.variantImpression.groupBy({
          by: ["variantId"],
          where: { variantId: { in: variantIds }, ...where },
          _count: { id: true },
        })
      : [];
  const [decidedRows, renderedRows, convertedRows] = await Promise.all([
    countBy({}),
    countBy({ rendered: true }),
    countBy({ converted: true }),
  ]);

  const triggerPerformance = {};
  const fold = (rows, key) => {
    for (const row of rows) {
      const trigger = triggerByVariant.get(row.variantId) || "unknown";
      triggerPerformance[trigger] = triggerPerformance[trigger] || {
        trigger,
        decided: 0,
        rendered: 0,
        converted: 0,
      };
      triggerPerformance[trigger][key] += row._count.id;
    }
  };
  fold(decidedRows, "decided");
  fold(renderedRows, "rendered");
  fold(convertedRows, "converted");

  // The click lives on the impression, not the outcome.
  const impressionIds = [...new Set(outcomeRows.map((row) => row.impressionId).filter(Boolean))];
  const impressions = impressionIds.length
    ? await db.variantImpression.findMany({
        where: { id: { in: impressionIds } },
        select: { id: true, clicked: true },
      })
    : [];
  const clickedById = new Map(impressions.map((impression) => [impression.id, impression.clicked]));

  // One decision can own more than one outcome row — a holdout that converts
  // gets a second row from the order webhook — so collapse to the furthest
  // the visitor got.
  const resultByDecision = new Map();
  for (const row of outcomeRows) {
    const prev = resultByDecision.get(row.aiDecisionId);
    resultByDecision.set(row.aiDecisionId, {
      wasShown: (prev?.wasShown ?? false) || row.wasShown,
      rendered: (prev?.rendered ?? false) || row.rendered,
      // No impression row means no click to read (pill openers mint none), so
      // "not clicked" and "unknown" have to stay distinguishable.
      hasImpression: (prev?.hasImpression ?? false) || clickedById.has(row.impressionId),
      clicked: (prev?.clicked ?? false) || clickedById.get(row.impressionId) === true,
      converted: (prev?.converted ?? false) || row.converted,
      revenue: (prev?.revenue ?? 0) + (row.revenue || 0),
      profit: (prev?.profit ?? 0) + (row.profit || 0),
    });
  }

  // AI mode has no single discount — the engine recomputes it per visitor.
  // Walk the propensity axis with the store's own aggression and margin so the
  // console can quote the real ceiling instead of "it depends".
  const liveSettings = live.ok ? live.settings : null;
  let aiRange = null;
  if (liveSettings?.mode === "ai") {
    const args = {
      aggression: liveSettings.aggression ?? 5,
      assumedGrossMargin: liveSettings.assumedGrossMargin ?? 0.4,
    };
    let max = 0;
    let announceAbove = null;
    for (let p = 0; p <= 100; p += 1) {
      const percent = offerCeilingPercent({ ...args, propensity: p });
      if (percent > max) max = percent;
      if (percent === 0 && announceAbove === null && max > 0) announceAbove = p;
    }
    aiRange = { max, announceAbove };
  }

  return {
    shop,
    live,
    liveSettings,
    aiRange,
    days,
    perf,
    variants,
    triggerPerformance: Object.values(triggerPerformance).sort((a, b) => b.decided - a.decided),
    recentDecisions: recentDecisions.map((decision) => ({
      ...decision,
      result: resultByDecision.get(decision.id) || null,
    })),
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

  // The metafield is the storefront's source of truth for the fields in
  // METAFIELD_FIELDS, so it is synced even when the row already matched —
  // that is how a row-only edit from before this existed gets healed.
  const metafield = await writeSettingsMetafield(shop.shopifyDomain, update);

  if (Object.keys(changed).length === 0 && metafield.ok && metafield.fields.length === 0) {
    return { success: true, message: "No changes." };
  }

  // If the storefront could not be updated, do not update the row either.
  // A one-sided write is what produced the drift this whole path exists to
  // remove, and a failed save the admin can retry beats a silent divergence.
  if (!metafield.ok) {
    await logAdminAction(request, "settings_update_failed", {
      shopId: shop.id,
      payload: { shopifyDomain: shop.shopifyDomain, attempted: changed, error: metafield.error },
    });
    return {
      success: false,
      message: `Nothing was saved. The live storefront could not be updated, so our records were left alone to avoid drift: ${metafield.error}`,
    };
  }

  if (Object.keys(changed).length > 0) {
    await db.shop.update({ where: { id: shop.id }, data: update });
  }
  await logAdminAction(request, "settings_update", {
    shopId: shop.id,
    payload: {
      shopifyDomain: shop.shopifyDomain,
      changed,
      liveSettingsUpdated: metafield.fields,
    },
  });

  // The two counts are independent: a field can already match our row while
  // still being stale on the storefront (that is drift being healed), and
  // DB-only fields never reach the metafield at all.
  const parts = [];
  if (Object.keys(changed).length > 0) {
    parts.push(`Updated ${Object.keys(changed).length} field(s) in our records.`);
  }
  parts.push(
    metafield.fields.length
      ? `Pushed ${metafield.fields.length} field(s) live to the storefront: ${metafield.fields.join(", ")}.`
      : "The storefront was already up to date."
  );
  return { success: true, message: parts.join(" ") };
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

function Fact({ label, children }) {
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">
        {label}
      </Text>
      {children}
    </BlockStack>
  );
}

// What the store is running right now, straight off the settings metafield.
// This is deliberately the first thing on the page: every other number here
// only means something once you know which mode produced it.
function LiveConfig({ settings, aiRange, shop, live }) {
  if (!live.ok) {
    return (
      <Banner tone="critical" title="Could not read the live settings">
        <Text as="p" variant="bodySm">
          {live.error || "Shopify did not answer."} Everything below comes from our
          database copy, which may not be what the storefront is serving.
        </Text>
      </Banner>
    );
  }
  if (!settings) {
    return (
      <Banner tone="warning" title="No settings metafield on this store">
        <Text as="p" variant="bodySm">
          The storefront reads exit_intent.settings and it is missing or empty, so the
          modal is not running. The merchant has to save settings once in the app.
        </Text>
      </Banner>
    );
  }

  const mode = describeMode(settings.mode);
  const offer = describeOffer(settings, aiRange);
  const copy = describeCopy(settings);
  const shows = describeTriggers(settings);
  const drift = settingsDrift(settings, shop);

  return (
    <BlockStack gap="300">
      <Card>
        <BlockStack gap="400">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={mode.tone} size="large">
              {mode.label}
            </Badge>
            <Text as="span" tone="subdued" variant="bodySm">
              {mode.blurb}
            </Text>
          </InlineStack>

          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Fact label="Offer on the live modal">
              <Text as="p" variant="headingSm">
                {offer.headline}
              </Text>
              {offer.lines.map((line) => (
                <Text key={line} as="p" tone="subdued" variant="bodySm">
                  {line}
                </Text>
              ))}
            </Fact>
            <Fact label="Shows">
              <Text as="p" variant="headingSm">
                {shows.headline}
              </Text>
              {shows.lines.map((line) => (
                <Text key={line} as="p" tone="subdued" variant="bodySm">
                  {line}
                </Text>
              ))}
              {describeFrequency(settings) && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {describeFrequency(settings)}
                </Text>
              )}
            </Fact>
            <Fact label="Budget">
              <Text as="p" variant="headingSm">
                {describeBudget(settings)}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Spend counts codes issued, not codes redeemed.
              </Text>
            </Fact>
          </InlineGrid>

          <Divider />

          <Fact label={copy.label}>
            <Text as="p" variant="bodyMd">
              {copy.headline}
            </Text>
            {copy.lines.map((line) => (
              <Text key={line} as="p" tone="subdued" variant="bodySm">
                {line}
              </Text>
            ))}
          </Fact>
        </BlockStack>
      </Card>

      {drift.length > 0 && (
        <Banner tone="warning" title="The live settings and our copy disagree">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm">
              The storefront is using the live column. Our row was edited without the
              metafield — most likely from the Settings tab below, which writes the row
              only.
            </Text>
            {drift.map((field) => (
              <Text key={field.label} as="p" variant="bodySm">
                {field.label}: live <b>{field.live}</b>, our copy <b>{field.stored}</b>
              </Text>
            ))}
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}

// Does the trigger the AI keeps picking actually fire?
//
// Selection and evolution both score a variant on conversions per RENDERED
// impression (betaSample takes alpha=conversions, beta=impressions-conversions,
// and Variant.impressions only moves in confirmImpressionRender). A trigger
// that is chosen constantly but seldom fires is therefore not penalised — the
// sessions it missed never enter the denominator. This table is the only place
// that gap is visible, so it states it rather than leaving it to be inferred.
function TriggerPerformance({ rows }) {
  if (rows.length === 0) return null;
  const worst = rows.reduce((a, b) =>
    (a.decided ? a.rendered / a.decided : 1) < (b.decided ? b.rendered / b.decided : 1) ? a : b
  );
  const worstRate = worst.decided ? worst.rendered / worst.decided : 1;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Does each trigger actually fire?
        </Text>
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
          headings={["Trigger", "Chosen", "Actually shown", "Show rate", "Converted"]}
          rows={rows.map((row) => [
            row.trigger.replace(/_/g, " "),
            row.decided,
            row.rendered,
            row.decided ? `${Math.round((row.rendered / row.decided) * 100)}%` : "—",
            row.converted,
          ])}
        />
        <Text as="p" tone="subdued" variant="bodySm">
          The AI learns from conversions per modal <b>shown</b>, not per decision made.
          A trigger it picks constantly but that rarely fires costs it nothing in the
          scoring, so it will keep picking it. Show rate is the only signal that
          catches this, and nothing acts on it automatically yet.
        </Text>
        {worstRate < 0.5 && (
          <Banner tone="warning">
            {worst.trigger.replace(/_/g, " ")} fires on{" "}
            {Math.round(worstRate * 100)}% of the decisions that choose it. Those
            missed sessions are invisible to the learning loop.
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

// Recent AI decisions, written for a person. The raw JSON is one click away
// because that is what you paste into a query when something looks wrong.
function DecisionLog({ decisions, mode }) {
  const [showRaw, setShowRaw] = useState(false);
  const [showUntracked, setShowUntracked] = useState(true);
  const all = decisions.map((decision) => {
    const row = summarizeDecision(decision);
    return { ...row, status: describeResult(row.result, row.source) };
  });
  const rows = showUntracked ? all : all.filter((row) => row.result);
  const tally = tallyResults(all);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            Recent AI decisions
          </Text>
          <InlineStack gap="300">
            <Button variant="plain" onClick={() => setShowUntracked((value) => !value)}>
              {showUntracked ? "Hide untracked" : "Show all"}
            </Button>
            <Button variant="plain" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? "Hide raw JSON" : "Show raw JSON"}
            </Button>
          </InlineStack>
        </InlineStack>

        <Text as="p" tone="subdued" variant="bodySm">
          Last {tally.total} decisions · {tally.rendered} actually shown ·{" "}
          {tally.converted} converted · {tally.preDecisions} pre-decisions that never
          surfaced · {tally.untracked} untracked
        </Text>

        {!makesAIDecisions(mode) && (
          <Banner tone="info">
            This store is on {describeMode(mode).label}, so the AI makes no decisions.
            Anything listed below predates the mode change.
          </Banner>
        )}

        {rows.length === 0 && (
          <Text as="p" tone="subdued" variant="bodySm">
            No decisions recorded yet.
          </Text>
        )}

        {rows.map((row, index) => (
          <BlockStack key={row.id} gap="150">
            {index > 0 && <Divider />}
            <InlineStack gap="200" blockAlign="center" wrap>
              <Badge tone={row.outcome.tone}>{row.outcome.label}</Badge>
              {/* The offer alone doesn't say what the decision was: 17% off on
                  exit intent and 17% off after 30s idle are different calls the
                  AI made, so the trigger sits with the amount, not below it. */}
              {row.trigger && (
                <Text as="span" variant="bodyMd">
                  {row.trigger}
                </Text>
              )}
              <Badge tone={row.status.tone}>{row.status.label}</Badge>
              <Text as="span" tone="subdued" variant="bodySm">
                {relativeTime(row.createdAt)} · {new Date(row.createdAt).toLocaleString()}
              </Text>
            </InlineStack>
            <Text as="p" variant="bodyMd">
              {row.why}
            </Text>
            {row.status.detail && (
              <Text as="p" tone="subdued" variant="bodySm">
                {row.status.detail}
              </Text>
            )}
            {row.shown && (
              <Text as="p" tone="subdued" variant="bodySm">
                Visitor saw: {row.shown}
              </Text>
            )}
            {row.context.length > 0 && (
              <Text as="p" tone="subdued" variant="bodySm">
                {row.context.join(" · ")}
              </Text>
            )}
            {showRaw && (
              <Text as="p" tone="subdued" variant="bodySm" breakWord>
                <code>{row.raw}</code>
              </Text>
            )}
          </BlockStack>
        ))}
      </BlockStack>
    </Card>
  );
}

export default function AdminShopDetail() {
  const {
    shop, live, liveSettings, aiRange, days, perf, variants,
    triggerPerformance, recentDecisions, auditEntries,
  } = useLoaderData();
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

  // Seed from the live metafield wherever it owns the field, so the form opens
  // showing what the merchant last saved and what the storefront is serving —
  // not our mirror of it, which is what made this form misleading.
  const [form, setForm] = useState(() => {
    const initial = {};
    for (const field of Object.keys(EDITABLE_FIELDS)) {
      initial[field] = liveSettings && liveSettings[field] !== undefined
        ? liveSettings[field]
        : shop[field];
    }
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
        <LiveConfig settings={liveSettings} aiRange={aiRange} shop={shop} live={live} />
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
            <InlineStack gap="200" blockAlign="center">
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
              <InfoPopover info={METRIC_INFO.shopPerformance} />
            </InlineStack>
            <Card>
              {/* Funnel order, widest first: decisions is the top of it. If
                  decisions stop, nothing downstream can move, so it's the first
                  thing to read when a store looks dead. */}
              <InlineGrid columns={6} gap="400">
                <StatCell label="AI decisions" value={perf.decisions.toLocaleString()} />
                <StatCell label="Impressions" value={perf.impressions.toLocaleString()} />
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
                <StatCell label="AI: skipped" value={perf.skipped.toLocaleString()} />
                <StatCell label="Show rate" value={`${perf.showRate.toFixed(0)}%`} />
                <StatCell label="Conv. rate" value={`${perf.conversionRate.toFixed(1)}%`} />
                <StatCell
                  label="Discount given"
                  value={`$${perf.discountGiven.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
              </InlineGrid>
            </Card>
            {/* Incrementality is kept off the headline row on purpose: it answers
                "did we cause this", not "what happened", and it stays hidden until
                the control group is large enough for the number to mean anything. */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Incrementality (holdout)
                </Text>
                {perf.holdout ? (
                  <>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Everyone the holdout coin sent to treatment ({perf.holdout.treatmentTotal})
                      against the control ({perf.holdout.holdoutTotal}) — including the
                      visitors Resparq chose to stay quiet for and the ones whose trigger
                      never fired. Deciding not to reach someone is a result, not an excuse.
                    </Text>
                    <InlineGrid columns={4} gap="400">
                      <StatCell label="Treated CVR" value={`${perf.holdout.treatmentCVR.toFixed(2)}%`} />
                      <StatCell label="Holdout CVR" value={`${perf.holdout.holdoutCVR.toFixed(2)}%`} />
                      <StatCell label="Lift" value={`${perf.holdout.liftPct.toFixed(1)}%`} />
                      <StatCell
                        label="Incremental revenue"
                        value={`$${perf.holdout.incrementalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      />
                    </InlineGrid>
                    {perf.holdout.liftPct < 0 && perf.holdout.hasEnoughData && (
                      <Banner tone="critical">
                        Treatment is converting BELOW control. Resparq is costing this
                        store orders, not winning them.
                      </Banner>
                    )}
                    {!perf.holdout.hasEnoughData && (
                      <Text as="p" tone="subdued" variant="bodySm">
                        Directional only — {perf.holdout.holdoutTotal} holdout sessions.
                        Don't quote this to the merchant yet.
                      </Text>
                    )}
                    {perf.holdout.perProtocol && (
                      <>
                        <Divider />
                        <Text as="p" tone="subdued" variant="bodySm">
                          Diagnostics, not evidence. A surface reached{" "}
                          <b>{perf.holdout.perProtocol.reachPct.toFixed(0)}%</b> of the
                          treatment group ({perf.holdout.perProtocol.shownTotal} of{" "}
                          {perf.holdout.treatmentTotal}), and those sessions converted at{" "}
                          <b>{perf.holdout.perProtocol.shownCVR.toFixed(2)}%</b>. That
                          second number is selected on something that happened after the
                          coin flip, so it is not lift — a high figure next to flat lift
                          means the modal works but is not reaching anyone.
                        </Text>
                      </>
                    )}
                  </>
                ) : (
                  <Text as="p" tone="subdued" variant="bodySm">
                    Not enough holdout data yet. Needs at least 10 control sessions
                    in this window before a lift figure means anything.
                  </Text>
                )}
              </BlockStack>
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
            <TriggerPerformance rows={triggerPerformance} />
            <DecisionLog decisions={recentDecisions} mode={liveSettings?.mode ?? shop.mode} />
          </BlockStack>
        )}

        {tabs[selectedTab].id === "settings" && (
          <Form method="post">
            <BlockStack gap="400">
              <Banner tone="warning">
                This is what the merchant last saved, read from the live settings
                metafield. Editing here writes both that metafield and our records, so
                changes take effect on the storefront immediately and are audit-logged.
                Plan, discount-code, and branding changes are excluded — those create
                Shopify-side resources and must go through the merchant app.
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
                      // Hybrid is a real stored mode (see admin-metrics
                      // isAIMode). Leaving it out made a hybrid shop render as
                      // "AI" and silently downgrade the moment anyone touched
                      // the dropdown.
                      options={[
                        { label: "Manual", value: "manual" },
                        { label: "AI", value: "ai" },
                        { label: "Hybrid", value: "hybrid" },
                      ]}
                      value={form.mode}
                      onChange={set("mode")}
                    />
                    <Select
                      label="AI goal"
                      name="aiGoal"
                      // "auto" is what the merchant app actually writes (it
                      // picks revenue vs conversion per visitor from funnel
                      // stage), so it has to be selectable or this dropdown
                      // misreports every AI store the same way Mode did.
                      options={[
                        { label: "Auto (per visitor)", value: "auto" },
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
                      helpText={
                        form.mode === "hybrid"
                          ? "Ignored in Guided mode — the pinned offer below wins."
                          : "Drives the discount ceiling together with the store's assumed margin."
                      }
                    />
                  </InlineGrid>
                  {form.mode === "hybrid" && (
                    <InlineGrid columns={3} gap="400">
                      <Select
                        label="Pinned offer type"
                        name="hybridOfferType"
                        options={[
                          { label: "Percentage", value: "percentage" },
                          { label: "Fixed amount", value: "fixed" },
                        ]}
                        value={form.hybridOfferType}
                        onChange={set("hybridOfferType")}
                      />
                      <TextField
                        label="Pinned offer amount"
                        name="hybridOfferAmount"
                        type="number"
                        value={String(form.hybridOfferAmount)}
                        onChange={setNum("hybridOfferAmount")}
                        autoComplete="off"
                        prefix={form.hybridOfferType === "fixed" ? "$" : null}
                        suffix={form.hybridOfferType === "fixed" ? null : "%"}
                        helpText="Honored exactly — no margin guard, no propensity taper."
                      />
                    </InlineGrid>
                  )}
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
