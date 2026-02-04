import { useLoaderData, Link, Form, redirect, useFetcher, useNavigate } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getDefaultModalLibrary } from "../utils/modalHash";
import AppLayout from "../components/AppLayout";
import db from "../db.server";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const action = formData.get("action");
    console.log('Action received:', action);
    
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
          data: { 
            status: 'alive',
            isChampion: false
          }
        });
        return { success: true, message: 'Variant set to Active' };
      }
      
      if (newStatus === 'protected') {
        await db.variant.update({
          where: { id: variantId },
          data: { 
            status: 'protected',
            isChampion: false
          }
        });
        return { success: true, message: 'Variant protected from elimination' };
      }
      
      if (newStatus === 'champion') {
        // Mark this variant as champion and all others in same baseline as non-champion
        await db.variant.updateMany({
          where: { 
            shopId: variant.shopId,
            baseline: variant.baseline,
            segment: variant.segment
          },
          data: { isChampion: false }
        });
        
        await db.variant.update({
          where: { id: variantId },
          data: { 
            status: 'champion',
            isChampion: true
          }
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
        }
      }
    `);

    const data = await response.json();
    
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : { tier: "starter" };

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

    console.log('Loader returning variants:', liveVariants?.length || 0);
    return { plan, modalLibrary, dateRange, liveVariants };
  } catch (error) {
    console.error("Error loading analytics:", error);
    return { 
      plan: { tier: "starter" },
      modalLibrary: getDefaultModalLibrary(),
      liveVariants: []
    };
  }
}


export default function Performance() {
  const { plan, modalLibrary, dateRange: loaderDateRange, liveVariants } = useLoaderData();
  const fetcher = useFetcher();
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
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Orders</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {paginatedModals.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
                  No modals created yet. Save your first modal in Settings to start tracking performance.
                </td>
              </tr>
            ) : (
              paginatedModals.map((modal) => {
                return (
                  <tr 
                    key={modal.modalId}
                    style={{ 
                      borderBottom: "1px solid #e5e7eb",
                      background: modal.active ? "#f0f9ff" : "white"
                    }}
                  >
                    <td style={{ padding: 16, fontWeight: 500 }}>
                      {modal.modalName}
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
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.impressions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.clicks.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.conversions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: "#10b981" }}>
                      ${modal.stats.revenue.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      
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
                          background: variant.isChampion ? "#f0fdf4" : variant.status === 'protected' ? "#fef3c7" : "white"
                        }}
                      >
                        <td style={{ padding: 16 }}>
                          <div style={{ fontWeight: 500, marginBottom: 4 }}>
                            {variant.variantId}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Gen {variant.generation} · {variant.baseline}
                          </div>
                          {variant.isChampion && (
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
                                  defaultValue={variant.isChampion ? 'champion' : variant.status}
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