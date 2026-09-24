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
  ButtonGroup,
  DataTable,
  Divider,
  IndexTable,
  Box,
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
import { fmtDate, fmtDateTime, fmtNum, fmtMoney, fmtTimeET, fmtDayET, fmtDateTimeET } from "../utils/format.js";
import {
  summarizeDecision,
  describeResult,
  resultKind,
  foldOutcomeRows,
  tallyResults,
  relativeTime,
} from "../components/admin/decision-summary.js";
import db from "../db.server.js";
import {
  VERTICALS,
  GROSS_MARGIN_BY_VERTICAL,
  DEFAULT_GROSS_MARGIN,
  grossMarginForShop
} from "../utils/store-cluster.server.js";
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
      select: { id: true, decision: true, signals: true, createdAt: true, offerId: true },
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
        // shopId is in the predicate so this can use @@index([shopId, aiDecisionId]).
        // Without it there is no usable index on aiDecisionId alone and every
        // console load full-scanned the table.
        where: {
          shopId: shop.id,
          aiDecisionId: { in: recentDecisions.map((decision) => decision.id) },
        },
        select: {
          aiDecisionId: true,
          wasShown: true,
          rendered: true,
          // Which arm the visitor was randomised into. The decision JSON only
          // says "holdout" when the holdout branch itself minted the row; the
          // outcome column is the one that is set on every tracked decision,
          // so it is what the console filters and colours on.
          isHoldout: true,
          missReason: true,
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

  const resultByDecision = foldOutcomeRows(outcomeRows, clickedById);

  // The promo code each decision actually minted. AIDecision.offerId is a bare
  // string column with no Prisma relation behind it, so this is a second query
  // rather than an include — batched over the 50 rows, not one per row.
  //
  // A decision with an offerId whose DiscountOffer has since been deleted
  // resolves to null and renders as "no code", which is the honest answer: the
  // console must not invent a code it cannot read back.
  const offerIds = recentDecisions.map((d) => d.offerId).filter(Boolean);
  const offers = offerIds.length
    ? await db.discountOffer.findMany({
        where: { id: { in: offerIds } },
        select: { id: true, discountCode: true, amount: true, offerType: true, redeemed: true },
      })
    : [];
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));

  // AI mode has no single discount — the engine recomputes it per visitor.
  // Walk the propensity axis with the store's own aggression and margin so the
  // console can quote the real ceiling instead of "it depends".
  const liveSettings = live.ok ? live.settings : null;
  let aiRange = null;
  if (liveSettings?.mode === "ai") {
    const args = {
      aggression: liveSettings.aggression ?? 5,
      // The engine infers this from the shop's vertical (no merchant-entered
      // value exists). Quoting a flat 0.4 here made the console disagree with
      // what the storefront actually serves.
      assumedGrossMargin: grossMarginForShop(shop, liveSettings.assumedGrossMargin),
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

  // Where the engagement actually came from. "Clicks" above is one number for
  // the whole offer, and an offer now has three places to accept it: the modal
  // CTA, the persistent pill, and the cart / mini-cart line. The journey log is
  // the only record that keeps them apart, so read the accept responses out of
  // it — otherwise a merchant clicking Apply in their drawer looks identical to
  // one clicking the modal.
  const ACCEPT_RESPONSES = ["cta_click", "redeem", "apply"];
  const surfaceRows = await db.visitorTouch.groupBy({
    by: ["surface", "response"],
    where: {
      shopId: shop.id,
      timestamp: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      response: { in: ACCEPT_RESPONSES },
    },
    _count: { id: true },
  });
  const SURFACE_LABELS = {
    modal: "Modal CTA",
    pill: "Pill redeem",
    cart_banner: "Cart line apply",
  };
  const surfaceEngagement = Object.entries(SURFACE_LABELS).map(([surface, label]) => ({
    surface,
    label,
    count: surfaceRows
      .filter((row) => row.surface === surface)
      .reduce((sum, row) => sum + row._count.id, 0),
  }));

  // The vertical drives the gross margin the whole margin guard runs on, and
  // an operator override beats the cron's keyword vote. Built here rather than
  // in the component because store-cluster is a server-only module.
  //
  // Ordered by margin, not alphabetically, so the list reads as the gradient
  // it actually is. The blank option means "let the cron decide", which is
  // right for almost every store.
  const VERTICAL_OPTIONS = [
    { label: "Auto-derive (no override)", value: "" },
    ...[...VERTICALS]
      .sort((a, b) =>
        (GROSS_MARGIN_BY_VERTICAL[b] ?? DEFAULT_GROSS_MARGIN) -
        (GROSS_MARGIN_BY_VERTICAL[a] ?? DEFAULT_GROSS_MARGIN))
      .map((v) => ({
        label: `${v} — ${((GROSS_MARGIN_BY_VERTICAL[v] ?? DEFAULT_GROSS_MARGIN) * 100).toFixed(0)}% margin`,
        value: v
      }))
  ];
  const verticalHelp = [
    shop.derivedVertical ? `Auto-derived: ${shop.derivedVertical}` : "Auto-derive has not classified this store",
    `Gross margin in use: ${(grossMarginForShop(shop) * 100).toFixed(0)}%`,
    "An override here wins over auto-derive."
  ].join(" · ");

  return {
    shop,
    live,
    liveSettings,
    aiRange,
    VERTICAL_OPTIONS,
    verticalHelp,
    days,
    perf,
    surfaceEngagement,
    variants,
    triggerPerformance: Object.values(triggerPerformance).sort((a, b) => b.decided - a.decided),
    recentDecisions: recentDecisions.map((decision) => ({
      ...decision,
      result: resultByDecision.get(decision.id) || null,
      offer: decision.offerId ? offerById.get(decision.offerId) || null : null,
    })),
    auditEntries,
    // One server-side clock for every relative timestamp on this page. Computing
    // `now` during render instead would give the server and the client two
    // different values and re-break hydration the moment a "2m ago" ticks over.
    now: Date.now(),
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

// Recent AI decisions — one line per decision, everything else behind a click.
//
// This was a stack of full sentences per row: a badge, a trigger phrase, a
// status badge, a timestamp, a reason, a status detail, a copy line, and a
// dot-joined context string. Every one of those sentences was true and useful
// when you were reading ONE decision. Fifty deep it was unreadable, because
// finding the anomalous row means comparing the same field across rows, and
// prose puts that field in a different place on every line.
//
// So: fixed columns, one line tall, numbers right-aligned with tabular figures
// (a $3,000 cart among $90 carts should be visible without reading), and the
// prose kept intact in an expansion, which is where a diagnosis belongs.
const RESULT_BADGE = {
  converted: { label: "Converted", tone: "success" },
  // An order attributed to a decision whose surface never displayed. Not a
  // success for the modal — the shopper bought without it — and it must not
  // wear the same badge as one that did the work.
  bought_anyway: { label: "Bought anyway", tone: "attention" },
  shown: { label: "Shown", tone: "info" },
  not_rendered: { label: "Never fired", tone: "warning" },
  nothing_shown: { label: "Nothing shown", tone: undefined },
  pre_decision: { label: "Pre-decided", tone: undefined },
  untracked: { label: "Untracked", tone: undefined },
};

// Saved views. Each is a predicate over the summarized row, so adding one
// never means touching the table.
const DECISION_VIEWS = [
  { id: "all", label: "All", test: () => true },
  { id: "shown", label: "Shown", test: (row) => row.kind === "shown" || row.kind === "converted" },
  { id: "control", label: "Control", test: (row) => row.facts.isHoldout },
  { id: "not_rendered", label: "Never fired", test: (row) => row.kind === "not_rendered" },
  { id: "miss_known", label: "Never fired, cause known", test: (row) => row.kind === "not_rendered" && Boolean(row.facts.miss) },
  { id: "promo", label: "With promo", test: (row) => Boolean(row.facts.promoCode) },
];

function DecisionLog({ decisions, mode, now }) {
  const [view, setView] = useState("all");
  const [device, setDevice] = useState("all");
  const [expanded, setExpanded] = useState(null);

  const all = decisions.map((decision) => {
    const row = summarizeDecision(decision);
    return {
      ...row,
      status: describeResult(row.result, row.source),
      kind: resultKind(row.result, row.source),
    };
  });

  const viewTest = (DECISION_VIEWS.find((v) => v.id === view) || DECISION_VIEWS[0]).test;
  const rows = all.filter(
    (row) => viewTest(row) && (device === "all" || row.facts.device === device)
  );
  const tally = tallyResults(all);
  const controls = all.filter((row) => row.facts.isHoldout).length;

  return (
    <Card padding="0">
      <BlockStack gap="0">
        <Box padding="400" paddingBlockEnd="300">
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
              <Text as="h3" variant="headingMd">
                Recent AI decisions
              </Text>
              <Text as="span" tone="subdued" variant="bodySm">
                Last {tally.total} · {tally.rendered} shown · {tally.converted} converted ·{" "}
                {controls} control · {tally.preDecisions} pre-decided · {tally.untracked} untracked
              </Text>
            </InlineStack>

            <InlineStack gap="300" blockAlign="center" wrap>
              <ButtonGroup variant="segmented">
                {DECISION_VIEWS.map((option) => (
                  <Button
                    key={option.id}
                    size="slim"
                    pressed={view === option.id}
                    onClick={() => setView(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </ButtonGroup>
              <Box width="160px">
                <Select
                  label="Device"
                  labelHidden
                  value={device}
                  onChange={setDevice}
                  options={[
                    { label: "Any device", value: "all" },
                    { label: "Desktop", value: "desktop" },
                    { label: "Mobile", value: "mobile" },
                  ]}
                />
              </Box>
              <Text as="span" tone="subdued" variant="bodySm">
                Times are US Eastern. Click a row for the reasoning, the full copy and the raw JSON.
              </Text>
            </InlineStack>

            {!makesAIDecisions(mode) && (
              <Banner tone="info">
                This store is on {describeMode(mode).label}, so the AI makes no decisions.
                Anything listed below predates the mode change.
              </Banner>
            )}
          </BlockStack>
        </Box>

        <IndexTable
          resourceName={{ singular: "decision", plural: "decisions" }}
          itemCount={rows.length}
          selectable={false}
          headings={[
            { title: "Arm" },
            { title: "Time (ET)" },
            { title: "Result" },
            { title: "Copy shown" },
            { title: "Offer" },
            { title: "Cart", alignment: "end" },
            { title: "P", alignment: "end" },
            { title: "Visitor" },
            { title: "Origin" },
          ]}
          emptyState={
            <Box padding="500">
              <Text as="p" tone="subdued" alignment="center">
                {all.length === 0
                  ? "No decisions recorded yet."
                  : "No decisions match this filter."}
              </Text>
            </Box>
          }
        >
          {rows.map((row, index) => (
            <DecisionRows
              key={row.id}
              row={row}
              position={index}
              now={now}
              open={expanded === row.id}
              onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
            />
          ))}
        </IndexTable>
      </BlockStack>
    </Card>
  );
}

// A decision renders as one compact row plus, when opened, a full-width row
// carrying everything the columns had to drop. Both live here so the two can
// never drift out of sync about which decision they describe.
function DecisionRows({ row, position, now, open, onToggle }) {
  const facts = row.facts;
  const badge = RESULT_BADGE[row.kind] || RESULT_BADGE.untracked;

  return (
    <>
      <IndexTable.Row id={row.id} position={position} onClick={onToggle} tone={open ? "subdued" : undefined}>
        <IndexTable.Cell>
          {/* Blank for the treated arm on purpose. A column where 90% of rows
              say the same thing teaches the eye to skip it; a column that is
              empty except where it matters is read at a glance. */}
          {facts.isHoldout ? <Badge tone="attention">Control</Badge> : null}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <BlockStack gap="0">
            <Text as="span" variant="bodySm" numeric>
              {fmtTimeET(row.createdAt)}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued" numeric>
              {fmtDayET(row.createdAt)}
            </Text>
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {/* The reason sits under the badge rather than in a column of its
              own: it exists on one row in ten, and a column that is empty
              nine times out of ten costs width every row pays for. */}
          <BlockStack gap="0">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {facts.miss && (
              <Text as="span" variant="bodySm" tone="subdued">
                {facts.miss.label}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {/* The headline only, clamped. The subhead and CTA are in the
              expansion: three lines of copy per row is what made this log
              unscannable in the first place. */}
          <div style={CLAMP} title={facts.headline || ""}>
            <Text as="span" variant="bodySm" tone={facts.headline ? undefined : "subdued"}>
              {facts.headline || noCopyReason(row)}
            </Text>
          </div>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {facts.offerLabel ? (
            <BlockStack gap="0">
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {facts.offerLabel}
              </Text>
              {facts.promoCode ? (
                // Threshold codes run to 30+ characters
                // (EXITSPEND669.95-MSXLSQKQ8HRI9K). Left to wrap, one of them
                // widened the Offer column past the Copy column and pushed the
                // whole table sideways, so the code is clamped and the full
                // string lives in the title and the expansion.
                <div style={CODE_CLAMP} title={facts.promoCode}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    <code>{facts.promoCode}</code>
                  </Text>
                </div>
              ) : (
                <Text as="span" variant="bodySm" tone="subdued">
                  no code minted
                </Text>
              )}
            </BlockStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              —
            </Text>
          )}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodySm" numeric alignment="end">
            {facts.cartValue === null ? "—" : fmtMoney(facts.cartValue)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodySm" numeric alignment="end">
            {facts.propensity === null ? "—" : facts.propensity}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {/* Device, visit number and prior exposure read as one thought —
              "a repeat visitor who has already seen two of these" — so they
              share a cell rather than costing three columns. */}
          <BlockStack gap="0">
            <Text as="span" variant="bodySm">
              {facts.device || "unknown device"}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {describeVisitor(facts)}
            </Text>
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {facts.origin ? facts.origin.label : "—"}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>

      {open && (
        // The half-step position keeps this row strictly between its parent
        // and the next one. Position only drives shift-key range selection,
        // which is off here (selectable={false}), so it never has to be a
        // whole number — it just must not collide with a real row's index.
        <IndexTable.Row id={`${row.id}-detail`} position={position + 0.5} tone="subdued">
          <IndexTable.Cell colSpan={9}>
            <Box padding="300" paddingInlineStart="400">
              <BlockStack gap="200">
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
                    {row.shownReached ? "Visitor saw" : "Would have shown"}: {row.shown}
                  </Text>
                )}
                <Text as="p" tone="subdued" variant="bodySm">
                  {detailLine(row, now).join(" · ")}
                </Text>
                {facts.miss?.detail && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {facts.miss.detail}
                  </Text>
                )}
                {facts.origin?.detail && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {facts.origin.detail}
                  </Text>
                )}
                <Text as="p" tone="subdued" variant="bodySm" breakWord>
                  <code>{row.raw}</code>
                </Text>
              </BlockStack>
            </Box>
          </IndexTable.Cell>
        </IndexTable.Row>
      )}
    </>
  );
}

const CLAMP = {
  maxWidth: "320px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const CODE_CLAMP = { ...CLAMP, maxWidth: "150px" };

// Why a row has no copy. The single sentence this replaced — "nothing was
// going to be shown" — was false on the largest group in the log: a
// pre-decision from the cart webhook carries a real offer and no headline,
// because determineOffer returns no copy gene at all. The row said it would
// show nothing while its own Offer column named the discount.
function noCopyReason(row) {
  if (row.kind === "pre_decision") return "copy is chosen later, when a visitor actually arrives";
  if (row.facts.offerLabel) return "an offer with no copy — the variant carried no headline gene";
  return "nothing was going to be shown";
}

// "visit 4 · 2 shown before". A count of 0 is a real answer and must read as
// one; null means the storefront was too old to report it, which is a
// different thing and says so.
function describeVisitor(facts) {
  const visit = facts.visits === null ? null : facts.visits <= 1 ? "first visit" : `visit ${facts.visits}`;
  const seen =
    facts.showCount === null
      ? null
      : facts.showCount === 0
        ? "never shown one"
        : `${facts.showCount} shown before`;
  const parts = [visit, seen].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no visitor history";
}

// The facts that did not earn a column, for the expansion.
function detailLine(row, facts_now) {
  const facts = row.facts;
  return [
    fmtDateTimeET(row.createdAt),
    relativeTime(row.createdAt, facts_now),
    row.trigger ? `fires ${row.trigger}` : null,
    facts.subhead,
    facts.cta ? `CTA "${facts.cta}"` : null,
    facts.trafficSource ? `from ${facts.trafficSource}` : null,
    facts.confidence ? `${facts.confidence} confidence` : null,
    Number.isFinite(facts.ignoreStreak) && facts.ignoreStreak > 0
      ? `ignored ${facts.ignoreStreak} in a row`
      : null,
    facts.daysSinceLastShow === null ? null : `last shown ${facts.daysSinceLastShow}d ago`,
    facts.promoCode ? `code ${facts.promoCode}` : null,
    facts.redeemed === null ? null : facts.redeemed ? "code redeemed" : "code not redeemed",
    `decision ${row.id}`,
  ].filter(Boolean);
}


export default function AdminShopDetail() {
  const {
    shop, live, liveSettings, aiRange, days, perf, surfaceEngagement, variants,
    triggerPerformance, recentDecisions, auditEntries, now,
    VERTICAL_OPTIONS, verticalHelp,
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
      subtitle={`Installed ${fmtDate(shop.createdAt)}`}
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
                    value={fmtDate(shop.promoAppliedAt)}
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
                              fmtDate(sub.createdAt),
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
              {/* The merchant-facing analysis document, over the window
                  currently selected above. Plain link rather than a fetcher:
                  the route returns a file with Content-Disposition, and a
                  navigation is what makes the browser save it. */}
              <Button
                url={`/admin/shops/${shop.id}/report.pdf?days=${days}`}
                download
                variant="plain"
              >
                Export {days}d PDF
              </Button>
            </InlineStack>
            <Card>
              {/* Funnel order, widest first: decisions is the top of it. If
                  decisions stop, nothing downstream can move, so it's the first
                  thing to read when a store looks dead. */}
              <InlineGrid columns={6} gap="400">
                <StatCell label="AI decisions" value={fmtNum(perf.decisions)} />
                <StatCell label="Impressions" value={fmtNum(perf.impressions)} />
                <StatCell label="Clicks" value={fmtNum(perf.clicks)} />
                <StatCell label="Conversions" value={fmtNum(perf.conversions)} />
                <StatCell
                  label="Revenue"
                  value={`$${fmtNum(perf.revenue, { maximumFractionDigits: 0 })}`}
                />
                <StatCell
                  label="Profit"
                  value={`$${fmtNum(perf.profit, { maximumFractionDigits: 0 })}`}
                />
              </InlineGrid>
            </Card>
            {/* Which surface the shopper said yes on. "Clicks" above counts the
                offer once however it was accepted; this splits it, so a merchant
                asking whether anyone uses the mini-cart line has an answer. */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Where they accepted
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Accepts from the journey log over the same {days} days. One offer can
                  only be accepted once, so these sum to the offers taken, not to clicks.
                </Text>
                <InlineGrid columns={3} gap="400">
                  {surfaceEngagement.map((row) => (
                    <StatCell key={row.surface} label={row.label} value={fmtNum(row.count)} />
                  ))}
                </InlineGrid>
              </BlockStack>
            </Card>
            <Card>
              <InlineGrid columns={4} gap="400">
                <StatCell label="AI: skipped" value={fmtNum(perf.skipped)} />
                <StatCell label="Show rate" value={`${perf.showRate.toFixed(0)}%`} />
                <StatCell label="Conv. rate" value={`${perf.conversionRate.toFixed(1)}%`} />
                <StatCell
                  label="Discount given"
                  value={`$${fmtNum(perf.discountGiven, { maximumFractionDigits: 0 })}`}
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
                        value={`$${fmtNum(perf.holdout.incrementalRevenue, { maximumFractionDigits: 0 })}`}
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
                    {perf.holdout.segments.length > 0 && (
                      <>
                        <Divider />
                        <Text as="h4" variant="headingSm">
                          Where that came from
                        </Text>
                        <DataTable
                          columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                          headings={[
                            "Treatment slice",
                            "Sessions",
                            "Orders",
                            "CVR",
                            "vs control",
                          ]}
                          rows={[
                            ...perf.holdout.segments.map((slice) => [
                              slice.label,
                              slice.total,
                              slice.converted,
                              `${slice.cvr.toFixed(2)}%`,
                              `${slice.deltaPoints >= 0 ? "+" : ""}${slice.deltaPoints.toFixed(2)} pts`,
                            ]),
                            [
                              "Control (holdout)",
                              perf.holdout.holdoutTotal,
                              Math.round((perf.holdout.holdoutCVR / 100) * perf.holdout.holdoutTotal),
                              `${perf.holdout.holdoutCVR.toFixed(2)}%`,
                              "—",
                            ],
                          ]}
                        />
                        <Text as="p" tone="subdued" variant="bodySm">
                          Each slice is selected on something that happened after the coin
                          flip, so none of them is causal on its own — only the ITT lift
                          above is. They say where it came from. Below control,{" "}
                          <b>Modal shown</b> means the modal is not persuading anyone,{" "}
                          <b>AI chose silence</b> means it stayed quiet for people who
                          needed a push, and <b>Trigger never fired</b> means it wanted to
                          act and never got the chance — the case for a trigger that fires
                          more often.
                        </Text>
                        {perf.holdout.perProtocol && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            A surface reached {perf.holdout.perProtocol.reachPct.toFixed(0)}%
                            of the treatment group.
                          </Text>
                        )}
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
            <DecisionLog decisions={recentDecisions} mode={liveSettings?.mode ?? shop.mode} now={now} />
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
                    <Select
                      label="Store vertical"
                      name="storeVertical"
                      value={form.storeVertical || ""}
                      onChange={set("storeVertical")}
                      options={VERTICAL_OPTIONS}
                      helpText={verticalHelp}
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
                  fmtDateTime(entry.createdAt),
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
