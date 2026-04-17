import { useLoaderData, Link, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import { checkAndResetUsage, PLAN_FEATURES } from "../utils/featureGates";
import { getShopPlan } from "../utils/plan.server";
import { createCurrencyFormatter } from "../utils/currency";
import AppLayout from "../components/AppLayout";
import OnboardingChecklist from "../components/OnboardingChecklist";
import db from "../db.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // Load plan up-front so it survives any downstream error in this loader.
  // If the rest of the dashboard query fails, we still pass a real plan to
  // AppLayout so the sidebar plan badge + DEV switcher render correctly.
  let earlyPlan = null;
  try {
    const canonical = await getShopPlan(session);
    earlyPlan = { tier: canonical.tier, status: canonical.status || "active", billingCycle: canonical.billingCycle || "monthly" };
  } catch (e) {
    console.error("[Dashboard] getShopPlan failed:", e);
  }

  try {
    const response = await admin.graphql(`
      query {
        shop {
          id
          currencyCode
          settings: metafield(namespace: "exit_intent", key: "settings") {
            value
          }
          status: metafield(namespace: "exit_intent", key: "status") {
            value
          }
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
          onboarding: metafield(namespace: "exit_intent", key: "onboarding") {
            value
          }
        }
      }
    `);

    const data = await response.json();

    const currencyCode = data.data.shop?.currencyCode || "USD";

    const settings = data.data.shop?.settings?.value
      ? JSON.parse(data.data.shop.settings.value)
      : null;

    const status = data.data.shop?.status?.value
      ? JSON.parse(data.data.shop.status.value)
      : { enabled: false };

    let plan = data.data.shop?.plan?.value
      ? JSON.parse(data.data.shop.plan.value)
      : null;

    const modalLibrary = data.data.shop?.modalLibrary?.value
      ? JSON.parse(data.data.shop.modalLibrary.value)
      : null;

    const onboarding = data.data.shop?.onboarding?.value
      ? JSON.parse(data.data.shop.onboarding.value)
      : { themeEditorClicked: false, dismissed: false };

    // If no plan exists, create default plan
    if (!plan) {
      const now = new Date();
      
      const resetDate = new Date(now);
      resetDate.setMonth(resetDate.getMonth() + 1);
      
      plan = {
        tier: "starter",
        status: "active",
        billingCycle: "monthly",
        startDate: now.toISOString(),
        usage: {
          impressionsThisMonth: 0,
          resetDate: resetDate.toISOString()
        }
      };

      // Save the plan
      const shopId = data.data.shop.id;
      await admin.graphql(`
        mutation SetDefaultPlan($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "plan"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(plan)
        }
      });

      console.log(' Created default plan:', plan.tier);
    }

    // Check if usage needs to be reset
    if (plan) {
      const shopId = data.data.shop.id;
      const resetResult = checkAndResetUsage(plan, shopId, admin);
      
      if (resetResult.needsReset) {
        // Save the updated plan with reset usage
        await admin.graphql(`
          mutation UpdatePlanAfterReset($ownerId: ID!, $value: String!) {
            metafieldsSet(metafields: [{
              ownerId: $ownerId
              namespace: "exit_intent"
              key: "plan"
              value: $value
              type: "json"
            }]) {
              metafields { id }
            }
          }
        `, {
          variables: {
            ownerId: shopId,
            value: JSON.stringify(resetResult.plan)
          }
        });

        plan = resetResult.plan;
        console.log(' Usage reset saved to metafields');
      }
    }

    // Load real analytics data
    const analyticsResponse = await admin.graphql(`
      query {
        shop {
          analytics: metafield(namespace: "exit_intent", key: "analytics") {
            value
          }
        }
      }
    `);

    const analyticsData = await analyticsResponse.json();
    const analyticsRaw = analyticsData.data.shop?.analytics?.value 
      ? JSON.parse(analyticsData.data.shop.analytics.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0, events: [] };

    // Calculate 30-day rolling metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = analyticsRaw.events || [];
    const last30DaysEvents = events.filter(e => new Date(e.timestamp) > thirtyDaysAgo);

    const impressions30d = last30DaysEvents.filter(e => e.type === 'impression').length;
    const clicks30d = last30DaysEvents.filter(e => e.type === 'click').length;
    const conversions30d = last30DaysEvents.filter(e => e.type === 'conversion').length;

    const conversionRate30d = impressions30d > 0 
      ? ((conversions30d / impressions30d) * 100).toFixed(1) 
      : 0;

    const revenue30d = last30DaysEvents
      .filter(e => e.type === 'conversion')
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    const clickRate30d = impressions30d > 0
      ? ((clicks30d / impressions30d) * 100).toFixed(1)
      : 0;

    const revenuePerView30d = impressions30d > 0
      ? (revenue30d / impressions30d).toFixed(2)
      : 0;

    // Calculate 7-day trend indicators (current 7 days vs previous 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const last7Events = events.filter(e => new Date(e.timestamp) > sevenDaysAgo);
    const prev7Events = events.filter(e => {
      const d = new Date(e.timestamp);
      return d > fourteenDaysAgo && d <= sevenDaysAgo;
    });

    const last7Revenue = last7Events.filter(e => e.type === 'conversion').reduce((s, e) => s + (e.revenue || 0), 0);
    const prev7Revenue = prev7Events.filter(e => e.type === 'conversion').reduce((s, e) => s + (e.revenue || 0), 0);
    const last7Conversions = last7Events.filter(e => e.type === 'conversion').length;
    const prev7Conversions = prev7Events.filter(e => e.type === 'conversion').length;
    const last7Impressions = last7Events.filter(e => e.type === 'impression').length;
    const prev7Impressions = prev7Events.filter(e => e.type === 'impression').length;
    const last7CVR = last7Impressions > 0 ? (last7Conversions / last7Impressions * 100) : 0;
    const prev7CVR = prev7Impressions > 0 ? (prev7Conversions / prev7Impressions * 100) : 0;

    const hasTrendData = prev7Events.length > 0;
    const trends = {
      hasTrendData,
      revenueChange: hasTrendData && prev7Revenue > 0 ? ((last7Revenue - prev7Revenue) / prev7Revenue * 100) : null,
      conversionsChange: hasTrendData && prev7Conversions > 0 ? ((last7Conversions - prev7Conversions) / prev7Conversions * 100) : null,
      cvrChange: hasTrendData && prev7CVR > 0 ? (last7CVR - prev7CVR) : null,
    };

    // Calculate lifetime metrics (for Pro+)
    const impressionsLifetime = analyticsRaw.impressions || 0;
    const clicksLifetime = analyticsRaw.clicks || 0;
    const conversionsLifetime = analyticsRaw.conversions || 0;
    const revenueLifetime = analyticsRaw.revenue || 0;

    const conversionRateLifetime = impressionsLifetime > 0 
      ? ((conversionsLifetime / impressionsLifetime) * 100).toFixed(1) 
      : 0;

    const clickRateLifetime = impressionsLifetime > 0 
      ? ((clicksLifetime / impressionsLifetime) * 100).toFixed(1) 
      : 0;

    const revenuePerViewLifetime = impressionsLifetime > 0 
      ? (revenueLifetime / impressionsLifetime).toFixed(2) 
      : 0;

    // Build daily revenue data for the last 7 days (revenue timeline)
    const dailyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayEvents = events.filter(e => {
        return e.type === 'conversion' && e.timestamp && e.timestamp.startsWith(dateKey);
      });
      dailyRevenue.push({
        day: dayName,
        date: dateKey,
        revenue: dayEvents.reduce((s, e) => s + (e.revenue || 0), 0),
        conversions: dayEvents.length
      });
    }

    const analytics = {
      // 30-day metrics (everyone)
      last30Days: {
        totalRevenue: revenue30d,
        conversionRate: parseFloat(conversionRate30d),
        clickRate: parseFloat(clickRate30d),
        revenuePerView: parseFloat(revenuePerView30d),
        impressions: impressions30d,
        clicks: clicks30d,
        conversions: conversions30d
      },
      // Lifetime metrics (Pro+)
      lifetime: {
        totalRevenue: revenueLifetime,
        conversionRate: parseFloat(conversionRateLifetime),
        clickRate: parseFloat(clickRateLifetime),
        revenuePerView: parseFloat(revenuePerViewLifetime),
        impressions: impressionsLifetime,
        clicks: clicksLifetime,
        conversions: conversionsLifetime
      },
      // 7-day trends (all tiers)
      trends,
      // Daily revenue for timeline (Pro+)
      dailyRevenue
    };

    // PHASE 5: Check for active site-wide promotions (Pro tier upsell)
    let promoWarning = null;
    let activePromotions = null;

    const shopDomain = session.shop;
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true, populationSize: true, plan: true }
    });

    // DB is the single source of truth for plan tier. Usage data still
    // lives on the metafield plan object (tracked per 30-day window).
    const canonicalPlan = await getShopPlan(session);
    plan = { ...plan, tier: canonicalPlan.tier };

    // Idle cart pickup: On first load, evaluate any abandoned carts
    // that existed before the app was enabled. Fire-and-forget to avoid
    // slowing down the admin page load.
    if (shopRecord) {
      import("../utils/idle-cart-pickup.server.js")
        .then(({ pickupIdleCarts }) => pickupIdleCarts(admin, shopDomain))
        .catch((e) => console.error("[Idle Cart Pickup] Background error:", e));
    }

    if (plan && plan.tier === 'pro' && shopRecord) {
      const activePromo = await db.promotion.findFirst({
        where: {
          shopId: shopRecord.id,
          status: "active",
          classification: "site_wide"
        },
        orderBy: {
          amount: 'desc'
        }
      });

      if (activePromo) {
        promoWarning = {
          code: activePromo.code,
          amount: activePromo.amount,
          type: activePromo.type,
          aiStrategy: activePromo.aiStrategy,
          message: `Your ${activePromo.code} promotion is active with a high take rate. Your exit offers are still running at full strength.`
        };
      }
    }

    // Enterprise: Load active promotions summary
    if (plan && plan.tier === 'enterprise' && shopRecord) {
      const promos = await db.promotion.findMany({
        where: {
          shopId: shopRecord.id,
          status: "active"
        },
        orderBy: {
          detectedAt: 'desc'
        },
        take: 3
      });

      if (promos.length > 0) {
        activePromotions = {
          count: promos.length,
          promotions: promos.map(p => ({
            code: p.code,
            amount: p.amount,
            type: p.type,
            aiStrategy: p.aiStrategy || 'auto'
          }))
        };
      }
    }

    // AI Learning Progress: champion variant + stats (Pro/Enterprise with AI mode)
    let aiProgress = null;
    let holdoutLift = null;
    const isAIMode = settings?.mode === 'ai' && (plan.tier === 'pro' || plan.tier === 'enterprise');

    if (shopRecord && isAIMode) {
      const [champion, variantCounts, maxGen] = await Promise.all([
        db.variant.findFirst({
          where: { shopId: shopRecord.id, status: "champion" },
          select: { headline: true, cta: true, conversions: true, impressions: true, generation: true }
        }),
        db.variant.groupBy({
          by: ['status'],
          where: { shopId: shopRecord.id },
          _count: true
        }),
        db.variant.aggregate({
          where: { shopId: shopRecord.id },
          _max: { generation: true },
          _count: true
        })
      ]);

      const statusCounts = {};
      variantCounts.forEach(g => { statusCounts[g.status] = g._count; });

      aiProgress = {
        champion: champion ? {
          headline: champion.headline,
          cta: champion.cta,
          cvr: champion.impressions > 0 ? (champion.conversions / champion.impressions * 100).toFixed(1) : '0.0',
          generation: champion.generation
        } : null,
        totalVariants: maxGen._count || 0,
        maxGeneration: maxGen._max?.generation || 0,
        active: (statusCounts['alive'] || 0) + (statusCounts['champion'] || 0) + (statusCounts['protected'] || 0),
        eliminated: (statusCounts['killed'] || 0) + (statusCounts['dead'] || 0)
      };

      // Holdout-based incremental lift calculation (uses index [shopId, wasShown, converted])
      const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();
      const [treatmentTotal, treatmentConverted, holdoutTotal, holdoutConverted, treatmentRevenue, holdoutRevenue] = await Promise.all([
        db.interventionOutcome.count({
          where: { shopId: shopRecord.id, isHoldout: false, wasShown: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } }
        }),
        db.interventionOutcome.count({
          where: { shopId: shopRecord.id, isHoldout: false, wasShown: true, converted: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } }
        }),
        db.interventionOutcome.count({
          where: { shopId: shopRecord.id, isHoldout: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } }
        }),
        db.interventionOutcome.count({
          where: { shopId: shopRecord.id, isHoldout: true, converted: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } }
        }),
        db.interventionOutcome.aggregate({
          where: { shopId: shopRecord.id, isHoldout: false, wasShown: true, converted: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } },
          _sum: { revenue: true }
        }),
        db.interventionOutcome.aggregate({
          where: { shopId: shopRecord.id, isHoldout: true, converted: true, timestamp: { gte: new Date(thirtyDaysAgoISO) } },
          _sum: { revenue: true }
        })
      ]);

      if (treatmentTotal > 0 && holdoutTotal >= 10) {
        const treatmentCVR = treatmentConverted / treatmentTotal;
        const holdoutCVR = holdoutConverted / holdoutTotal;
        const liftPct = holdoutCVR > 0 ? ((treatmentCVR - holdoutCVR) / holdoutCVR * 100) : (treatmentCVR > 0 ? 100 : 0);
        const treatmentRev = treatmentRevenue._sum?.revenue || 0;
        const holdoutRev = holdoutRevenue._sum?.revenue || 0;
        // Extrapolate holdout revenue to treatment group size for apples-to-apples
        const baselineRevenue = holdoutTotal > 0 ? (holdoutRev / holdoutTotal) * treatmentTotal : 0;
        const incrementalRevenue = Math.max(0, treatmentRev - baselineRevenue);

        holdoutLift = {
          treatmentCVR: (treatmentCVR * 100).toFixed(2),
          holdoutCVR: (holdoutCVR * 100).toFixed(2),
          liftPct: liftPct.toFixed(1),
          incrementalRevenue: Math.round(incrementalRevenue),
          grossRevenue: Math.round(treatmentRev),
          treatmentTotal,
          holdoutTotal,
          hasEnoughData: holdoutTotal >= 20
        };
      }
    }

    return {
      settings,
      status,
      plan,
      analytics,
      promoWarning,
      activePromotions,
      modalLibrary,
      onboarding,
      populationSize: shopRecord?.populationSize || 0,
      shopDomain: session.shop,
      aiProgress,
      holdoutLift,
      isAIMode,
      currencyCode
    };
  } catch (error) {
    console.error("Error loading dashboard:", error);
    return {
      settings: null,
      status: { enabled: false },
      plan: earlyPlan,
      analytics: {
        last30Days: {
          totalRevenue: 0,
          conversionRate: 0,
          clickRate: 0,
          revenuePerView: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        },
        lifetime: {
          totalRevenue: 0,
          conversionRate: 0,
          clickRate: 0,
          revenuePerView: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        },
        trends: { hasTrendData: false, revenueChange: null, conversionsChange: null, cvrChange: null },
        dailyRevenue: []
      },
      populationSize: 0,
      holdoutLift: null,
      isAIMode: false,
      currencyCode: "USD"
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    // Get shop ID
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Plan switching is handled by /app/dev-update-plan (dev switcher) and
    // the billing callback (real customer upgrades). Dashboard no longer
    // owns a switchPlan action — the DB is the single source of truth.

    // SEED: Populate dashboard with realistic test data for screenshots
    if (actionType === "seedAnalytics") {
      const now = new Date();
      const events = [];

      // Realistic e-commerce metrics:
      // - Modal shown to ~3-5% of site visitors who show exit intent
      // - Click rate: 15-25% of impressions
      // - Conversion rate: 2-4% of impressions (8-15% of clicks)
      // - Average order value: $100-150

      // Generate 30 days of realistic events
      for (let day = 0; day < 30; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() - day);

        // Realistic daily volume: 30-80 impressions/day for a medium store
        const dailyImpressions = Math.floor(Math.random() * 50) + 30;
        // Click rate: 12-20%
        const dailyClicks = Math.floor(dailyImpressions * (0.12 + Math.random() * 0.08));
        // Conversion rate from impressions: 4-6% (strong performer)
        const dailyConversions = Math.floor(dailyImpressions * (0.04 + Math.random() * 0.02));

        // Add impressions
        for (let i = 0; i < dailyImpressions; i++) {
          const eventTime = new Date(date);
          eventTime.setHours(Math.floor(Math.random() * 24));
          eventTime.setMinutes(Math.floor(Math.random() * 60));
          events.push({
            type: 'impression',
            event: 'impression',
            timestamp: eventTime.toISOString()
          });
        }

        // Add clicks
        for (let i = 0; i < dailyClicks; i++) {
          const eventTime = new Date(date);
          eventTime.setHours(Math.floor(Math.random() * 24));
          eventTime.setMinutes(Math.floor(Math.random() * 60));
          events.push({
            type: 'click',
            event: 'click',
            timestamp: eventTime.toISOString()
          });
        }

        // Add conversions with realistic AOV ($100-150)
        for (let i = 0; i < dailyConversions; i++) {
          const eventTime = new Date(date);
          eventTime.setHours(Math.floor(Math.random() * 24));
          eventTime.setMinutes(Math.floor(Math.random() * 60));
          const revenue = 100 + Math.random() * 50; // $100-150 AOV
          events.push({
            type: 'conversion',
            event: 'conversion',
            revenue: parseFloat(revenue.toFixed(2)),
            timestamp: eventTime.toISOString()
          });
        }
      }

      // Sort events by timestamp (newest first for display)
      events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Calculate totals
      const totalImpressions = events.filter(e => e.type === 'impression').length;
      const totalClicks = events.filter(e => e.type === 'click').length;
      const totalConversions = events.filter(e => e.type === 'conversion').length;
      const totalRevenue = events
        .filter(e => e.type === 'conversion')
        .reduce((sum, e) => sum + (e.revenue || 0), 0);

      const analyticsData = {
        impressions: totalImpressions,
        clicks: totalClicks,
        closeouts: Math.floor(totalImpressions * 0.7),
        conversions: totalConversions,
        revenue: parseFloat(totalRevenue.toFixed(2)),
        events: events.slice(0, 500) // Keep last 500 events to avoid metafield size limits
      };

      await admin.graphql(`
        mutation SeedAnalytics($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "analytics"
            value: $value
            type: "json"
          }]) {
            metafields { id }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(analyticsData)
        }
      });

      console.log(` Seeded analytics: ${totalImpressions} impressions, ${totalClicks} clicks, ${totalConversions} conversions, $${totalRevenue.toFixed(2)} revenue`);
      return { success: true, analyticsSeeded: true };
    }

    // TEST: Force reset by setting reset date to yesterday
    if (actionType === "testReset") {
      const currentPlan = shopData.data.shop?.plan?.value 
        ? JSON.parse(shopData.data.shop.plan.value)
        : null;

      if (currentPlan && currentPlan.usage) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        currentPlan.usage.resetDate = yesterday.toISOString();

        await admin.graphql(`
          mutation UpdatePlan($ownerId: ID!, $value: String!) {
            metafieldsSet(metafields: [{
              ownerId: $ownerId
              namespace: "exit_intent"
              key: "plan"
              value: $value
              type: "json"
            }]) {
              metafields { id }
            }
          }
        `, {
          variables: {
            ownerId: shopId,
            value: JSON.stringify(currentPlan)
          }
        });

        console.log(` Set reset date to yesterday - refresh page to trigger reset`);
        return { success: true, testResetReady: true };
      }
    }

    // Handle onboarding actions (theme editor clicked, dismiss checklist)
    if (actionType === "onboardingAction") {
      const field = formData.get("onboardingField");
      const value = formData.get("onboardingValue") === "true";

      // Read current onboarding state
      const onboardingResponse = await admin.graphql(`
        query {
          shop {
            onboarding: metafield(namespace: "exit_intent", key: "onboarding") {
              value
            }
          }
        }
      `);
      const onboardingData = await onboardingResponse.json();
      const currentOnboarding = onboardingData.data.shop?.onboarding?.value
        ? JSON.parse(onboardingData.data.shop.onboarding.value)
        : { themeEditorClicked: false, dismissed: false };

      currentOnboarding[field] = value;

      await admin.graphql(`
        mutation UpdateOnboarding($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "onboarding"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(currentOnboarding)
        }
      });

      return { success: true };
    }

    // Handle status toggle
    if (actionType === "toggleStatus") {
      const enabled = formData.get("enabled") === "true";

      await admin.graphql(`
        mutation SetStatus($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "status"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify({ enabled })
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Error in action:", error);
    return { success: false };
  }
}

// Info tooltip component
function InfoTooltip({ content }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        style={{
          background: isOpen ? "#a78bfa" : "#8b5cf6",
          color: "white",
          border: "none",
          borderRadius: "50%",
          width: 20,
          height: 20,
          fontSize: 12,
          fontWeight: "bold",
          cursor: "pointer",
          marginLeft: 8,
          boxShadow: isOpen ? "0 0 0 3px rgba(139, 92, 246, 0.3)" : "none",
          transition: "all 0.2s"
        }}
      >
        ?
      </button>
      
      {isOpen && (
        <div style={{
          position: "absolute",
          bottom: 30,
          left: "50%",
          transform: "translateX(-50%)",
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          width: 240,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#374151",
          zIndex: 1000
        }}>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "none",
              border: "none",
              fontSize: 16,
              color: "#9ca3af",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
          <div style={{ paddingRight: 16 }}>
            {content}
          </div>
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            width: 12,
            height: 12,
            background: "white",
            border: "1px solid #e5e7eb",
            borderTop: "none",
            borderRight: "none",
            transform: "translateX(-50%) rotate(-45deg)"
          }} />
        </div>
      )}
    </div>
  );
}



