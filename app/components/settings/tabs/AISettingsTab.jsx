import { useState } from "react";

export default function AISettingsTab({
  canUseAIMode,
  optimizationMode,
  settings,
  aggressionLevel,
  setAggressionLevel,
  setFormChanged,
  plan,
  mutationRate,
  setMutationRate,
  crossoverRate,
  setCrossoverRate,
  selectionPressure,
  setSelectionPressure
}) {
  // State for discount code mode to show/hide input fields
  const [aiDiscountCodeMode, setAiDiscountCodeMode] = useState(
    settings.aiDiscountCodeMode || "unique"
  );

  // ---- Social Proof local state (live preview + threshold status) ----
  const [spEnabled, setSpEnabled] = useState(settings.socialProofEnabled ?? true);
  const [spType, setSpType] = useState(settings.socialProofType || "orders");
  const [spMinimum, setSpMinimum] = useState(
    Number.isFinite(settings.socialProofMinimum) ? settings.socialProofMinimum : 100
  );
  const [spOrderCount, setSpOrderCount] = useState(settings.orderCount ?? null);
  const [spCustomerCount, setSpCustomerCount] = useState(settings.customerCount ?? null);
  const [spAvgRating, setSpAvgRating] = useState(settings.avgRating ?? null);
  const [spLastUpdated, setSpLastUpdated] = useState(settings.socialProofUpdatedAt ?? null);
  const [spRefreshState, setSpRefreshState] = useState("idle"); // idle | loading | success | error
  const [spRefreshMessage, setSpRefreshMessage] = useState("");

  // Round counts the same way the runtime formatter does, so the preview matches reality
  const formatRoundedCount = (count) => {
    if (!count || count < 100) return null;
    if (count < 1000) return `${Math.floor(count / 100) * 100}+`;
    if (count < 100000) return `${Math.floor(count / 1000)}k+`;
    return `${Math.floor(count / 100000) * 100}k+`;
  };

  const spCurrentValue =
    spType === "customers" ? spCustomerCount :
    spType === "reviews" ? null : // not yet wired up
    spOrderCount;

  const spMeetsThreshold =
    spType === "reviews"
      ? !!(spAvgRating && spAvgRating >= 4.0)
      : !!(spCurrentValue && spCurrentValue >= spMinimum);

  const spPreviewText = (() => {
    if (spType === "reviews") {
      if (!spAvgRating) return null;
      return `Rated ${spAvgRating.toFixed(1)}/5 by our customers`;
    }
    const rounded = formatRoundedCount(spCurrentValue);
    if (!rounded) return null;
    if (spType === "customers") return `Join ${rounded} happy customers`;
    return `Join ${rounded} orders placed`;
  })();

  const formatRelativeTime = (iso) => {
    if (!iso) return "Never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "Never";
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
    return `${Math.floor(diffSec / 86400)} day${diffSec >= 172800 ? "s" : ""} ago`;
  };

  const handleRefreshSocialProof = async () => {
    setSpRefreshState("loading");
    setSpRefreshMessage("");
    try {
      const response = await fetch("/api/admin/collect-social-proof", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        const m = data.metrics || {};
        if (typeof m.orderCount === "number") setSpOrderCount(m.orderCount);
        if (typeof m.customerCount === "number") setSpCustomerCount(m.customerCount);
        if (typeof m.avgRating === "number") setSpAvgRating(m.avgRating);
        setSpLastUpdated(new Date().toISOString());
        setSpRefreshState("success");
        setSpRefreshMessage("Metrics updated from Shopify.");
      } else {
        setSpRefreshState("error");
        setSpRefreshMessage(data.error || "Could not refresh metrics.");
      }
    } catch (error) {
      setSpRefreshState("error");
      setSpRefreshMessage(error.message || "Could not refresh metrics.");
    }
  };
  if (!canUseAIMode) {
    return (
      <div style={{
        background: 'white',
        padding: 48,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '4px 12px',
          background: '#f3f4f6',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 16,
          color: '#6b7280'
        }}>
          PRO
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>AI-Powered Optimization</h2>
        <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
          Let AI automatically test headlines, body copy, and CTAs to find what converts best. 
          Available on Pro and Enterprise plans.
        </p>
        <button
          type="button"
          onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
          style={{
            padding: '12px 24px',
            background: '#8B5CF6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Upgrade to Pro
        </button>
      </div>
    );
  }

  if (optimizationMode === "manual") {
    return (
      <div style={{
        background: 'white',
        padding: 48,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}></div>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Manual Mode Active</h2>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          You're currently in Manual Mode. Switch to AI Mode in the Quick Setup tab to access AI optimization settings.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ 
        background: "white", 
        padding: 24, 
        borderRadius: 8, 
        border: "1px solid #e5e7eb",
        marginBottom: 24 
      }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>AI Optimization Settings</h2>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
          Configure how the AI optimizes your exit intent offers
        </p>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 16 }}>
            Optimization Goal
          </label>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
            What should the AI optimize for?
          </p>
          <select
            name="aiGoal"
            defaultValue={settings.aiGoal || "revenue"}
            onChange={(e) => setFormChanged(true)}
            style={{
              width: "100%",
              padding: "12px 16px",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              fontSize: 16
            }}
          >
            <option value="revenue">Maximize Revenue (recommended)</option>
            <option value="conversions">Maximize Conversions</option>
          </select>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 16 }}>
            Discount Aggression: {aggressionLevel}
          </label>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
            How aggressive should discounts be?
          </p>
          <input
            type="range"
            name="aggression"
            min="0"
            max="10"
            value={aggressionLevel}
            onChange={(e) => { setAggressionLevel(parseInt(e.target.value)); setFormChanged(true); }}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666", marginTop: 8 }}>
            <span>Conservative (0)</span>
            <span>Moderate (5)</span>
            <span>Aggressive (10)</span>
          </div>
          {aggressionLevel === 0 && (
            <div style={{
              marginTop: 12,
              padding: 12,
              background: "#eff6ff",
              borderRadius: 6,
              fontSize: 14,
              color: "#1e40af",
              lineHeight: "1.5"
            }}>
              <strong>Note:</strong> At level 0, modals will show without discount offers - useful for announcements or cart reminders.
            </div>
          )}
        </div>

        {/* Discount Code Type - Only show if aggression > 0 */}
        {aggressionLevel > 0 && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 12, fontWeight: 500, fontSize: 16 }}>
              Discount Code Type
            </label>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="aiDiscountCodeMode"
                  value="generic"
                  checked={aiDiscountCodeMode === "generic"}
                  style={{ marginRight: 12, marginTop: 4 }}
                  onChange={(e) => { setAiDiscountCodeMode("generic"); setFormChanged(true); }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>Generic Code (Same for everyone)</div>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                    AI uses a single reusable code for all customers. Easy to track and no expiry.
                  </div>
                  {aiDiscountCodeMode === "generic" && (
                    <input
                      type="text"
                      name="aiGenericDiscountCode"
                      defaultValue={settings.aiGenericDiscountCode || ""}
                      placeholder="e.g., SAVE15"
                      maxLength="20"
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontSize: 16,
                        textTransform: "uppercase"
                      }}
                      onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setFormChanged(true); }}
                    />
                  )}
                </div>
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="aiDiscountCodeMode"
                  value="unique"
                  checked={aiDiscountCodeMode === "unique"}
                  style={{ marginRight: 12, marginTop: 4 }}
                  onChange={(e) => { setAiDiscountCodeMode("unique"); setFormChanged(true); }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>Unique Codes (One per customer)</div>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                    AI generates unique codes with 24-hour expiry. Creates urgency and prevents code sharing.
                  </div>
                  {aiDiscountCodeMode === "unique" && (
                    <div>
                      <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
                        Code Prefix (optional)
                      </label>
                      <input
                        type="text"
                        name="aiDiscountCodePrefix"
                        defaultValue={settings.aiDiscountCodePrefix || "EXIT"}
                        placeholder="EXIT"
                        maxLength="10"
                        style={{
                          padding: "8px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          fontSize: 16,
                          width: 120,
                          textTransform: "uppercase"
                        }}
                        onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setFormChanged(true); }}
                      />
                      <span style={{ marginLeft: 8, fontSize: 13, color: "#666" }}>
                        -ABC123
                      </span>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Budget Controls */}
        <div style={{ 
          padding: 20, 
          background: "#f9fafb", 
          borderRadius: 8,
          marginBottom: 24
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <input
              type="checkbox"
              name="budgetEnabled"
              defaultChecked={settings.budgetEnabled}
              onChange={(e) => setFormChanged(true)}
              style={{ marginRight: 12, width: 20, height: 20, cursor: "pointer" }}
            />
            <label style={{ fontWeight: 500, fontSize: 16, cursor: "pointer" }}>
              Enable Discount Budget Cap
            </label>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div>
              <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                Maximum Discount Budget
              </label>
              <input
                type="number"
                name="budgetAmount"
                defaultValue={settings.budgetAmount || 500}
                onChange={(e) => setFormChanged(true)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16
                }}
              />
            </div>
            
            <div>
              <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                Time Period
              </label>
              <select
                name="budgetPeriod"
                defaultValue={settings.budgetPeriod || "month"}
                onChange={(e) => setFormChanged(true)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16
                }}
              >
                <option value="week">Per Week</option>
                <option value="month">Per Month</option>
              </select>
            </div>
          </div>

          <div style={{
            marginTop: 12,
            padding: 12,
            background: "#eff6ff",
            borderRadius: 6,
            fontSize: 13,
            color: "#1e40af",
            lineHeight: "1.5"
          }}>
            <strong>Example:</strong> Setting a $500 monthly budget means the AI will stop offering discounts once $500 in total discounts have been given out. The budget resets at the start of each period.
          </div>
        </div>
      </div>

      {/* Social Proof Settings - Enterprise Only */}
      <div style={{
        background: "white",
        padding: 24,
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        marginTop: 24,
        position: 'relative',
        opacity: plan?.tier === 'enterprise' ? 1 : 0.6
      }}>
        {/* Overlay for non-Enterprise users */}
        {plan?.tier !== 'enterprise' && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(255, 255, 255, 0.9)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            cursor: 'not-allowed'
          }}>
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{
                display: 'inline-block',
                padding: '6px 16px',
                background: '#fbbf24',
                color: '#78350f',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 16
              }}>
                ENTERPRISE FEATURE
              </div>
              <h3 style={{ fontSize: 20, marginBottom: 8, color: '#1f2937' }}>
                Build Trust with Social Proof
              </h3>
              <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
                Automatically display your store's customer count, order volume, and ratings in modals to build credibility and increase conversions.
              </p>
              <button
                type="button"
                onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
                style={{
                  padding: '12px 24px',
                  background: '#8B5CF6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Upgrade to Enterprise
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Social Proof</h2>
            <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
              Show customer trust indicators in your modals
            </p>
          </div>
          {plan?.tier === 'enterprise' && (
            <span style={{
              padding: "4px 12px",
              background: "#fbbf24",
              color: "#78350f",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600
            }}>
              ENTERPRISE
            </span>
          )}
        </div>

        <div
          style={{ marginBottom: 24 }}
          aria-hidden={plan?.tier !== 'enterprise' ? 'true' : undefined}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
            <input
              id="socialProofEnabled"
              type="checkbox"
              name="socialProofEnabled"
              checked={spEnabled}
              onChange={(e) => { setSpEnabled(e.target.checked); setFormChanged(true); }}
              disabled={plan?.tier !== 'enterprise'}
              tabIndex={plan?.tier !== 'enterprise' ? -1 : 0}
              style={{ marginRight: 12, width: 20, height: 20, cursor: plan?.tier === 'enterprise' ? "pointer" : "not-allowed" }}
            />
            <label
              htmlFor="socialProofEnabled"
              style={{ fontWeight: 500, fontSize: 16, cursor: plan?.tier === 'enterprise' ? "pointer" : "not-allowed" }}
            >
              Enable social proof in modals
            </label>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="socialProofType"
              style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}
            >
              What number do you want to show shoppers?
            </label>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
              Each option shows the example phrase your modals will display.
            </p>
            <select
              id="socialProofType"
              name="socialProofType"
              value={spType}
              onChange={(e) => { setSpType(e.target.value); setFormChanged(true); }}
              disabled={plan?.tier !== 'enterprise'}
              tabIndex={plan?.tier !== 'enterprise' ? -1 : 0}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                cursor: plan?.tier === 'enterprise' ? "pointer" : "not-allowed"
              }}
            >
              <option value="orders">Number of orders — “Join 5,000+ orders placed”</option>
              <option value="customers">Number of customers — “Join 5,000+ happy customers”</option>
              <option value="reviews" disabled>Average rating — “Rated 4.8/5 by our customers” (requires Judge.me / Yotpo — coming soon)</option>
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="socialProofMinimum"
              style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}
            >
              Hide until you reach
            </label>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
              Small numbers can hurt trust more than help. We’ll keep the social proof line hidden until your metric reaches this value.
            </p>
            <input
              id="socialProofMinimum"
              type="number"
              name="socialProofMinimum"
              value={spMinimum}
              onChange={(e) => {
                const v = parseInt(e.target.value || "0", 10);
                setSpMinimum(Number.isFinite(v) ? v : 0);
                setFormChanged(true);
              }}
              min="0"
              step="10"
              disabled={plan?.tier !== 'enterprise'}
              tabIndex={plan?.tier !== 'enterprise' ? -1 : 0}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                cursor: plan?.tier === 'enterprise' ? "pointer" : "not-allowed"
              }}
            />
            {/* Threshold status: tells the merchant whether their metric currently clears the bar */}
            {spType !== "reviews" && (
              <div
                role="status"
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  background: spMeetsThreshold ? "#f0fdf4" : "#fffbeb",
                  color: spMeetsThreshold ? "#166534" : "#92400e",
                  border: `1px solid ${spMeetsThreshold ? "#bbf7d0" : "#fde68a"}`
                }}
              >
                {spCurrentValue == null ? (
                  <>No data yet — click <strong>Refresh Metrics</strong> to pull from Shopify.</>
                ) : spMeetsThreshold ? (
                  <>✓ Your current value: <strong>{spCurrentValue.toLocaleString()}</strong> {spType === "customers" ? "customers" : "orders"} — will display.</>
                ) : (
                  <>⚠ Your current value: <strong>{spCurrentValue.toLocaleString()}</strong> {spType === "customers" ? "customers" : "orders"} — below threshold, will not display.</>
                )}
              </div>
            )}
          </div>

          {/* Live preview of the exact line shoppers will see */}
          <div style={{
            marginTop: 16,
            padding: 16,
            background: "#f8fafc",
            border: "1px dashed #cbd5e1",
            borderRadius: 8
          }}>
            <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Live preview
            </div>
            {spEnabled && spPreviewText && spMeetsThreshold ? (
              <div style={{ fontSize: 16, color: "#0f172a", fontWeight: 500 }}>
                {spPreviewText}
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "#64748b", fontStyle: "italic" }}>
                {!spEnabled
                  ? "Social proof is turned off — nothing will be shown."
                  : !spPreviewText
                    ? "No metric available yet for this option."
                    : "Your metric is below the threshold — nothing will be shown."}
              </div>
            )}
          </div>

          <div style={{
            marginTop: 12,
            padding: 12,
            background: "#eff6ff",
            borderRadius: 6,
            fontSize: 13,
            color: "#1e40af",
            lineHeight: "1.5"
          }}>
            <strong>How it works:</strong> Your store metrics are pulled from Shopify automatically once a day. You can also refresh them manually below.
          </div>

          {/* Refresh row: button + last-synced timestamp + inline status (no native alerts) */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleRefreshSocialProof}
              disabled={plan?.tier !== 'enterprise' || spRefreshState === "loading"}
              tabIndex={plan?.tier !== 'enterprise' ? -1 : 0}
              style={{
                padding: '10px 16px',
                background: plan?.tier === 'enterprise' ? '#8B5CF6' : '#9ca3af',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: plan?.tier === 'enterprise' && spRefreshState !== "loading" ? 'pointer' : 'not-allowed',
                opacity: spRefreshState === "loading" ? 0.7 : 1
              }}
            >
              {spRefreshState === "loading" ? "Refreshing…" : "Refresh Metrics Now"}
            </button>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              Last updated: {formatRelativeTime(spLastUpdated)}
            </span>
          </div>
          {spRefreshState === "success" && (
            <div role="status" style={{
              marginTop: 8, padding: "8px 12px", borderRadius: 6, fontSize: 13,
              background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0"
            }}>
              ✓ {spRefreshMessage}
            </div>
          )}
          {spRefreshState === "error" && (
            <div role="alert" style={{
              marginTop: 8, padding: "8px 12px", borderRadius: 6, fontSize: 13,
              background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca"
            }}>
              Couldn’t refresh metrics: {spRefreshMessage}
            </div>
          )}
        </div>
      </div>

      {/* Control System (Pro: Locked, Enterprise: Unlocked) */}
      {(plan?.tier === 'pro' || plan?.tier === 'enterprise') && (
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginTop: 24,
          position: 'relative',
          opacity: plan?.tier === 'enterprise' ? 1 : 0.6
        }}>
          {/* Overlay for Pro users */}
          {plan?.tier === 'pro' && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(255, 255, 255, 0.9)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              cursor: 'not-allowed'
            }}>
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{
                  display: 'inline-block',
                  padding: '6px 16px',
                  background: '#fbbf24',
                  color: '#78350f',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 16
                }}>
                  ENTERPRISE FEATURE
                </div>
                <h3 style={{ fontSize: 20, marginBottom: 8, color: '#1f2937' }}>
                  Fine-Tune Your AI
                </h3>
                <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, maxWidth: 400 }}>
                  Get granular control over how your AI learns and evolves. Adjust innovation speed, learning strategy, quality standards, and test group size.
                </p>
                <button
                  type="button"
                  onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
                  style={{
                    padding: '12px 24px',
                    background: '#8B5CF6',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 16,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Upgrade to Enterprise
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 20, marginBottom: 4 }}>Control System</h2>
              <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
                Fine-tune how the AI learns and evolves
              </p>
            </div>
            <span style={{
              padding: "4px 12px",
              background: "#fbbf24",
              color: "#78350f",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600
            }}>
              ENTERPRISE
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Innovation Speed */}
            <div>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                Innovation Speed: {mutationRate}%
              </label>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                How quickly to try new ideas
              </p>
              <input
                type="range"
                name="mutationRate"
                min="0"
                max="100"
                value={mutationRate}
                onChange={(e) => { setMutationRate(parseInt(e.target.value)); setFormChanged(true); }}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                <span>Slow & Steady</span>
                <span>Fast & Bold</span>
              </div>
            </div>

            {/* Learning Strategy */}
            <div>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                Learning Strategy: {crossoverRate}%
              </label>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                Combine winners vs. start fresh with new modals
              </p>
              <input
                type="range"
                name="crossoverRate"
                min="0"
                max="100"
                value={crossoverRate}
                onChange={(e) => { setCrossoverRate(parseInt(e.target.value)); setFormChanged(true); }}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                <span>Start Fresh</span>
                <span>Combine Winners</span>
              </div>
            </div>

            {/* Quality Standards */}
            <div>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                Quality Standards: {selectionPressure}/10
              </label>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                Keep underperformers longer vs. cut quickly
              </p>
              <input
                type="range"
                name="selectionPressure"
                min="1"
                max="10"
                value={selectionPressure}
                onChange={(e) => { setSelectionPressure(parseInt(e.target.value)); setFormChanged(true); }}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                <span>Patient</span>
                <span>Ruthless</span>
              </div>
            </div>

            {/* Test Group Size */}
            <div>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                Test Group Size
              </label>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                Test more options (slower) vs. fewer (faster)
              </p>
              <select
                name="populationSize"
                defaultValue={settings.populationSize || 10}
                onChange={(e) => setFormChanged(true)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14
                }}
              >
                <option value="5">5 variants (faster learning)</option>
                <option value="10">10 variants (balanced)</option>
                <option value="15">15 variants (more exploration)</option>
                <option value="20">20 variants (maximum diversity)</option>
              </select>
            </div>
          </div>

          <div style={{
            marginTop: 20,
            padding: 12,
            background: "#eff6ff",
            borderRadius: 6,
            fontSize: 13,
            color: "#1e40af",
            lineHeight: "1.5"
          }}>
            <strong>Tip:</strong> Default settings work well for most stores. Higher innovation speed and lower quality standards = more experimentation but less stability.
          </div>
        </div>
      )}
    </>
  );
}
