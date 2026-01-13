import { useLoaderData, Link } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { PLAN_FEATURES } from "../utils/featureGates";
import AppLayout from "../components/AppLayout";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : { tier: "starter" };

    return { plan };
  } catch (error) {
    console.error("Error loading upgrade page:", error);
    return { plan: { tier: "starter" } };
  }
}

export default function Upgrade() {
  const { plan } = useLoaderData();
  const [billingCycle, setBillingCycle] = useState("annual");

  const plans = [
    {
      tier: "starter",
      name: "Starter",
      monthlyPrice: 29,
      annualPrice: 25,
      monthlyValue: 29,
      annualValue: 300,
      savings: 48,
      description: "Perfect for testing exit intent",
      features: [
        { name: "Manual mode (you set fixed offers)", included: true },
        { name: "Up to 5,000 impressions/month", included: true },
        { name: "1 campaign", included: true },
        { name: "Basic analytics (impressions, clicks, conversions)", included: true },
        { name: "Mobile-optimized modals", included: true },
        { name: "Auto-apply discount codes", included: true },
        { name: "Email support", included: true },
        { name: "AI autopilot mode", included: false },
        { name: "Automated A/B testing", included: false },
        { name: "Advanced analytics", included: false },
        { name: "Unlimited impressions", included: false }
      ]
    },
    {
      tier: "pro",
      name: "Pro",
      monthlyPrice: 79,
      annualPrice: 67,
      monthlyValue: 79,
      annualValue: 804,
      savings: 144,
      description: "AI-powered optimization for growing stores",
      popular: true,
      features: [
        { name: "Everything in Starter", included: true },
        { name: "AI autopilot mode (8 customer signals)", included: true },
        { name: "Up to 10,000 impressions/month", included: true },
        { name: "Evolution system (auto-improves variants)", included: true },
        { name: "Automated A/B testing", included: true },
        { name: "Multiple campaigns", included: true },
        { name: "Advanced analytics (revenue tracking, variant performance)", included: true },
        { name: "Date filtering (7d/30d/all time)", included: true },
        { name: "Cart abandonment recovery tracking", included: true },
        { name: "Priority email support", included: true },
        { name: "Smarter AI (13 signals)", included: false },
        { name: "Manual variant control", included: false },
        { name: "Unlimited impressions", included: false }
      ]
    },
    {
      tier: "enterprise",
      name: "Enterprise",
      monthlyPrice: 249,
      annualPrice: 212,
      monthlyValue: 249,
      annualValue: 2544,
      savings: 444,
      description: "Maximum control for high-volume stores",
      features: [
        { name: "Everything in Pro", included: true },
        { name: "Unlimited impressions", included: true },
        { name: "Smarter AI (13 customer signals vs 8)", included: true },
        { name: "Override AI decisions (manual variant control)", included: true },
        { name: "Promotional intelligence (auto-detects sales)", included: true },
        { name: "Custom CSS styling", included: true },
        { name: "White-label (remove 'Powered by' badge)", included: true },
        { name: "Enterprise analytics (segment breakdown, export CSV)", included: true },
        { name: "Generation tracking (see AI evolution)", included: true },
        { name: "Priority email support", included: true }
      ]
    }
  ];

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, marginBottom: 12, color: "#1f2937" }}>Choose Your Plan</h1>
          <p style={{ fontSize: 18, color: "#666", marginBottom: 32 }}>
            Exit intent modals that drive sales, not signups
          </p>

          {/* Billing Toggle */}
          <div style={{ 
            display: "inline-flex", 
            background: "#f3f4f6", 
            borderRadius: 8, 
            padding: 4,
            gap: 4
          }}>
            <button
              onClick={() => setBillingCycle("monthly")}
              style={{
                padding: "8px 24px",
                background: billingCycle === "monthly" ? "white" : "transparent",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                color: billingCycle === "monthly" ? "#1f2937" : "#6b7280",
                boxShadow: billingCycle === "monthly" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.2s"
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              style={{
                padding: "8px 24px",
                background: billingCycle === "annual" ? "white" : "transparent",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                color: billingCycle === "annual" ? "#1f2937" : "#6b7280",
                boxShadow: billingCycle === "annual" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.2s",
                position: "relative"
              }}
            >
              Annual
              <span style={{
                position: "absolute",
                top: -8,
                right: -8,
                background: "#10b981",
                color: "white",
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                fontWeight: 700
              }}>
                SAVE 15%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Comparison Grid */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(3, 1fr)", 
          gap: 24,
          marginBottom: 40
        }}>
          {plans.map((planOption) => {
            const isCurrent = plan.tier === planOption.tier;
            const isPopular = planOption.popular;
            const displayPrice = billingCycle === "monthly" ? planOption.monthlyPrice : planOption.annualPrice;
            const showSavings = billingCycle === "annual" && planOption.savings;

            return (
              <div
                key={planOption.tier}
                style={{
                  background: "white",
                  border: isPopular ? "3px solid #8B5CF6" : "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 32,
                  position: "relative",
                  boxShadow: isPopular ? "0 8px 24px rgba(139, 92, 246, 0.2)" : "none"
                }}
              >
                {/* Popular Badge */}
                {isPopular && (
                  <div style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#8B5CF6",
                    color: "white",
                    padding: "4px 16px",
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    MOST POPULAR
                  </div>
                )}

                {/* Current Plan Badge */}
                {isCurrent && (
                  <div style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    background: "#10b981",
                    color: "white",
                    padding: "4px 12px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    CURRENT PLAN
                  </div>
                )}

                {/* Plan Header */}
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 24, marginBottom: 8, color: "#1f2937" }}>{planOption.name}</h2>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                    {planOption.description}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 48, fontWeight: "bold", color: "#1f2937" }}>${displayPrice}</span>
                    <span style={{ fontSize: 18, color: "#666", marginLeft: 8 }}>/month</span>
                  </div>
                  {showSavings && (
                    <div style={{ 
                      fontSize: 14, 
                      color: "#10b981", 
                      fontWeight: 600 
                    }}>
                      Save ${planOption.savings}/year
                    </div>
                  )}
                  {billingCycle === "annual" && planOption.annualValue > 0 && (
                    <div style={{ 
                      fontSize: 12, 
                      color: "#9ca3af", 
                      marginTop: 4 
                    }}>
                      ${planOption.annualValue} billed annually
                    </div>
                  )}
                </div>

                {/* CTA Button */}
                {isCurrent ? (
                  <div style={{
                    width: "100%",
                    padding: "12px 0",
                    background: "#f3f4f6",
                    color: "#6b7280",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 16,
                    fontWeight: 600,
                    textAlign: "center",
                    marginBottom: 24,
                    boxSizing: "border-box"
                  }}>
                    Current Plan
                  </div>
                ) : (
                  <button style={{
                    width: "100%",
                    padding: "12px 24px",
                    background: isPopular ? "#8B5CF6" : "#f3f4f6",
                    color: isPopular ? "white" : "#374151",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginBottom: 24,
                    transition: "all 0.2s"
                  }}
                  onMouseOver={(e) => {
                    if (isPopular) {
                      e.target.style.background = "#7C3AED";
                    } else {
                      e.target.style.background = "#e5e7eb";
                    }
                  }}
                  onMouseOut={(e) => {
                    e.target.style.background = isPopular ? "#8B5CF6" : "#f3f4f6";
                  }}
                  >
                    {plan.tier === "starter" && planOption.tier === "pro" ? "Upgrade to Pro" :
                     plan.tier === "starter" && planOption.tier === "enterprise" ? "Upgrade to Enterprise" :
                     plan.tier === "pro" && planOption.tier === "enterprise" ? "Upgrade to Enterprise" :
                     planOption.tier === "starter" ? "Downgrade to Starter" : "Select Plan"}
                  </button>
                )}

                {/* Features List */}
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 24 }}>
                  {planOption.features.map((feature, index) => (
                    <div
                      key={index}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        marginBottom: 12,
                        opacity: feature.included ? 1 : 0.4
                      }}
                    >
                      <span style={{
                        marginRight: 12,
                        fontSize: 18,
                        color: feature.included ? "#10b981" : "#ef4444",
                        flexShrink: 0,
                        marginTop: -2
                      }}>
                        {feature.included ? "✓" : "✗"}
                      </span>
                      <span style={{ fontSize: 14, lineHeight: "1.5", color: "#374151" }}>{feature.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 14-Day Money-Back Guarantee */}
        <div style={{
          marginTop: 48,
          padding: 24,
          background: "#f0fdf4",
          borderRadius: 12,
          border: "2px solid #10b981",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}></div>
          <h3 style={{ fontSize: 20, marginBottom: 8, color: "#166534" }}>14-Day Money-Back Guarantee</h3>
          <p style={{ fontSize: 16, color: "#166534", margin: 0 }}>
            Not satisfied? Get a full refund, no questions asked.
          </p>
        </div>

        {/* Value Proposition */}
        <div style={{
          marginTop: 48,
          padding: 32,
          background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
          borderRadius: 12,
          color: "white",
          textAlign: "center"
        }}>
          <h3 style={{ fontSize: 24, marginBottom: 16, color: "white" }}>Why ResparQ?</h3>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)", 
            gap: 32,
            marginTop: 32
          }}>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}></div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Performance-First</div>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                Focused on sales, not email signups. Auto-applied discounts convert instantly.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}></div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>AI That Learns</div>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                Evolution system auto-generates variants and improves over time.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}></div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Simple Pricing</div>
              <div style={{ fontSize: 14, opacity: 0.9 }}>
                Flat monthly pricing. No surprises, no hidden fees.
              </div>
            </div>
          </div>
        </div>

        {/* Back to Dashboard */}
        <div style={{ textAlign: "center", marginTop: 48 }}>
          <Link
            to="/app"
            style={{
              color: "#8B5CF6",
              textDecoration: "none",
              fontSize: 16,
              fontWeight: 500
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* FAQ */}
        <div style={{
          marginTop: 64,
          padding: 32,
          background: "#f9fafb",
          borderRadius: 12,
          border: "1px solid #e5e7eb"
        }}>
          <h3 style={{ fontSize: 20, marginBottom: 24, color: "#1f2937" }}>Frequently Asked Questions</h3>
          
          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#1f2937" }}>Can I change plans anytime?</strong>
            <p style={{ color: "#666", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              Yes! Upgrade or downgrade anytime. Pro-rated charges apply. Changes take effect immediately.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#1f2937" }}>What happens if I hit my impression limit?</strong>
            <p style={{ color: "#666", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              On Starter (5K) and Pro (10K) plans, the modal will stop showing after you hit the limit. Upgrade to Enterprise for unlimited impressions.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#1f2937" }}>How does annual billing work?</strong>
            <p style={{ color: "#666", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              Pay for 12 months upfront and save 15% (approximately 2 months free). Annual plans are billed once per year.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#1f2937" }}>What's the difference between AI autopilot and manual control?</strong>
            <p style={{ color: "#666", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              AI autopilot (Pro) lets the AI handle everything automatically. Enterprise adds manual controls so you can override AI decisions when you need to (like during sales or special events).
            </p>
          </div>

          <div>
            <strong style={{ fontSize: 16, color: "#1f2937" }}>What's your refund policy?</strong>
            <p style={{ color: "#666", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              We offer a 14-day money-back guarantee on all plans. If you're not satisfied for any reason, contact us for a full refund.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}