export default function Dashboard() {
  const { settings, status, plan, analytics, promoWarning, activePromotions, modalLibrary, onboarding, populationSize, shopDomain, aiProgress, holdoutLift, isAIMode, currencyCode } = useLoaderData();
  const fetcher = useFetcher();
  const [isEnabled, setIsEnabled] = useState(status.enabled);

  // Locale-aware currency formatter — dashboard hides cents by default
  const formatCurrency = createCurrencyFormatter(currencyCode, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const handleToggle = () => {
    const newStatus = !isEnabled;
    setIsEnabled(newStatus);

    fetcher.submit(
      { 
        actionType: "toggleStatus",
        enabled: newStatus.toString() 
      },
      { method: "post" }
    );
  };

  // Compute onboarding step completion
  const tier = plan?.tier || "starter";
  const completedSteps = {
    themeExtension: onboarding?.themeEditorClicked || false,
    configureOffer: modalLibrary?.modals?.length > 0,
    configureAI: settings?.mode === "ai",
    enableModal: isEnabled,
    firstImpression: (analytics?.last30Days?.impressions || 0) > 0 || (analytics?.lifetime?.impressions || 0) > 0,
  };
  const showOnboarding = !onboarding?.dismissed;

  const getStrategyLabel = (strategy) => {
    switch(strategy) {
      case 'pause': return 'AI Paused';
      case 'decrease': return 'Decreased Offers';
      case 'continue': return 'Continue Normal';
      case 'ignore': return 'Ignored';
      default: return 'Auto';
    }
  };

  const getStrategyColor = (strategy) => {
    switch(strategy) {
      case 'pause': return '#ef4444';
      case 'decrease': return '#f59e0b';
      case 'continue': return '#10b981';
      case 'ignore': return '#6b7280';
      default: return '#3b82f6';
    }
  };

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>

      {/* Enterprise: Promotional Intelligence Widget */}
      {activePromotions && activePromotions.count > 0 && (
        <div style={{
          background: "white",
          border: "2px solid #fbbf24",
          borderRadius: 12,
          padding: 24,
          marginBottom: 24
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                  Promotional Intelligence
                </h3>
                <span style={{
                  padding: "3px 10px",
                  background: "#fbbf24",
                  color: "#78350f",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700
                }}>
                  {activePromotions.count} ACTIVE
                </span>
              </div>

              {/* Show actionable insight for paused promos */}
              {(() => {
                const pausedPromo = activePromotions.promotions.find(p => p.aiStrategy === 'pause');
                if (pausedPromo) {
                  return (
                    <div style={{
                      fontSize: 14,
                      color: "#78350f",
                      marginBottom: 12,
                      lineHeight: 1.5,
                      padding: "10px 14px",
                      background: "#fef3c7",
                      borderRadius: 8
                    }}>
                      AI paused exit offers during <strong>{pausedPromo.code}</strong> ({pausedPromo.type === 'percentage' ? `${pausedPromo.amount}%` : formatCurrency(pausedPromo.amount)} off) to protect your margins
                    </div>
                  );
                }
                return null;
              })()}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {activePromotions.promotions.map((promo, idx) => (
                  <div key={idx} style={{
                    padding: "6px 12px",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#374151",
                    fontWeight: 500
                  }}>
                    {promo.code} ({promo.type === 'percentage' ? `${promo.amount}%` : formatCurrency(promo.amount)}) → <span style={{ color: getStrategyColor(promo.aiStrategy), fontWeight: 600 }}>{getStrategyLabel(promo.aiStrategy)}</span>
                  </div>
                ))}
              </div>
            </div>
            <Link
              to="/app/promotions"
              style={{
                padding: "12px 24px",
                background: "#fbbf24",
                color: "#78350f",
                textDecoration: "none",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: "nowrap",
                flexShrink: 0,
                marginLeft: 16
              }}
            >
              Manage →
            </Link>
          </div>
        </div>
      )}

      {/* PHASE 5: Promotional Intelligence Warning (Pro Tier Upsell) */}
      {promoWarning && (
        <div style={{
          background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
          border: "2px solid #f59e0b",
          borderRadius: 12,
          padding: 24,
          marginBottom: 32,
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ fontSize: 32 }}></div>
            <div style={{ flex: 1 }}>
              <h3 style={{ 
                margin: 0, 
                fontSize: 20, 
                fontWeight: 600,
                color: "#92400e",
                marginBottom: 8 
              }}>
                Site-Wide Promotion Detected: {promoWarning.code}
              </h3>
              <p style={{ 
                margin: 0, 
                fontSize: 16, 
                color: "#78350f",
                marginBottom: 16,
                lineHeight: 1.5
              }}>
                {promoWarning.message}
              </p>
              <div style={{
                background: "white",
                padding: 16,
                borderRadius: 8,
                marginBottom: 16
              }}>
                <p style={{ margin: 0, fontSize: 14, color: "#92400e", marginBottom: 12 }}>
                  <strong>Enterprise AI would have automatically:</strong>
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, color: "#78350f", fontSize: 14 }}>
                  <li><strong>Decreased your exit offer amounts</strong> to save you margin while your promotion runs</li>
                  <li>Restored your original offer settings once the promotion ended</li>
                  <li>Notified you when the promotion was detected</li>
                </ul>
              </div>
              <Link 
                to="/app/upgrade" 
                style={{
                  display: "inline-block",
                  background: "#f59e0b",
                  color: "white",
                  padding: "12px 24px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 16,
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                }}
              >
                Upgrade to Enterprise →
              </Link>
            </div>
          </div>
        </div>
      )}
      
      {/* Onboarding Checklist */}
      {showOnboarding && (
        <OnboardingChecklist
          completedSteps={completedSteps}
          planTier={tier}
          shopDomain={shopDomain}
          onToggle={handleToggle}
        />
      )}

      {/* Header with Toggle */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 40
      }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>Exit Intent Dashboard</h1>
          <p style={{ color: "#666", marginTop: 8 }}>
            Track your modal performance and recovered revenue
          </p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Active/Inactive Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ 
              fontWeight: 500,
              color: isEnabled ? "#10b981" : "#6b7280"
            }}>
              {isEnabled ? "Active" : "Inactive"}
            </span>
            <button
              onClick={handleToggle}
              style={{
                position: "relative",
                width: 56,
                height: 32,
                borderRadius: 16,
                border: "none",
                cursor: "pointer",
                background: isEnabled ? "#10b981" : "#d1d5db",
                transition: "background 0.3s"
              }}
            >
              <div style={{
                position: "absolute",
                top: 4,
                left: isEnabled ? 28 : 4,
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.3s",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
              }} />
            </button>
          </div>
        </div>
      </div>

      {/* Plan Badge */}
      {plan && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              padding: "6px 12px",
              background: plan.tier === "starter" ? "#dbeafe" : plan.tier === "pro" ? "#8B5CF6" : "#fbbf24",
              color: plan.tier === "starter" ? "#1e40af" : "white",
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 14,
              textTransform: "uppercase"
            }}>
              {plan.tier} Plan
            </div>
          </div>

          {/* Only show upgrade CTA if trialing OR Pro wanting to upgrade to Enterprise */}
          {(plan.status === "trialing" || plan.tier === "pro") && plan.tier !== "enterprise" && (
            <Link
              to="/app/upgrade"
              style={{
                padding: "8px 16px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500
              }}
            >
              {plan.tier === "starter" 
                ? "Unlock 10x more impressions and AI - Upgrade to Pro" 
                : "Unlock smarter AI & manual controls - Upgrade to Enterprise"}
            </Link>
          )}
        </div>
      )}

      {/* Usage Stats - Only show for plans with limits */}
      {plan && plan.usage && plan.usage.impressionsThisMonth !== undefined && (
        (() => {
          const limit = plan.tier === "starter" ? 1000 : plan.tier === "pro" ? 10000 : null;
          const usage = plan.usage.impressionsThisMonth || 0;
          const percentage = limit ? Math.min((usage / limit) * 100, 100) : 0;
          const isNearLimit = percentage >= 80;
          const isOverLimit = percentage >= 100;

          if (!limit) return null; // Don't show for unlimited plans

          // Format reset date
          const resetDate = plan.usage.resetDate ? new Date(plan.usage.resetDate) : null;
          const resetDateFormatted = resetDate ? resetDate.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
          }) : 'Unknown';

          return (
            <div style={{
              padding: 16,
              background: isOverLimit ? "#fee2e2" : isNearLimit ? "#fef3c7" : "#f0f9ff",
              border: `1px solid ${isOverLimit ? "#fca5a5" : isNearLimit ? "#fde68a" : "#bae6fd"}`,
              borderRadius: 8,
              marginBottom: 24
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 16, color: isOverLimit ? "#991b1b" : isNearLimit ? "#92400e" : "#1f2937" }}>
                  {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan • {usage.toLocaleString()} of {limit.toLocaleString()} sessions used this month
                </div>
              </div>
              <div style={{
                width: "100%",
                height: 8,
                background: "#e5e7eb",
                borderRadius: 4,
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${percentage}%`,
                  height: "100%",
                  background: isOverLimit ? "#dc2626" : isNearLimit ? "#f59e0b" : "#3b82f6",
                  transition: "width 0.3s"
                }} />
              </div>
              
              {/* Reset date - always show */}
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                Resets {resetDateFormatted} 
                <InfoTooltip content="Sessions = each time the modal is shown to a customer. Your counter resets monthly." />
              </div>

              {isOverLimit && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#991b1b" }}>
                   Monthly limit reached. {plan.tier === "starter" ? "Upgrade to Pro for 10,000 sessions/month" : "Upgrade to Enterprise for unlimited sessions"}.{" "}
                  <Link to="/app/upgrade" style={{ color: "#7c3aed", textDecoration: "underline" }}>
                    Upgrade now →
                  </Link>
                </div>
              )}
              {isNearLimit && !isOverLimit && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#92400e" }}>
                   You're at {Math.round(percentage)}% of your monthly limit.
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* Hero Revenue Card - Last 30 Days */}
      {(() => {
        const planPrice = PLAN_FEATURES[plan?.tier || 'starter']?.price || 29;
        const totalRevenue = analytics.last30Days.totalRevenue;
        const avgOrder = analytics.last30Days.conversions > 0
          ? (totalRevenue / analytics.last30Days.conversions).toFixed(2)
          : '0.00';
        const { trends } = analytics;

        // AI mode: use incremental revenue for ROI; manual: use gross revenue
        const headlineRevenue = (isAIMode && holdoutLift) ? holdoutLift.incrementalRevenue : totalRevenue;
        const roiMultiplier = planPrice > 0 ? Math.floor(headlineRevenue / planPrice) : 0;

        const TrendArrow = ({ value, suffix = "%" }) => {
          if (!trends.hasTrendData || value === null || value === undefined) {
            return <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Collecting trend data...</div>;
          }
          const isUp = value > 0;
          const isFlat = Math.abs(value) < 0.5;
          if (isFlat) {
            return <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>No change vs last week</div>;
          }
          return (
            <div style={{ fontSize: 13, marginTop: 4, color: isUp ? "#86efac" : "#fca5a5" }}>
              {isUp ? "\u25B2" : "\u25BC"} {isUp ? "+" : ""}{value.toFixed(1)}{suffix} vs last week
            </div>
          );
        };

        return (
          <div style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            padding: 40,
            borderRadius: 12,
            color: "white",
            marginBottom: 32,
            boxShadow: "0 10px 30px rgba(102, 126, 234, 0.3)"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ fontSize: 16, opacity: 0.9 }}>
                Your Performance (Last 30 Days)
                {isAIMode && (
                  <span style={{
                    marginLeft: 10,
                    padding: "3px 8px",
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600
                  }}>AI MODE</span>
                )}
              </div>
              <button
                onClick={() => window.location.reload()}
                title="Refresh data"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  opacity: 0.85,
                  lineHeight: 1
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                Refresh
              </button>
            </div>

            {/* Primary Revenue Display — mode-aware */}
            <div style={{ marginBottom: 32 }}>
              {isAIMode && holdoutLift ? (
                <>
                  {/* AI Mode: Show incremental revenue as primary, gross as secondary */}
                  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>
                    Incremental Revenue (vs no modal)
                  </div>
                  <div style={{ fontSize: 48, fontWeight: "bold", lineHeight: 1.1 }}>
                    {formatCurrency(holdoutLift.incrementalRevenue)}
                  </div>
                  <TrendArrow value={trends.revenueChange} />
                  {holdoutLift.incrementalRevenue > 0 ? (
                    <div style={{ fontSize: 16, marginTop: 8, opacity: 0.9 }}>
                      That's <strong>{roiMultiplier}x</strong> your {formatCurrency(planPrice)}/mo plan cost
                    </div>
                  ) : null}
                  <div style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 20,
                    padding: 14,
                    background: "rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    fontSize: 14
                  }}>
                    <div>
                      <div style={{ opacity: 0.7, marginBottom: 2 }}>Gross Revenue</div>
                      <div style={{ fontWeight: 600, fontSize: 18 }}>{formatCurrency(holdoutLift.grossRevenue)}</div>
                    </div>
                    <div style={{ borderLeft: "1px solid rgba(255,255,255,0.2)", paddingLeft: 20 }}>
                      <div style={{ opacity: 0.7, marginBottom: 2 }}>AI Conversion Lift</div>
                      <div style={{ fontWeight: 600, fontSize: 18, color: parseFloat(holdoutLift.liftPct) > 0 ? "#86efac" : "#fca5a5" }}>
                        {parseFloat(holdoutLift.liftPct) > 0 ? "+" : ""}{holdoutLift.liftPct}%
                      </div>
                    </div>
                    <div style={{ borderLeft: "1px solid rgba(255,255,255,0.2)", paddingLeft: 20 }}>
                      <div style={{ opacity: 0.7, marginBottom: 2 }}>Holdout Sample</div>
                      <div style={{ fontWeight: 600, fontSize: 18 }}>{holdoutLift.holdoutTotal.toLocaleString()}</div>
                    </div>
                  </div>
                  {!holdoutLift.hasEnoughData && (
                    <div style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      fontSize: 12,
                      opacity: 0.8
                    }}>
                      Holdout sample is small ({holdoutLift.holdoutTotal} visitors). Lift estimate will stabilize as more data is collected.
                    </div>
                  )}
                </>
              ) : isAIMode && !holdoutLift ? (
                <>
                  {/* AI Mode but not enough holdout data yet — show gross with caveat */}
                  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Revenue From Offer Interactions</div>
                  <div style={{ fontSize: 48, fontWeight: "bold", lineHeight: 1.1 }}>
                    {formatCurrency(totalRevenue)}
                  </div>
                  <TrendArrow value={trends.revenueChange} />
                  <div style={{
                    marginTop: 12,
                    padding: 12,
                    background: "rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    fontSize: 14
                  }}>
                    Collecting holdout data to calculate true incremental lift. This usually takes a few hundred sessions.
                  </div>
                </>
              ) : (
                <>
                  {/* Manual Mode: honest language — this is revenue from customers who interacted with the modal */}
                  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Revenue From Offer Interactions</div>
                  <div style={{ fontSize: 48, fontWeight: "bold", lineHeight: 1.1 }}>
                    {formatCurrency(totalRevenue)}
                  </div>
                  <TrendArrow value={trends.revenueChange} />
                  {totalRevenue > 0 ? (
                    <div style={{ fontSize: 16, marginTop: 8, opacity: 0.9 }}>
                      That's <strong>{roiMultiplier}x</strong> your {formatCurrency(planPrice)}/mo plan cost
                    </div>
                  ) : analytics.last30Days.impressions > 0 ? (
                    <div style={{
                      marginTop: 12,
                      padding: 12,
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: 8,
                      fontSize: 14
                    }}>
                      Just getting started? These numbers will grow as customers see your modal and make purchases.
                    </div>
                  ) : (
                    <div style={{
                      marginTop: 12,
                      padding: 12,
                      background: "rgba(255, 255, 255, 0.15)",
                      borderRadius: 8,
                      fontSize: 14
                    }}>
                      Your modal is ready! Enable it using the toggle above to start recovering revenue.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Supporting Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
              <div>
                <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Orders Created</div>
                <div style={{ fontSize: 28, fontWeight: "bold" }}>
                  {analytics.last30Days.conversions.toLocaleString()}
                </div>
                <TrendArrow value={trends.conversionsChange} />
              </div>
              <div>
                <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Success Rate</div>
                <div style={{ fontSize: 28, fontWeight: "bold" }}>
                  {analytics.last30Days.conversionRate}%
                </div>
                <TrendArrow value={trends.cvrChange} suffix=" pts" />
              </div>
              <div>
                <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Avg Order</div>
                <div style={{ fontSize: 28, fontWeight: "bold" }}>
                  ${avgOrder}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Second Row Metrics */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 24,
        marginBottom: 32
      }}>
        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{
            fontSize: 14,
            color: "#6b7280",
            marginBottom: 8
          }}>
            People Clicked
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.last30Days.clicks.toLocaleString()}
          </div>
        </div>

        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{
            fontSize: 14,
            color: "#6b7280",
            marginBottom: 8
          }}>
            Click Rate
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.last30Days.clickRate}%
          </div>
        </div>

        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{
            fontSize: 14,
            color: "#6b7280",
            marginBottom: 8
          }}>
            Times Shown
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.last30Days.impressions.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Impact Card — mode-aware */}
      {analytics.last30Days.conversions > 0 && (
        <>
          {isAIMode && holdoutLift ? (
            <>
              {/* AI Mode: Holdout-backed counterfactual */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 8,
                border: "1px solid #e5e7eb"
              }}>
                <div style={{
                  padding: 28,
                  background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
                  borderRight: "1px solid #e5e7eb"
                }}>
                  <div style={{ fontSize: 14, color: "#991b1b", marginBottom: 8, fontWeight: 500 }}>
                    Without AI Optimization
                  </div>
                  <div style={{ fontSize: 28, fontWeight: "bold", color: "#dc2626" }}>
                    {holdoutLift.holdoutCVR}%
                  </div>
                  <div style={{ fontSize: 14, color: "#991b1b", marginTop: 4 }}>
                    baseline conversion rate (holdout group)
                  </div>
                </div>
                <div style={{
                  padding: 28,
                  background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"
                }}>
                  <div style={{ fontSize: 14, color: "#166534", marginBottom: 8, fontWeight: 500 }}>
                    With AI Optimization
                  </div>
                  <div style={{ fontSize: 28, fontWeight: "bold", color: "#16a34a" }}>
                    {holdoutLift.treatmentCVR}%
                  </div>
                  <div style={{ fontSize: 14, color: "#166534", marginTop: 4 }}>
                    conversion rate ({holdoutLift.liftPct > 0 ? "+" : ""}{holdoutLift.liftPct}% lift)
                  </div>
                </div>
              </div>
              <div style={{
                textAlign: "center",
                fontSize: 14,
                color: "#6b7280",
                marginBottom: 32
              }}>
                Measured from {holdoutLift.holdoutTotal.toLocaleString()} holdout visitors vs {holdoutLift.treatmentTotal.toLocaleString()} who saw AI-optimized offers
              </div>
            </>
          ) : (
            <>
              {/* Manual Mode: Honest attribution — revenue from interactions, no causal claim */}
              <div style={{
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 8,
                border: "1px solid #e5e7eb",
                padding: 28,
                background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: "#166534", marginBottom: 8, fontWeight: 500 }}>
                      Customers Who Engaged With Your Offer
                    </div>
                    <div style={{ fontSize: 28, fontWeight: "bold", color: "#16a34a" }}>
                      {analytics.last30Days.conversions.toLocaleString()} orders — {formatCurrency(analytics.last30Days.totalRevenue)}
                    </div>
                    <div style={{ fontSize: 14, color: "#166534", marginTop: 4 }}>
                      from visitors who clicked your exit offer and completed a purchase
                    </div>
                  </div>
                  {!isAIMode && plan && plan.tier !== 'starter' && (
                    <div style={{
                      padding: "12px 16px",
                      background: "rgba(255,255,255,0.7)",
                      borderRadius: 8,
                      fontSize: 13,
                      color: "#166534",
                      maxWidth: 200,
                      lineHeight: 1.5,
                      textAlign: "center"
                    }}>
                      Enable <strong>AI mode</strong> to measure true incremental lift with a holdout group
                    </div>
                  )}
                </div>
              </div>
              <div style={{
                textAlign: "center",
                fontSize: 14,
                color: "#6b7280",
                marginBottom: 32
              }}>
                {analytics.last30Days.conversions.toLocaleString()} visitor{analytics.last30Days.conversions !== 1 ? 's' : ''} interacted with your offer and made a purchase this month
              </div>
            </>
          )}
        </>
      )}

      {/* Removed: Lifetime Analytics now on Performance page */}

{/* AI Learning Progress - Pro/Enterprise with AI Mode */}
      {plan && (plan.tier === 'pro' || plan.tier === 'enterprise') && settings && settings.mode === 'ai' && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32,
          marginBottom: 32
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: "#1f2937" }}>
              AI Learning Progress
            </div>
            <span style={{
              padding: "4px 12px",
              background: "#10b981",
              color: "white",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600
            }}>
              AI Mode Active
            </span>
          </div>

          {aiProgress ? (
            <>
              {/* Generation Progress */}
              {aiProgress.maxGeneration > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>
                    Evolved through <strong style={{ color: "#1f2937" }}>{aiProgress.maxGeneration} generation{aiProgress.maxGeneration !== 1 ? 's' : ''}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {Array.from({ length: Math.min(aiProgress.maxGeneration, 10) }).map((_, i) => (
                      <div key={i} style={{
                        width: 24,
                        height: 8,
                        borderRadius: 4,
                        background: `hsl(${260 - i * 12}, 70%, ${55 + i * 3}%)`
                      }} />
                    ))}
                    {aiProgress.maxGeneration > 10 && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginLeft: 4, alignSelf: "center" }}>
                        +{aiProgress.maxGeneration - 10} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Champion Callout */}
              {aiProgress.champion ? (
                <div style={{
                  padding: 16,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  marginBottom: 20
                }}>
                  <div style={{ fontSize: 13, color: "#166534", fontWeight: 600, marginBottom: 6 }}>
                    Current Champion
                  </div>
                  <div style={{ fontSize: 16, color: "#1f2937", fontWeight: 500, marginBottom: 4 }}>
                    "{aiProgress.champion.headline}"
                  </div>
                  <div style={{ fontSize: 14, color: "#6b7280" }}>
                    CTA: "{aiProgress.champion.cta}" — converting at <strong style={{ color: "#10b981" }}>{aiProgress.champion.cvr}%</strong>
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: 16,
                  background: "#f5f3ff",
                  border: "1px solid #ddd6fe",
                  borderRadius: 8,
                  marginBottom: 20,
                  fontSize: 14,
                  color: "#6d28d9"
                }}>
                  Finding your champion... The AI is still testing variants to identify the best performer.
                </div>
              )}

              {/* Stats Row */}
              <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
                <div style={{ fontSize: 14, color: "#6b7280" }}>
                  <strong style={{ color: "#1f2937" }}>{aiProgress.totalVariants}</strong> tested
                </div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>
                  <strong style={{ color: "#10b981" }}>{aiProgress.active}</strong> active
                </div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>
                  <strong style={{ color: "#ef4444" }}>{aiProgress.eliminated}</strong> eliminated
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 20 }}>
              Configure AI variants in Settings to start testing
            </div>
          )}

          <div style={{ display: "flex", gap: 16 }}>
            <Link
              to="/app/analytics"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              See Detailed Performance →
            </Link>
            <Link
              to="/app/settings"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                border: "1px solid #d1d5db",
                color: "#374151",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              Adjust AI Settings
            </Link>
          </div>
        </div>
      )}


      {/* Tier-Specific Upsell */}
{plan && plan.tier === "starter" && (
  <div style={{
    background: "white",
    border: "2px solid #8B5CF6",
    borderRadius: 12,
    padding: 32,
    marginBottom: 32
  }}>
    <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 16, color: "#1f2937" }}>
      AI Could Be Optimizing For You
    </div>

    {/* Blurred variant samples */}
    <div style={{ position: "relative", marginBottom: 24 }}>
      <div style={{ filter: "blur(3px)", pointerEvents: "none", opacity: 0.6 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {["Last Chance: 15% Discount", "Don't Leave Empty-Handed!", "Exclusive Offer Just For You"].map((text, i) => (
            <div key={i} style={{
              padding: "10px 16px",
              background: "#f3f4f6",
              borderRadius: 8,
              fontSize: 14,
              color: "#374151",
              border: "1px solid #e5e7eb"
            }}>
              {text}
            </div>
          ))}
        </div>
      </div>
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(139, 92, 246, 0.95)",
        color: "white",
        padding: "8px 16px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap"
      }}>
        Pro Feature
      </div>
    </div>

    {/* CVR comparison */}
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
      padding: 20,
      background: "#f9fafb",
      borderRadius: 8,
      marginBottom: 24
    }}>
      <div>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Your conversion rate</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#1f2937" }}>
          {analytics.last30Days.conversionRate}%
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>AI-optimized stores avg</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>
          3.8%
        </div>
      </div>
    </div>

    {/* Personalized CTA */}
    {analytics.last30Days.totalRevenue > 0 ? (
      <div style={{ fontSize: 15, color: "#374151", marginBottom: 20, lineHeight: 1.6 }}>
        You've recovered <strong>{formatCurrency(analytics.last30Days.totalRevenue)}</strong> so far.
        AI optimization could help you recover an estimated <strong>{formatCurrency(Math.round(analytics.last30Days.totalRevenue * 2.5))}</strong>.
      </div>
    ) : (
      <div style={{ fontSize: 15, color: "#374151", marginBottom: 20, lineHeight: 1.6 }}>
        Pro stores recover 2-3x more revenue with AI automatically testing different headlines, offers, and CTAs for each visitor.
      </div>
    )}

    <Link
      to="/app/upgrade"
      style={{
        display: "inline-block",
        padding: "12px 24px",
        background: "#8B5CF6",
        color: "white",
        textDecoration: "none",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 16
      }}
    >
      Upgrade to Pro →
    </Link>
  </div>
)}

{plan && plan.tier === "pro" && (
  <div style={{
    background: "white",
    border: "2px solid #fbbf24",
    borderRadius: 12,
    padding: 32,
    marginBottom: 32
  }}>
    <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: "#1f2937" }}>
       Maximize Results with Enterprise
    </div>
    <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>
      Get even better performance:
    </div>
    <ul style={{ marginBottom: 24, color: "#374151", lineHeight: 1.8 }}>
      <li>AI tests 10 variants at once (vs 2 on Pro)</li>
      <li>Unlimited sessions (never get cut off)</li>
      <li>Modal matches your brand colors automatically</li>
      <li>Adapts to Black Friday, holidays, busy seasons</li>
      <li>Detailed variant performance tracking</li>
      <li>Priority support</li>
    </ul>
    <Link
      to="/app/upgrade"
      style={{
        display: "inline-block",
        padding: "12px 24px",
        background: "#fbbf24",
        color: "#78350f",
        textDecoration: "none",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 16
      }}
    >
      Compare Plans →
    </Link>
  </div>
)}

{/* Revenue Timeline - Last 7 Days */}
      {analytics.dailyRevenue && analytics.dailyRevenue.length > 0 && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32,
          marginBottom: 32
        }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "#1f2937", marginBottom: 20 }}>
            Revenue Timeline (Last 7 Days)
          </div>

          {(() => {
            const daily = analytics.dailyRevenue;
            const maxRevenue = Math.max(...daily.map(d => d.revenue), 1);
            const isStarter = plan?.tier === 'starter';
            const visibleDays = isStarter ? 3 : 7;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {daily.map((day, i) => {
                  const isBlurred = isStarter && i >= visibleDays;
                  const barWidth = maxRevenue > 0 ? Math.max((day.revenue / maxRevenue) * 100, day.revenue > 0 ? 4 : 0) : 0;

                  return (
                    <div
                      key={day.date}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        filter: isBlurred ? "blur(4px)" : "none",
                        pointerEvents: isBlurred ? "none" : "auto"
                      }}
                    >
                      <div style={{ width: 36, fontSize: 13, color: "#6b7280", fontWeight: 500, flexShrink: 0 }}>
                        {day.day}
                      </div>
                      <div style={{ flex: 1, height: 24, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{
                          width: `${barWidth}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #667eea, #764ba2)",
                          borderRadius: 4,
                          transition: "width 0.3s"
                        }} />
                      </div>
                      <div style={{ width: 80, textAlign: "right", fontSize: 14, fontWeight: 600, color: day.revenue > 0 ? "#1f2937" : "#9ca3af", flexShrink: 0 }}>
                        {formatCurrency(day.revenue)}
                      </div>
                    </div>
                  );
                })}

                {isStarter && (
                  <div style={{
                    textAlign: "center",
                    marginTop: 12,
                    padding: 12,
                    background: "#f5f3ff",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "#6d28d9"
                  }}>
                    Upgrade to Pro to see your full revenue timeline{" "}
                    <Link to="/app/upgrade" style={{ color: "#8B5CF6", fontWeight: 600, textDecoration: "underline" }}>
                      Upgrade →
                    </Link>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Configure Button removed - now in modal preview header */}

      {/* Current Modal Preview */}
      {settings && (
        <div style={{
          marginTop: 32,
          padding: 24,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 0, fontSize: 20, fontWeight: 600 }}>
                Your Current Modal
              </h3>
              {settings.mode === 'ai' && modalLibrary && modalLibrary.currentModalId && (
                <span style={{
                  padding: "4px 12px",
                  background: "#8B5CF6",
                  color: "white",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}>
                  AI-Generated
                </span>
              )}
            </div>
            <Link
              to="/app/settings"
              style={{
                padding: "8px 16px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              Edit Settings
            </Link>
          </div>
          <div style={{
            background: "rgba(0, 0, 0, 0.05)",
            padding: 40,
            borderRadius: 8,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          }}>
            <div style={{
              background: "white",
              padding: 40,
              borderRadius: 12,
              maxWidth: 500,
              width: "100%",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)"
            }}>
              {(() => {
                // If AI mode, show example AI-generated copy
                if (settings.mode === 'ai') {
                  return (
                    <>
                      <h2 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>
                        Complete your order and save 15%
                      </h2>
                      <p style={{ marginBottom: 24, color: "#666", lineHeight: 1.6 }}>
                        This exclusive offer is personalized for you. Get 15% off your order when you complete checkout now.
                      </p>
                      <button style={{
                        width: "100%",
                        padding: "12px 24px",
                        background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 16,
                        fontWeight: 500,
                        cursor: "default",
                        pointerEvents: "none"
                      }}>
                        Claim My Discount
                      </button>
                      <div style={{
                        marginTop: 16,
                        padding: 12,
                        background: "#f0f9ff",
                        border: "1px solid #bae6fd",
                        borderRadius: 6,
                        fontSize: 13,
                        textAlign: "center",
                        color: "#0369a1"
                      }}>
                         AI generates unique copy and offers for each customer
                      </div>
                    </>
                  );
                }
                
                // Fallback to manual settings
                return (
                  <>
                    <h2 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>
                      {settings.modalHeadline}
                    </h2>
                    <p style={{ marginBottom: 24, color: "#666", lineHeight: 1.6 }}>
                      {settings.modalBody}
                    </p>
                    <button style={{
                      width: "100%",
                      padding: "12px 24px",
                      background: "#8B5CF6",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 16,
                      fontWeight: 500,
                      cursor: "pointer"
                    }}>
                      {settings.ctaButton}
                    </button>
                    {settings.discountCode && (
                      <div style={{
                        marginTop: 16,
                        padding: 12,
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 6,
                        fontSize: 14,
                        textAlign: "center",
                        color: "#166534"
                      }}>
                        Code: <strong>{settings.discountCode}</strong> will be auto-applied
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          
          {/* Trigger Info */}
          <div style={{ marginTop: 16, fontSize: 14, color: "#6b7280" }}>
            Shows when: Customer tries to leave page
            {plan && (plan.tier === 'pro' || plan.tier === 'enterprise') && (
              <span> • Cart page after 30s • Cart value triggers</span>
            )}
          </div>
          
          <Link
            to="/app/settings"
            style={{
              display: "inline-block",
              marginTop: 16,
              color: "#8B5CF6",
              textDecoration: "none",
              fontWeight: 500,
              fontSize: 14
            }}
          >
            Edit Modal Settings →
          </Link>
        </div>
      )}

      {/* Setup Guide */}
      {!settings && (
        <div style={{
          marginTop: 32,
          padding: 24,
          background: "#fef3c7",
          border: "1px solid #fde68a",
          borderRadius: 8
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>
             Get Started
          </h3>
          <p style={{ marginBottom: 16, color: "#92400e" }}>
            Configure your exit intent modal to start recovering abandoned carts and growing revenue.
          </p>
          <Link
            to="/app/settings"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "#8B5CF6",
              color: "white",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500
            }}
          >
            Configure Now →
          </Link>
        </div>
      )}
      </div>
    </AppLayout>
  );
}