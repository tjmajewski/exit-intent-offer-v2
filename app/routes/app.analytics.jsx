import { useLoaderData, Link, Form, redirect, useFetcher, useNavigate } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getDefaultModalLibrary } from "../utils/modalHash";
import { getShopPlan } from "../utils/plan.server";
import { getShopMetrics } from "../utils/shop-metrics.server.js";
import AppLayout from "../components/AppLayout";
import db from "../db.server";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const action = formData.get("action");
    console.log('Action received:', action);

    // Switch Guided (Hybrid) → full AI (Autopilot). Preserves ALL learning
    // history — no variants, stats, or thresholds are reset. Writes the settings
    // metafield first (the serving source of truth), then the DB row, so the two
    // never disagree on mode. Never attaches a savings figure (spec §5.2).
    if (action === "switchToAutopilot") {
      const shopResponse = await admin.graphql(`
        query {
          shop {
            id
            settings: metafield(namespace: "exit_intent", key: "settings") { value }
          }
        }
      `);
      const shopData = await shopResponse.json();
      const shopId = shopData.data.shop.id;
      const currentSettings = shopData.data.shop?.settings?.value
        ? JSON.parse(shopData.data.shop.settings.value)
        : null;

      if (!currentSettings || currentSettings.mode !== 'hybrid') {
        return { success: false, message: 'Guided mode is not active.' };
      }

      // Plan gate: Autopilot requires Pro or Enterprise, same as Guided.
      const canonicalPlan = await getShopPlan(session);
      if (canonicalPlan.tier === 'starter') {
        return { success: false, message: 'Autopilot requires the Pro or Enterprise plan.' };
      }

      currentSettings.mode = 'ai';

      const metafieldResult = await admin.graphql(`
        mutation SetSettings($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "settings"
            value: $value
            type: "json"
          }]) {
            userErrors { field message }
          }
        }
      `, { variables: { ownerId: shopId, value: JSON.stringify(currentSettings) } });

      const mfData = await metafieldResult.json();
      const userErrors = mfData?.data?.metafieldsSet?.userErrors || [];
      if (userErrors.length > 0) {
        console.error('[Switch to Autopilot] Metafield write failed:', userErrors);
        return { success: false, message: 'Could not switch to Autopilot. Please try again.' };
      }

      // Metafield (serving source of truth) is now on ai — align the DB row.
      await db.shop.update({
        where: { shopifyDomain: session.shop },
        data: { mode: 'ai' }
      });

      return { success: true, message: 'Switched to Autopilot. Your learning history is preserved.' };
    }

    if (action === "testConversion") {
      const revenue = parseFloat(formData.get("testRevenue") || "100");
      
      // Get shop ID
      const shopResponse = await admin.graphql(`
        query {
          shop {
            id
            analytics: metafield(namespace: "exit_intent", key: "analytics") {
              value
            }
            modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
              value
            }
          }
        }
      `);
      
      const shopData = await shopResponse.json();
      const shopId = shopData.data.shop.id;
      
      // Update analytics
      const analytics = shopData.data.shop?.analytics?.value
        ? JSON.parse(shopData.data.shop.analytics.value)
        : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0, events: [] };
      
      analytics.conversions += 1;
      analytics.revenue += revenue;
      
      if (!analytics.events) analytics.events = [];
      analytics.events.push({
        type: "conversion",
        timestamp: new Date().toISOString(),
        revenue: revenue
      });
      
      await admin.graphql(`
        mutation SetAnalytics($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "analytics"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(analytics)
        }
      });
      
      // Update modal library
      if (shopData.data.shop?.modalLibrary?.value) {
        const modalLibrary = JSON.parse(shopData.data.shop.modalLibrary.value);
        const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
        
        if (currentModal) {
          currentModal.stats.conversions = (currentModal.stats.conversions || 0) + 1;
          currentModal.stats.revenue = (currentModal.stats.revenue || 0) + revenue;
          
          await admin.graphql(`
            mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
              metafieldsSet(metafields: [{
                ownerId: $ownerId
                namespace: "exit_intent"
                key: "modal_library"
                value: $value
                type: "json"
              }]) {
                metafields { id }
              }
            }
          `, {
            variables: {
              ownerId: shopId,
              value: JSON.stringify(modalLibrary)
            }
          });
        }
      }
      
     console.log(` Test conversion added: $${revenue}`);
      return { success: true };
    }
    
    // Handle variant manual intervention actions
    const variantId = formData.get('variantId');
    
    if (action === 'updateStatus' && variantId) {
      const newStatus = formData.get('status');
      const variant = await db.variant.findUnique({
        where: { id: variantId }
      });
      
      if (!variant) {
        return { error: 'Variant not found', success: false };
      }
      
      // Handle status change
      if (newStatus === 'alive') {
        await db.variant.update({
          where: { id: variantId },
          data: { status: 'alive' }
        });
        return { success: true, message: 'Variant set to Active' };
      }

      if (newStatus === 'protected') {
        await db.variant.update({
          where: { id: variantId },
          data: { status: 'protected' }
        });
        return { success: true, message: 'Variant protected from elimination' };
      }

      if (newStatus === 'champion') {
        // Demote any existing champion in the same baseline/segment back to alive,
        // then mark the target variant as champion. Schema has no isChampion
        // field — status === 'champion' is the single source of truth.
        await db.variant.updateMany({
          where: {
            shopId: variant.shopId,
            baseline: variant.baseline,
            segment: variant.segment,
            status: 'champion'
          },
          data: { status: 'alive' }
        });

        await db.variant.update({
          where: { id: variantId },
          data: { status: 'champion' }
        });

        return { success: true, message: 'Variant set as champion' };
      }
    }
    
    if (action === 'killVariant' && variantId) {
      await db.variant.update({
        where: { id: variantId },
        data: { 
          status: 'killed'
        }
      });
      
      // Redirect to reload the page and show updated status
      return redirect('/app/analytics?tab=variants');
    }
    
    // Generate test events with timestamps
    if (action === "generateTestEvents") {
      const shopResponse = await admin.graphql(`
        query {
          shop {
            id
            modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
              value
            }
          }
        }
      `);
      
      const shopData = await shopResponse.json();
      const shopId = shopData.data.shop.id;
      const modalLibrary = shopData.data.shop?.modalLibrary?.value
        ? JSON.parse(shopData.data.shop.modalLibrary.value)
        : null;
      
      if (!modalLibrary || !modalLibrary.modals) {
        return { error: 'No modals found' };
      }
      
      // Generate events for each modal spread across last 60 days
      modalLibrary.modals.forEach(modal => {
        modal.stats.events = [];
        const now = Date.now();
        
        // Generate random events over 60 days
        for (let i = 0; i < 50; i++) {
          const daysAgo = Math.floor(Math.random() * 60);
          const timestamp = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();
          
          // Add impression
          modal.stats.events.push({ type: 'impression', timestamp });
          
          // 30% chance of click
          if (Math.random() < 0.3) {
            modal.stats.events.push({ type: 'click', timestamp });
            
            // 20% chance of conversion after click
            if (Math.random() < 0.2) {
              modal.stats.events.push({ 
                type: 'conversion', 
                timestamp,
                revenue: Math.floor(Math.random() * 100) + 20
              });
            }
          }
        }
        
        // Update cumulative stats
        modal.stats.impressions = modal.stats.events.filter(e => e.type === 'impression').length;
        modal.stats.clicks = modal.stats.events.filter(e => e.type === 'click').length;
        modal.stats.conversions = modal.stats.events.filter(e => e.type === 'conversion').length;
        modal.stats.revenue = modal.stats.events
          .filter(e => e.type === 'conversion')
          .reduce((sum, e) => sum + (e.revenue || 0), 0);
      });
      
      // Save updated modal library
      await admin.graphql(`
        mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "modal_library"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(modalLibrary)
        }
      });
      
      console.log(' Generated test events for all modals');
      return redirect('/app/analytics');
    }
    
    return { success: false };
  } catch (error) {
    console.error("Error in action:", error);
    return { success: false };
  }
}
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    // Get date range from URL params
    const url = new URL(request.url);
    const dateRange = url.searchParams.get('range') || '30d';
    
    const response = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
          settings: metafield(namespace: "exit_intent", key: "settings") {
            value
          }
        }
      }
    `);

    const data = await response.json();

    // Current optimization mode drives the Guided → Autopilot upsell CTA.
    const settingsMetafield = data.data.shop?.settings?.value
      ? JSON.parse(data.data.shop.settings.value)
      : null;
    const mode = settingsMetafield?.mode || 'manual';

    // DB is the single source of truth for plan tier (see utils/plan.server.js).
    const canonicalPlan = await getShopPlan(session);
    const metafieldPlan = data.data.shop?.plan?.value
      ? JSON.parse(data.data.shop.plan.value)
      : {};
    const plan = { ...metafieldPlan, tier: canonicalPlan.tier };

    const modalLibrary = data.data.shop?.modalLibrary?.value
      ? JSON.parse(data.data.shop.modalLibrary.value)
      : getDefaultModalLibrary();

    // Filter modal stats by date range
    console.log(' Filtering modals by date range:', dateRange);
    console.log(' Total modals:', modalLibrary.modals?.length);
    
    if (modalLibrary.modals && dateRange !== 'all') {
      const now = new Date();
      let startDate;
      
      if (dateRange === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      
      modalLibrary.modals = modalLibrary.modals.map(modal => {
        console.log(` Modal "${modal.modalName}" has ${modal.stats.events?.length || 0} events`);
        
        if (!modal.stats.events || modal.stats.events.length === 0) {
          console.log(` Modal "${modal.modalName}" has no events, showing zeros`);
          // No events yet, return modal with zero stats
          return {
            ...modal,
            stats: {
              ...modal.stats,
              impressions: 0,
              clicks: 0,
              conversions: 0,
              revenue: 0
            }
          };
        }
        
        // Filter events by date range
        const filteredEvents = modal.stats.events.filter(e => 
          new Date(e.timestamp) >= startDate
        );
        
        // Recalculate stats from filtered events
        const stats = {
          impressions: filteredEvents.filter(e => e.type === 'impression').length,
          clicks: filteredEvents.filter(e => e.type === 'click').length,
          conversions: filteredEvents.filter(e => e.type === 'conversion').length,
          revenue: filteredEvents
            .filter(e => e.type === 'conversion')
            .reduce((sum, e) => sum + (e.revenue || 0), 0),
          events: modal.stats.events // Keep all events for future filtering
        };
        
        return { ...modal, stats };
      });
    }

    // Fetch live AI variants for Enterprise users
    let liveVariants = [];
    console.log('Plan tier:', plan.tier);
    if (plan.tier === 'enterprise') {
      try {
        const lookupDomain = session.shop;
        console.log('Looking up shop by domain:', lookupDomain);
        const shopRecord = await db.shop.findUnique({
          where: { shopifyDomain: lookupDomain }
        });
        console.log('Shop record found:', !!shopRecord, 'Shop ID:', shopRecord?.id);
        
        if (shopRecord) {
          // Get all live variants across all baselines
          const { getLiveVariants } = await import('../utils/variant-engine.js');
          const baselines = ['revenue_with_discount', 'revenue_no_discount', 'conversion_with_discount', 'conversion_no_discount'];
          
          // Get all variants (alive, champion, protected, AND killed)
          const allVariants = await db.variant.findMany({
            where: {
              shopId: shopRecord.id,
              status: { in: ['alive', 'champion', 'protected', 'killed', 'dead'] }
            },
            orderBy: { profitPerImpression: 'desc' }
          });
          
          liveVariants.push(...allVariants);
        }
      } catch (error) {
        console.error("Error loading variants:", error);
      }
    }

    // §2.5 metrics contract: M1 recovered revenue, M2 discount cost,
    // M3 verified lift, M4 show rate. Read from AttributedOrder, which only
    // starts filling on orders placed after this shipped — `metrics.m1.orderCount`
    // is how the UI knows whether to trust it yet.
    let metrics = null;
    try {
      const shopRow = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true }
      });
      if (shopRow) {
        const { getMetricsContract } = await import('../utils/metrics-contract.server.js');
        // Same window as every other number on this page. Without it the
        // headline read lifetime while impressions/CVR read 30 days, and the
        // date toggle moved everything except the one figure a merchant
        // actually looks at.
        //
        // M1 windows on the ORDER date; M3/M4 window on the DECISION date.
        // Different cohorts on purpose — "revenue in the last 30 days" is an
        // order-date question and "did it work" is a decision-date one.
        const metricsDays = dateRange === 'all' ? null : (dateRange === '7d' ? 7 : 30);
        metrics = await getMetricsContract(db, shopRow.id, {
          since: metricsDays ? new Date(Date.now() - metricsDays * 24 * 60 * 60 * 1000) : null
        });
      }
    } catch (error) {
      console.error("Error loading metrics contract:", error);
    }

    // Headline totals come from Prisma via getShopMetrics, NOT from summing the
    // per-modal event arrays in the modal_library metafield.
    //
    // Those arrays are a read-modify-write on one shared blob (concurrent
    // events silently drop increments), are pruned to 90 days / 10k events, and
    // freeze once the metafield exceeds Shopify's size limit. Summing them gave
    // this page a fourth, private definition of "impressions" — so a figure
    // quoted to a merchant from the admin console disagreed with the page the
    // merchant was looking at while we said it. Same module as the merchant
    // dashboard and the super-admin console now, so all three reconcile.
    let totals = null;
    try {
      const shopRow = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true, mode: true }
      });
      if (shopRow) {
        const days = dateRange === '7d' ? 7 : dateRange === 'all' ? null : 30;
        totals = await getShopMetrics({
          shopId: shopRow.id,
          days,
          mode: mode || shopRow.mode || 'manual'
        });
      }
    } catch (error) {
      console.error("Error loading canonical totals:", error);
    }

    console.log('Loader returning variants:', liveVariants?.length || 0);
    return { plan, modalLibrary, dateRange, liveVariants, metrics, mode, totals };
  } catch (error) {
    console.error("Error loading analytics:", error);
    return {
      plan: { tier: "starter" },
      modalLibrary: getDefaultModalLibrary(),
      liveVariants: [],
      mode: 'manual',
      totals: null
    };
  }
}


export default function Performance() {
  const { plan, modalLibrary, dateRange: loaderDateRange, liveVariants, metrics, mode, totals } = useLoaderData();
  const fetcher = useFetcher();
  const autopilotFetcher = useFetcher();
  const navigate = useNavigate();
  const canAccessPerformance = plan && (plan.tier === 'pro' || plan.tier === 'enterprise');
  const canAccessAIVariants = plan && plan.tier === 'enterprise';
  
  const [activeTab, setActiveTab] = useState('modals');
  const [dateRange, setDateRange] = useState(loaderDateRange || '30d');
  const [modalsPage, setModalsPage] = useState(1);
  const [variantsPage, setVariantsPage] = useState(1);
  
  const ITEMS_PER_PAGE = 15;
  
  const handleDateRangeChange = (range) => {
    setDateRange(range);
    // Update URL to trigger loader refresh
    navigate(`/app/analytics?range=${range}`);
  };

  // Starter users see locked page
  if (!canAccessPerformance) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, marginBottom: 16 }}>Performance</h1>
        
        <div style={{
          background: "white",
          padding: 48,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          textAlign: "center"
        }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Pro Feature</h2>
          <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Compare performance across all your modal campaigns, track trends over time, 
            and make data-driven decisions about your exit intent strategy.
          </p>
          
          {/* Blurred preview */}
          <div style={{ filter: "blur(8px)", opacity: 0.5, marginBottom: 32 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ padding: 16, textAlign: "left" }}>Modal Name</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Impressions</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Clicks</th>
                  <th style={{ padding: 16, textAlign: "right" }}>CVR</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 16 }}>Holiday Special 15%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>12,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4,231</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4.2%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$8,420</td>
                </tr>
                <tr>
                  <td style={{ padding: 16 }}>Welcome 10% Off</td>
                  <td style={{ padding: 16, textAlign: "right" }}>8,234</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2.8%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$4,210</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Link
            to="/app/upgrade"
            style={{
              display: "inline-block",
              padding: "12px 32px",
              background: "#8B5CF6",
              color: "white",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 16
            }}
          >
            Upgrade to Pro
          </Link>
        </div>

        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Link
            to="/app"
            style={{
              color: "#8B5CF6",
              textDecoration: "none",
              fontSize: 16
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
      </AppLayout>
    );
  }

   
  const modals = (modalLibrary.modals || []).slice().reverse();
  const bestPerformerModalId = modals.reduce((bestId, m) => {
    const bestModal = modals.find(mod => mod.modalId === bestId);
    if (!bestModal) return m.stats.revenue > 0 ? m.modalId : bestId;
    return m.stats.revenue > bestModal.stats.revenue ? m.modalId : bestId;
  }, null);
  const totalModalsPages = Math.ceil(modals.length / ITEMS_PER_PAGE);
  const paginatedModals = modals.slice(
    (modalsPage - 1) * ITEMS_PER_PAGE,
    modalsPage * ITEMS_PER_PAGE
  );
  const activeModal = modals.find(m => m.modalId === modalLibrary.currentModalId);

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>Performance</h1>
          
          {/* Date Selector */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleDateRangeChange('30d')}
              style={{
                padding: "8px 16px",
                background: dateRange === '30d' ? "#8B5CF6" : "white",
                color: dateRange === '30d' ? "white" : "#6b7280",
                border: dateRange === '30d' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => handleDateRangeChange('7d')}
              style={{
                padding: "8px 16px",
                background: dateRange === '7d' ? "#8B5CF6" : "white",
                color: dateRange === '7d' ? "white" : "#6b7280",
                border: dateRange === '7d' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => handleDateRangeChange('all')}
              style={{
                padding: "8px 16px",
                background: dateRange === 'all' ? "#8B5CF6" : "white",
                color: dateRange === 'all' ? "white" : "#6b7280",
                border: dateRange === 'all' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              All Time
            </button>
            
            {/* DEV: Generate Test Events Button - Hidden for recording */}
            {false && process.env.NODE_ENV === 'development' && (
              <fetcher.Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="action" value="generateTestEvents" />
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    background: "#fbbf24",
                    color: "#1f2937",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginLeft: 8
                  }}
                >
                   Generate Test Data
                </button>
              </fetcher.Form>
            )}
          </div>
        </div>
        <p style={{ color: "#666", margin: 0 }}>
          Compare performance across all your modal campaigns
        </p>
        </div>

      {/* Switch to Autopilot — Guided-mode-only upsell. Capability copy, NO
          savings/dollar figure (that counterfactual is unmeasurable — spec §5.2).
          Flips mode to full AI, preserving the warm learning history. */}
      {mode === 'hybrid' && (
        <div style={{
          background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
          border: "1px solid #ddd6fe",
          borderRadius: 12,
          padding: 24,
          marginBottom: 32,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 24,
          flexWrap: "wrap"
        }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#7c3aed", letterSpacing: 0.5, marginBottom: 6 }}>
              YOU'RE ON GUIDED
            </div>
            <h3 style={{ fontSize: 20, margin: "0 0 8px 0", color: "#1f2937" }}>
              Ready to let AI size the offer too?
            </h3>
            <p style={{ fontSize: 15, color: "#4b5563", margin: 0, maxWidth: 620 }}>
              Autopilot also sizes each offer per shopper, giving less where less will do,
              to protect your margin automatically. Your learning history carries over,
              so it starts warm.
            </p>
          </div>
          <autopilotFetcher.Form method="post">
            <input type="hidden" name="action" value="switchToAutopilot" />
            <button
              type="submit"
              disabled={autopilotFetcher.state !== 'idle'}
              style={{
                padding: "14px 28px",
                background: autopilotFetcher.state === 'idle' ? "#8B5CF6" : "#9ca3af",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 600,
                cursor: autopilotFetcher.state === 'idle' ? "pointer" : "not-allowed",
                whiteSpace: "nowrap"
              }}
            >
              {autopilotFetcher.state === 'idle' ? "Switch to Autopilot →" : "Switching..."}
            </button>
          </autopilotFetcher.Form>
        </div>
      )}

      {autopilotFetcher.data?.success && (
        <div style={{ padding: "12px 16px", background: "#d1fae5", color: "#065f46", borderRadius: 8, marginBottom: 24, fontSize: 14, fontWeight: 500 }}>
          {autopilotFetcher.data.message}
        </div>
      )}
      {autopilotFetcher.data && autopilotFetcher.data.success === false && (
        <div style={{ padding: "12px 16px", background: "#fee2e2", color: "#991b1b", borderRadius: 8, marginBottom: 24, fontSize: 14, fontWeight: 500 }}>
          {autopilotFetcher.data.message}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ 
        borderBottom: "2px solid #e5e7eb", 
        marginBottom: 32,
        display: "flex",
        gap: 0
      }}>
        <button
          onClick={() => setActiveTab('modals')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'modals' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'modals' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'modals' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2,
            transition: "all 0.2s"
          }}
        >
          Your Modals
        </button>
        
        <button
          onClick={() => canAccessAIVariants && setActiveTab('variants')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'variants' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'variants' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'variants' ? 600 : 400,
            fontSize: 16,
            cursor: canAccessAIVariants ? "pointer" : "not-allowed",
            marginBottom: -2,
            opacity: canAccessAIVariants ? 1 : 0.5,
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >
          AI Variants
          {!canAccessAIVariants && (
            <span style={{
              padding: "2px 6px",
              background: "#8B5CF6",
              color: "white",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600
            }}>
              ENTERPRISE
            </span>
          )}
        </button>
      </div>

      {/* Tab Content - Your Modals */}
      {activeTab === 'modals' && (
        <>
      {/* Insights Summary Cards */}
      {(() => {
        const allModals = (modalLibrary.modals || []).slice().reverse();
        const modalsWithRevenue = allModals.filter(m => m.stats.revenue > 0);
        const bestModal = modalsWithRevenue.length > 0
          ? modalsWithRevenue.reduce((best, m) => m.stats.revenue > best.stats.revenue ? m : best)
          : null;
        // Canonical (Prisma) when available, falling back to the per-modal
        // event sums only if the shop row or query failed. The per-modal table
        // below still reads the metafield, so it can legitimately not add up to
        // these — the note under it says so rather than leaving a merchant to
        // spot the difference themselves.
        const totalRecovered = totals ? totals.revenue : allModals.reduce((sum, m) => sum + (m.stats.revenue || 0), 0);
        // Three states, not two. `measuringSince` is null only when the shop
        // has NO contract rows at all — it has not started measuring. Once it
        // has any, an empty window is a real $0 and must say so.
        //
        // The old two-state version showed the LEGACY total_price figure
        // under the new, stricter label until the first contract order
        // landed, then collapsed to one order's subtotal overnight. The label
        // promises "only when the modal rendered, minus refunds"; the legacy
        // number is none of those things.
        const contractLive = Boolean(metrics?.measuringSince);
        const useContractM1 = contractLive;
        // M3 — intent-to-treat verified lift. Replaces the old
        // getIncrementality() card, which compared rendered-only CVR against
        // the holdout (per-protocol) and ignored the date toggle entirely.
        const m3 = metrics?.m3 ?? null;
        // Use the shop's own currency. The contract already resolves it from
        // the orders; hardcoding '$' shows a GBP merchant "$1,234.00" on a
        // number whose whole promise is that it reconciles against Shopify.
        const fmtMoney = (n) => {
          const amount = Number(n || 0);
          if (metrics?.currency) {
            try {
              return new Intl.NumberFormat(undefined, {
                style: 'currency', currency: metrics.currency
              }).format(amount);
            } catch { /* unknown currency code — fall through */ }
          }
          return `$${amount.toLocaleString(undefined, {
            minimumFractionDigits: 2, maximumFractionDigits: 2
          })}`;
        };
        const totalImpressions = totals ? totals.impressions : allModals.reduce((sum, m) => sum + (m.stats.impressions || 0), 0);
        const totalClicks = totals ? totals.clicks : allModals.reduce((sum, m) => sum + (m.stats.clicks || 0), 0);
        const totalConversions = totals ? totals.conversions : allModals.reduce((sum, m) => sum + (m.stats.conversions || 0), 0);
        const overallCVR = totals
          ? totals.conversionRate
          : (totalImpressions > 0 ? (totalConversions / totalImpressions * 100) : 0);

        // Generate insight
        let insight = null;
        if (totalImpressions === 0) {
          insight = "Your modals need traffic. Make sure the app is enabled and the theme extension is active.";
        } else if (bestModal && modalsWithRevenue.length > 1) {
          const secondBest = modalsWithRevenue.filter(m => m.modalId !== bestModal.modalId)
            .reduce((best, m) => m.stats.revenue > best.stats.revenue ? m : best, { stats: { revenue: 0 } });
          if (bestModal.stats.revenue > secondBest.stats.revenue * 3) {
            insight = `${bestModal.modalName} is significantly outperforming others. Consider making it your default.`;
          }
        }
        if (!insight && totalClicks > 0 && totalConversions === 0) {
          insight = "Visitors are clicking but not buying. Try a stronger offer or ensure the discount auto-applies.";
        }
        if (!insight && overallCVR > 5) {
          insight = "Strong conversion rate! Consider increasing your session limit to show your modal to more visitors.";
        }
        if (!insight && totalConversions > 0) {
          insight = `Your modals are converting at ${overallCVR.toFixed(1)}% overall. Keep testing to improve.`;
        }

        if (allModals.length === 0) return null;

        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            {/* Best Performer */}
            <div style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 20
            }}>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Best Performer</div>
              {bestModal ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937", marginBottom: 4 }}>
                    {bestModal.modalName}
                  </div>
                  <div style={{ fontSize: 14, color: "#10b981", fontWeight: 600 }}>
                    ${bestModal.stats.revenue.toLocaleString()} revenue
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 14, color: "#9ca3af" }}>No conversions yet</div>
              )}
            </div>

            {/* M1 recovered revenue + M2 discount cost.
                §2.5 item 4: the label has to be what the number actually
                supports — "orders placed after a Resparq offer", not "revenue
                Resparq recovered". The first is verifiable and standard for
                the category; the second is a causal claim only M3 can make.
                §2.5 M2: never show M1 without it. A merchant who works the
                subtraction out for themselves and finds it unflattering is a
                churned merchant, so the subtraction is done for them.

                TWO BASES, and the card says which one it is on.
                AttributedOrder starts empty and only fills from the next
                order, so on the day this ships every existing shop has no
                contract data. Blanking the card would take a live merchant's
                revenue figure away overnight — unacceptable. Showing the
                legacy figure under the contract's label would be worse: that
                label promises render-gated, refund-adjusted, tax-excluded
                money and the legacy figure is none of those.
                So: show the legacy number under the legacy claim until the
                contract has data, then switch both together. */}
            <div
              title={useContractM1
                ? "Revenue from orders placed after a shopper was shown a Resparq offer, counted only when the modal actually rendered, minus refunds and cancellations. Excludes tax and shipping. Attributed, not causal — the Verified Lift card is the causal number."
                : "Total value of orders placed after a customer engaged with a Resparq offer. Attributed, not causal — the Verified Lift card is the causal number. Refund-adjusted reporting that excludes tax and shipping begins with your next order."}
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 20
              }}
            >
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                Revenue after a Resparq offer
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937" }}>
                {useContractM1 ? fmtMoney(metrics.m1.amount) : `$${totalRecovered.toLocaleString()}`}
              </div>
              {useContractM1 ? (
                <>
                  <div style={{ fontSize: 14, color: "#6b7280" }}>
                    across {metrics.m1.orderCount} order{metrics.m1.orderCount !== 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                    &minus; {fmtMoney(metrics.m2.amount)} discount cost
                    {' '}= <strong style={{ color: "#1f2937" }}>{fmtMoney(metrics.net)}</strong> net
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 14, color: "#6b7280" }}>
                  across {allModals.length} modal{allModals.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Verified Lift (holdout-measured — proof, not projection) */}
            <div
              title="Proven against the 10% of your shoppers who never see offers. No other exit-intent app verifies its lift against a real control group."
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 20
              }}
            >
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Verified Lift</div>
              {/* Intent-to-treat, from the metrics contract (M3).

                  This card used to read getIncrementality(), which compared
                  RENDERED-only CVR against the holdout. That is per-protocol:
                  it selects the treated group on something that happened after
                  randomisation — the shopper stayed long enough to trigger a
                  surface — so it credits Resparq for the engagement that earned
                  the trigger, not just for the offer. It also had no time
                  window at all, so it read lifetime while every other number on
                  this page moved with the date toggle.

                  M3's denominator is every visitor the coin sent to treatment,
                  including the ones the AI stayed quiet for and the ones whose
                  trigger never fired. That is a bigger denominator, so this
                  number is LOWER than what the card showed before. It is the
                  honest one, and it is the only figure here that answers "what
                  happens to my store if I install this". */}
              {m3?.measured && m3.liftFactor > 0 ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981" }}>
                    {m3.relativeLift != null
                      ? `+${Math.round(m3.relativeLift * 100)}% conversion`
                      : `+${m3.liftPts.toFixed(1)}pt conversion`}
                  </div>
                  {/* Multiply the lift share by the SAME revenue figure this
                      page shows above, and format it in the shop's currency.

                      It used to multiply by `totalRecovered`, which comes from
                      getShopMetrics and is engagement-attributed, while the
                      ratio is now intent-to-treat — numerator and denominator
                      drawn from different populations and different tables.
                      The hardcoded "$" was wrong for the same reason the
                      headline above uses fmtMoney: a GBP merchant must not be
                      shown dollars on a number whose whole promise is that it
                      reconciles against Shopify. */}
                  <div style={{ fontSize: 14, color: "#6b7280" }}>
                    ≈ {fmtMoney(Math.round(m3.liftFactor * (useContractM1 ? metrics.m1.amount : totalRecovered)))} you&rsquo;d have lost — verified vs control
                  </div>
                </>
              ) : m3?.measured ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937" }}>
                    {m3.treatedCVR != null ? `${(m3.treatedCVR * 100).toFixed(1)}% CVR` : "—"}
                  </div>
                  <div style={{ fontSize: 14, color: "#6b7280" }}>
                    lift still stabilizing vs control group
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937" }}>
                    {m3?.treatedCVR != null ? `${(m3.treatedCVR * 100).toFixed(1)}% CVR` : "Measuring"}
                  </div>
                  <div style={{ fontSize: 14, color: "#6b7280" }}>
                    verified after {m3?.minHoldout ?? 30} control visitors ({m3?.holdoutDecisions ?? 0} so far)
                  </div>
                </>
              )}
              {/* §2.5: M1 and M3 answer different questions and will not
                  match — M1 is several times larger. The first merchant to
                  notice that gap assumes one of the two is fabricated unless
                  the page says so first, in plain language. */}
              {useContractM1 && (
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 10, lineHeight: 1.45 }}>
                  The revenue card counts every order placed after a shopper saw an offer.
                  This card measures how many of those would not have happened anyway,
                  against a holdout group. They answer different questions, so they will not match.
                </div>
              )}
            </div>

            {/* M4 show rate is computed (metrics.m4) but deliberately NOT
                rendered here. §2.5 calls it "internal, diagnostic" and it is:
                a tripwire for a silent confirm-render failure, aimed at us,
                not a message for a merchant. A red banner telling a paying
                shop their install is broken — on a ratio that can be depressed
                by ordinary causes — costs more trust than it saves. Read it
                from scripts/dev/dashboard-preview.mjs or the admin console. */}

            {/* Quick Insight */}
            <div style={{
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: 12,
              padding: 20
            }}>
              <div style={{ fontSize: 13, color: "#0369a1", marginBottom: 8, fontWeight: 600 }}>Quick Insight</div>
              <div style={{ fontSize: 14, color: "#0c4a6e", lineHeight: 1.5 }}>
                {insight || "Keep running your modals to collect more performance data."}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Performance Table */}
      <div style={{
        background: "white",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        overflow: "hidden"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Modal</th>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Status</th>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Dates</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Shown</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Clicks</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>CVR</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Orders</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {paginatedModals.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
                  No modals created yet. Save your first modal in Settings to start tracking performance.
                </td>
              </tr>
            ) : (
              paginatedModals.map((modal) => {
                const isBest = modal.modalId === bestPerformerModalId;
                const cvr = modal.stats.impressions > 0
                  ? (modal.stats.conversions / modal.stats.impressions * 100).toFixed(1)
                  : null;
                const noData = modal.stats.impressions === 0;

                return (
                  <tr
                    key={modal.modalId}
                    style={{
                      borderBottom: "1px solid #e5e7eb",
                      background: modal.active ? "#f0f9ff" : "white",
                      borderLeft: isBest ? "3px solid #10b981" : "3px solid transparent"
                    }}
                  >
                    <td style={{ padding: 16, fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {modal.modalName}
                        {isBest && (
                          <span style={{
                            padding: "2px 6px",
                            background: "#dcfce7",
                            color: "#166534",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600
                          }}>
                            Best
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: 16 }}>
                      {modal.active ? (
                        <span style={{
                          padding: "4px 8px",
                          background: "#10b981",
                          color: "white",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600
                        }}>
                          Enabled
                        </span>
                      ) : (
                        <span style={{
                          padding: "4px 8px",
                          background: "#6b7280",
                          color: "white",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600
                        }}>
                          Disabled
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 16, fontSize: 14, color: "#6b7280" }}>
                      {modal.active ? (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - Now
                        </div>
                      ) : (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - {new Date(modal.lastActiveAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", color: noData ? "#9ca3af" : undefined }}>
                      {noData ? "No data yet" : modal.stats.impressions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", color: noData ? "#9ca3af" : undefined }}>
                      {noData ? "-" : modal.stats.clicks.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", color: noData ? "#9ca3af" : undefined }}>
                      {noData ? "-" : `${cvr}%`}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", color: noData ? "#9ca3af" : undefined }}>
                      {noData ? "-" : modal.stats.conversions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: noData ? "#9ca3af" : "#10b981" }}>
                      {noData ? "-" : `$${modal.stats.revenue.toLocaleString()}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totals && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12, lineHeight: 1.5 }}>
          Per-modal rows come from each modal&apos;s own event log, which is capped at 90 days and does not record
          surfaces shown outside a saved modal. The summary totals above are measured separately and are the
          authoritative figures, so these rows may not add up to them exactly.
        </p>
      )}

      {/* Modals Pagination */}
      {totalModalsPages > 1 && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          gap: 8, 
          marginTop: 24,
          alignItems: 'center'
        }}>
          <button
            onClick={() => setModalsPage(p => Math.max(1, p - 1))}
            disabled={modalsPage === 1}
            style={{
              padding: '8px 16px',
              background: modalsPage === 1 ? '#e5e7eb' : '#8B5CF6',
              color: modalsPage === 1 ? '#9ca3af' : 'white',
              border: 'none',
              borderRadius: 4,
              cursor: modalsPage === 1 ? 'not-allowed' : 'pointer',
              fontWeight: 500
            }}
          >
            Previous
          </button>
          
          <span style={{ color: '#6b7280', fontSize: 14 }}>
            Page {modalsPage} of {totalModalsPages}
          </span>
          
          <button
            onClick={() => setModalsPage(p => Math.min(totalModalsPages, p + 1))}
            disabled={modalsPage === totalModalsPages}
            style={{
              padding: '8px 16px',
              background: modalsPage === totalModalsPages ? '#e5e7eb' : '#8B5CF6',
              color: modalsPage === totalModalsPages ? '#9ca3af' : 'white',
              border: 'none',
              borderRadius: 4,
              cursor: modalsPage === totalModalsPages ? 'not-allowed' : 'pointer',
              fontWeight: 500
            }}
          >
            Next
          </button>
        </div>
      )}
        </>
      )}

      {/* Tab Content - AI Variants */}
      {activeTab === 'variants' && (
        <>
          {!canAccessAIVariants ? (
            <div style={{
              background: "white",
              padding: 48,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              textAlign: "center"
            }}>
              <h2 style={{ fontSize: 24, marginBottom: 16 }}>AI Variant Testing</h2>
              <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24 }}>
                Get detailed insights into AI-generated variants and manually control which ones stay in rotation.
              </p>
              <span style={{
                display: 'inline-block',
                padding: "4px 12px",
                background: "#8B5CF6",
                color: "white",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600
              }}>
                ENTERPRISE
              </span>
            </div>
          ) : liveVariants.length === 0 ? (
            <div style={{
              background: "white",
              padding: 48,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              textAlign: "center"
            }}>
              <h2 style={{ fontSize: 24, marginBottom: 16 }}>No AI Variants Yet</h2>
              <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24 }}>
                Switch to AI Mode in Settings to start generating and testing variants automatically.
              </p>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16, color: "#6b7280", fontSize: 14 }}>
                {liveVariants.length} variant{liveVariants.length !== 1 ? 's' : ''} total
              </div>
              <div style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                overflow: "hidden"
              }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Variant</th>
                    <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Headline</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Shown</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Clicks</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Orders</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
                    <th style={{ padding: 16, textAlign: "center", fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totalVariantsPages = Math.ceil(liveVariants.length / ITEMS_PER_PAGE);
                    const paginatedVariants = liveVariants.slice(
                      (variantsPage - 1) * ITEMS_PER_PAGE,
                      variantsPage * ITEMS_PER_PAGE
                    );
                    
                    return paginatedVariants.map((variant) => {
                    const conversionRate = variant.impressions > 0 
                      ? ((variant.conversions / variant.impressions) * 100).toFixed(1) 
                      : 0;
                    
                    return (
                      <tr 
                        key={variant.id}
                        style={{ 
                          borderBottom: "1px solid #e5e7eb",
                          background: variant.status === 'champion' ? "#f0fdf4" : variant.status === 'protected' ? "#fef3c7" : "white"
                        }}
                      >
                        <td style={{ padding: 16 }}>
                          <div style={{ fontWeight: 500, marginBottom: 4 }}>
                            {variant.variantId}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Gen {variant.generation} · {variant.baseline}
                          </div>
                          {variant.status === 'champion' && (
                            <span style={{
                              display: 'inline-block',
                              marginTop: 4,
                              padding: "2px 6px",
                              background: "#10b981",
                              color: "white",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600
                            }}>
                              CHAMPION
                            </span>
                          )}
                          {variant.status === 'protected' && (
                            <span style={{
                              display: 'inline-block',
                              marginTop: 4,
                              padding: "2px 6px",
                              background: "#f59e0b",
                              color: "white",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600
                            }}>
                              PROTECTED
                            </span>
                          )}
                        </td>
                        <td style={{ padding: 16, maxWidth: 300 }}>
                          <div style={{ fontSize: 14, marginBottom: 4 }}>
                            {variant.headline}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {variant.cta}
                          </div>
                        </td>
                        <td style={{ padding: 16, textAlign: "right" }}>
                          {variant.impressions.toLocaleString()}
                        </td>
                        <td style={{ padding: 16, textAlign: "right" }}>
                          {variant.clicks.toLocaleString()}
                        </td>
                        <td style={{ padding: 16, textAlign: "right" }}>
                          {variant.conversions.toLocaleString()}
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {conversionRate}%
                          </div>
                        </td>
                        <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: "#10b981" }}>
                          ${variant.revenue.toLocaleString()}
                        </td>
                        <td style={{ padding: 16 }}>
                          {variant.status === 'killed' ? (
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <span style={{
                                padding: "6px 12px",
                                background: "#6b7280",
                                color: "white",
                                borderRadius: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                opacity: 0.6
                              }}>
                                Killed
                              </span>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                              <Form method="post" style={{ margin: 0 }}>
                                <input type="hidden" name="action" value="updateStatus" />
                                <input type="hidden" name="variantId" value={variant.id} />
                                <select
                                  name="status"
                                  defaultValue={variant.status}
                                  onChange={(e) => e.target.form.requestSubmit()}
                                  style={{
                                    padding: "6px 12px",
                                    border: "1px solid #d1d5db",
                                    borderRadius: 4,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    background: "white"
                                  }}
                                >
                                  <option value="alive">Active</option>
                                  <option value="protected">Protected</option>
                                  <option value="champion">Champion</option>
                                </select>
                              </Form>
                              
                              <button
                                type="button"
                                style={{
                                  padding: "6px 12px",
                                  background: "#ef4444",
                                  color: "white",
                                  border: "none",
                                  borderRadius: 4,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer"
                                }}
                                title="Permanently remove this variant"
                                onClick={() => {
                                  if (confirm('Are you sure you want to kill this variant? This action cannot be undone.')) {
                                    fetcher.submit(
                                      { action: 'killVariant', variantId: variant.id },
                                      { method: 'post' }
                                    );
                                  }
                                }}
                              >
                                Kill
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  });
                  })()}
                </tbody>
              </table>
            </div>
            
            {/* Variants Pagination */}
            {liveVariants.length > ITEMS_PER_PAGE && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                gap: 8, 
                marginTop: 24,
                alignItems: 'center'
              }}>
                <button
                  onClick={() => setVariantsPage(p => Math.max(1, p - 1))}
                  disabled={variantsPage === 1}
                  style={{
                    padding: '8px 16px',
                    background: variantsPage === 1 ? '#e5e7eb' : '#8B5CF6',
                    color: variantsPage === 1 ? '#9ca3af' : 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: variantsPage === 1 ? 'not-allowed' : 'pointer',
                    fontWeight: 500
                  }}
                >
                  Previous
                </button>
                
                <span style={{ color: '#6b7280', fontSize: 14 }}>
                  Page {variantsPage} of {Math.ceil(liveVariants.length / ITEMS_PER_PAGE)}
                </span>
                
                <button
                  onClick={() => setVariantsPage(p => Math.min(Math.ceil(liveVariants.length / ITEMS_PER_PAGE), p + 1))}
                  disabled={variantsPage === Math.ceil(liveVariants.length / ITEMS_PER_PAGE)}
                  style={{
                    padding: '8px 16px',
                    background: variantsPage === Math.ceil(liveVariants.length / ITEMS_PER_PAGE) ? '#e5e7eb' : '#8B5CF6',
                    color: variantsPage === Math.ceil(liveVariants.length / ITEMS_PER_PAGE) ? '#9ca3af' : 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: variantsPage === Math.ceil(liveVariants.length / ITEMS_PER_PAGE) ? 'not-allowed' : 'pointer',
                    fontWeight: 500
                  }}
                >
                  Next
                </button>
              </div>
            )}
            </>
          )}
        </>
      )}

      <div style={{ marginTop: 32, textAlign: "center" }}>
        <Link
          to="/app"
          style={{
            color: "#8B5CF6",
            textDecoration: "none",
            fontSize: 16
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
    </AppLayout>
  );
}