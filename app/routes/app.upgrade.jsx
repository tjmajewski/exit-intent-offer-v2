import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { PLAN_FEATURES } from "../utils/featureGates";

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

  const plans = [
    {
      tier: "starter",
      name: "Starter",
      price: 29,
      description: "Perfect for small stores getting started",
      features: [
        { name: "Exit intent trigger", included: true },
        { name: "Auto-apply discount codes", included: true },
        { name: "Revenue tracking", included: true },
        { name: "Basic analytics", included: true },
        { name: "1,000 impressions/month", included: true },
        { name: "Checkout redirect only", included: true },
        { name: "Time delay triggers", included: false },
        { name: "Cart value targeting", included: false },
        { name: "Choose cart vs checkout", included: false },
        { name: "Multiple templates", included: false },
        { name: "Unlimited impressions", included: false },
        { name: "A/B testing", included: false },
        { name: "AI personalization", included: false }
      ]
    },
    {
      tier: "pro",
      name: "Pro",
      price: 79,
      description: "For growing stores that need advanced features",
      popular: true,
      features: [
        { name: "Exit intent trigger", included: true },
        { name: "Auto-apply discount codes", included: true },
        { name: "Revenue tracking", included: true },
        { name: "Basic analytics", included: true },
        { name: "Unlimited impressions", included: true },
        { name: "Time delay triggers", included: true },
        { name: "Cart value targeting", included: true },
        { name: "Choose cart vs checkout", included: true },
        { name: "Multiple templates", included: true },
        { name: "Priority support", included: true },
        { name: "A/B testing", included: false },
        { name: "AI personalization", included: false }
      ]
    },
    {
      tier: "enterprise",
      name: "Enterprise",
      price: 299,
      description: "Maximum optimization for high-volume stores",
      features: [
        { name: "Everything in Pro", included: true },
        { name: "A/B testing framework", included: true },
        { name: "AI personalization", included: true },
        { name: "Propensity modeling", included: true },
        { name: "Multiple campaigns", included: true },
        { name: "Custom templates", included: true },
        { name: "API access", included: true },
        { name: "White label", included: true },
        { name: "Dedicated support", included: true }
      ]
    }
  ];

  return (
    <div style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 36, marginBottom: 12 }}>Choose Your Plan</h1>
        <p style={{ fontSize: 18, color: "#666" }}>
          Start with any plan and upgrade anytime as your business grows
        </p>
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
                <h2 style={{ fontSize: 24, marginBottom: 8 }}>{planOption.name}</h2>
                <div style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                  {planOption.description}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
                  <span style={{ fontSize: 48, fontWeight: "bold" }}>${planOption.price}</span>
                  <span style={{ fontSize: 18, color: "#666", marginLeft: 8 }}>/month</span>
                </div>
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
                  marginBottom: 24
                }}>
                  {plan.tier === "starter" && planOption.tier === "pro" ? "Upgrade to Pro" :
                   plan.tier === "starter" && planOption.tier === "enterprise" ? "Upgrade to Enterprise" :
                   plan.tier === "pro" && planOption.tier === "enterprise" ? "Upgrade to Enterprise" :
                   "Downgrade"}
                </button>
              )}

              {/* Features List */}
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 24 }}>
                {planOption.features.map((feature, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 12,
                      opacity: feature.included ? 1 : 0.4
                    }}
                  >
                    <span style={{
                      marginRight: 12,
                      fontSize: 18,
                      color: feature.included ? "#10b981" : "#ef4444"
                    }}>
                      {feature.included ? "✓" : "✗"}
                    </span>
                    <span style={{ fontSize: 14 }}>{feature.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
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

      {/* FAQ / Notes */}
      <div style={{
        marginTop: 64,
        padding: 32,
        background: "#f9fafb",
        borderRadius: 12,
        border: "1px solid #e5e7eb"
      }}>
        <h3 style={{ fontSize: 20, marginBottom: 16 }}>Frequently Asked Questions</h3>
        
        <div style={{ marginBottom: 16 }}>
          <strong>Can I change plans anytime?</strong>
          <p style={{ color: "#666", marginTop: 4 }}>
            Yes! Upgrade or downgrade anytime. Changes take effect immediately.
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <strong>What happens if I hit my impression limit?</strong>
          <p style={{ color: "#666", marginTop: 4 }}>
            On the Starter plan, the modal will stop showing after 1,000 impressions. Upgrade to Pro for unlimited impressions.
          </p>
        </div>

        <div>
          <strong>Do you offer annual pricing?</strong>
          <p style={{ color: "#666", marginTop: 4 }}>
            Yes! Contact us for annual pricing with 2 months free.
          </p>
        </div>
      </div>
    </div>
  );
}