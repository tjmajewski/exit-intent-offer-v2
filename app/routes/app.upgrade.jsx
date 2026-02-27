import { useLoaderData, useActionData, Link, Form, useNavigation } from "react-router";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { PLAN_FEATURES } from "../utils/featureGates";
import AppLayout from "../components/AppLayout";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const { getActiveSubscription } = await import("../utils/billing.server");

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

    // Check active Shopify subscription
    let activeSubscription = null;
    try {
      activeSubscription = await getActiveSubscription(admin);
    } catch (e) {
      console.error("Error checking subscription:", e);
    }

    // Calculate remaining trial days for the CTA text
    let trialDaysRemaining = 0;
    if (plan.hasUsedTrial && plan.trialStartedAt) {
      const daysSinceTrialStart = Math.floor(
        (Date.now() - new Date(plan.trialStartedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      trialDaysRemaining = Math.max(0, 14 - daysSinceTrialStart);
    } else if (!plan.hasUsedTrial && !activeSubscription) {
      trialDaysRemaining = 14;
    }

    return { plan, activeSubscription, trialDaysRemaining };
  } catch (error) {
    console.error("Error loading upgrade page:", error);
    return { plan: { tier: "starter" }, activeSubscription: null, trialDaysRemaining: 14 };
  }
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { createSubscription, getActiveSubscription } = await import("../utils/billing.server");
  const formData = await request.formData();
  const tier = formData.get("tier");
  const billingCycle = formData.get("billingCycle");

  if (!["starter", "pro", "enterprise"].includes(tier)) {
    return { error: "Invalid plan tier" };
  }

  try {
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const returnUrl = `${appUrl}/app/billing-callback?tier=${tier}&cycle=${billingCycle}`;

    // test: true for development, set to false for production
    const isTest = process.env.NODE_ENV !== "production";

    // Determine how many trial days this subscription should get:
    // - Never trialed: 14 days
    // - Mid-trial plan switch: remaining days from original trial
    // - Trial expired: 0 days
    let trialDays = 0;
    try {
      const planResponse = await admin.graphql(`
        query {
          shop {
            plan: metafield(namespace: "exit_intent", key: "plan") {
              value
            }
          }
        }
      `);
      const planData = await planResponse.json();
      const currentPlan = planData.data.shop?.plan?.value
        ? JSON.parse(planData.data.shop.plan.value)
        : null;

      if (currentPlan?.hasUsedTrial && currentPlan?.trialStartedAt) {
        // They've started a trial before — check if it's still active
        const daysSinceTrialStart = Math.floor(
          (Date.now() - new Date(currentPlan.trialStartedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        trialDays = Math.max(0, 14 - daysSinceTrialStart);
      } else if (!currentPlan?.hasUsedTrial) {
        // Check if they have an active subscription (edge case: flag not set yet)
        const activeSub = await getActiveSubscription(admin);
        if (!activeSub) {
          trialDays = 14;
        }
      }
    } catch (e) {
      console.error("[Billing] Error checking trial status:", e);
    }

    const { confirmationUrl } = await createSubscription(
      admin,
      tier,
      billingCycle,
      returnUrl,
      isTest,
      trialDays
    );

    // Return URL to client — client redirects via _top to escape iframe
    return { confirmationUrl };
  } catch (error) {
    console.error("[Billing] Error creating subscription:", error);
    return { error: error.message };
  }
}

export default function Upgrade() {
  const { plan, activeSubscription, trialDaysRemaining } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingTier = isSubmitting ? navigation.formData?.get("tier") : null;
  const [billingCycle, setBillingCycle] = useState("monthly");

  // Redirect to Shopify billing approval page (must break out of iframe)
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData]);

  const plans = [
    {
      tier: "starter",
      name: "Starter",
      monthlyPrice: 29,
      annualPrice: 24.65,
      annualTotal: 296,
      revenueShare: "5%",
      description: "Perfect for testing exit intent",
      features: [
        "Manual mode (you set what appears and when)",
        "Up to 1,000 impressions/month",
        "1 campaign",
        "Basic analytics (impressions, clicks, conversions)",
        "Mobile-optimized modals",
        "Auto-apply discount codes",
        "Email support"
      ]
    },
    {
      tier: "pro",
      name: "Pro",
      monthlyPrice: 79,
      annualPrice: 67.15,
      annualTotal: 806,
      revenueShare: "2%",
      description: "AI-powered optimization for growing stores",
      popular: true,
      features: [
        "Everything in Starter",
        "AI mode",
        "Up to 10,000 impressions/month",
        "Evolution system (auto-improves variants)",
        "Automated A/B testing",
        "Multiple campaigns",
        "Advanced analytics (revenue tracking, variant performance)",
        "Date filtering (7d/30d/all time)",
        "Cart abandonment recovery tracking",
        "Priority email support"
      ]
    },
    {
      tier: "enterprise",
      name: "Enterprise",
      monthlyPrice: 199,
      annualPrice: 169.15,
      annualTotal: 2030,
      revenueShare: "1%",
      description: "Maximum control for high-volume stores",
      features: [
        "Everything in Pro",
        "Unlimited impressions",
        "Advanced AI (deeper personalization)",
        "Override AI decisions (manual variant control)",
        "Promotional intelligence (auto-detects sales)",
        "Custom CSS styling",
        "White-label (remove \"Powered by\" badge)",
        "Enterprise analytics (segment breakdown, export CSV)",
        "Generation tracking (see AI evolution)",
        "Priority email support"
      ]
    }
  ];

  return (
    <AppLayout plan={plan}>
      <div style={{
        padding: 40,
        maxWidth: 1400,
        margin: "0 auto",
        background: "linear-gradient(180deg, #0f0a1f 0%, #1a0f2e 50%, #0f0a1f 100%)",
        minHeight: "100vh"
      }}>
        {/* Free Trial Banner */}
        <div style={{
          background: "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.15) 100%)",
          border: "1px solid rgba(16,185,129,0.4)",
          borderRadius: 12,
          padding: "16px 24px",
          marginBottom: 32,
          textAlign: "center"
        }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🎉</div>
          <div style={{ color: "#10b981", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
            14-Day Free Trial Included on All Plans
          </div>
          <div style={{ color: "#6ee7b7", fontSize: 14 }}>
            Try any plan free for 14 days — no charge until your trial ends. Cancel anytime.
          </div>
        </div>

        {/* Billing Toggle */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 16,
          marginBottom: 48
        }}>
          <span style={{
            fontSize: 14,
            color: billingCycle === "monthly" ? "#fff" : "#9ca3af",
            fontWeight: billingCycle === "monthly" ? 600 : 400
          }}>
            Monthly
          </span>
          <button
            onClick={() => setBillingCycle(billingCycle === "monthly" ? "annual" : "monthly")}
            style={{
              width: 56,
              height: 28,
              borderRadius: 14,
              background: billingCycle === "annual"
                ? "linear-gradient(90deg, #8B5CF6 0%, #a78bfa 100%)"
                : "#374151",
              border: "none",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.3s"
            }}
          >
            <div style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#fff",
              position: "absolute",
              top: 3,
              left: billingCycle === "annual" ? 31 : 3,
              transition: "left 0.3s"
            }} />
          </button>
          <span style={{
            fontSize: 14,
            color: billingCycle === "annual" ? "#fff" : "#9ca3af",
            fontWeight: billingCycle === "annual" ? 600 : 400
          }}>
            Annual
          </span>
          <span style={{
            background: "#10b981",
            color: "white",
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 12,
            fontWeight: 600
          }}>
            Save 15%
          </span>
        </div>

        {/* Plan Cards Grid */}
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

            return (
              <div
                key={planOption.tier}
                style={{
                  background: "linear-gradient(180deg, rgba(30, 20, 50, 0.9) 0%, rgba(20, 15, 35, 0.95) 100%)",
                  border: "1px solid rgba(139, 92, 246, 0.3)",
                  borderRadius: 16,
                  padding: 32,
                  position: "relative",
                  boxShadow: isPopular
                    ? "0 0 40px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)"
                    : "inset 0 1px 0 rgba(255,255,255,0.05)"
                }}
              >
                {/* Popular Badge */}
                {isPopular && (
                  <div style={{
                    position: "absolute",
                    top: -14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "linear-gradient(90deg, #8B5CF6 0%, #a78bfa 100%)",
                    color: "white",
                    padding: "6px 20px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                  }}>
                    Most Popular
                  </div>
                )}

                {/* Plan Header */}
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{
                    fontSize: 24,
                    marginBottom: 8,
                    color: "#fff",
                    fontWeight: 600
                  }}>
                    {planOption.name}
                  </h2>
                  <div style={{
                    fontSize: 14,
                    color: "#9ca3af",
                    marginBottom: 20
                  }}>
                    {planOption.description}
                  </div>

                  {/* Price */}
                  <div style={{ marginBottom: 8 }}>
                    <span style={{
                      fontSize: 48,
                      fontWeight: "bold",
                      color: "#ec4899",
                      background: "linear-gradient(90deg, #ec4899 0%, #f472b6 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent"
                    }}>
                      ${displayPrice.toFixed(2).replace(/\.00$/, '')}
                    </span>
                    <span style={{
                      fontSize: 16,
                      color: "#9ca3af"
                    }}>
                      /mo
                    </span>
                  </div>

                  {/* Revenue Share */}
                  <div style={{
                    fontSize: 14,
                    color: "#10b981",
                    fontWeight: 500,
                    marginBottom: 8
                  }}>
                    + {planOption.revenueShare} of recovered revenue
                  </div>

                  {/* Annual Total */}
                  {billingCycle === "annual" && (
                    <div style={{
                      fontSize: 13,
                      color: "#6b7280"
                    }}>
                      ${planOption.annualTotal.toLocaleString()}/year (save 15%)
                    </div>
                  )}
                </div>

                {/* CTA Button */}
                {isCurrent ? (
                  <div style={{
                    width: "100%",
                    padding: "14px 0",
                    background: "rgba(139, 92, 246, 0.2)",
                    color: "#a78bfa",
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                    borderRadius: 8,
                    fontSize: 16,
                    fontWeight: 600,
                    textAlign: "center",
                    marginBottom: 28,
                    boxSizing: "border-box"
                  }}>
                    Current Plan
                  </div>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="tier" value={planOption.tier} />
                    <input type="hidden" name="billingCycle" value={billingCycle} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        width: "100%",
                        padding: "14px 24px",
                        background: isSubmitting && submittingTier === planOption.tier
                          ? "#6b7280"
                          : "linear-gradient(90deg, #8B5CF6 0%, #a78bfa 100%)",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 16,
                        fontWeight: 600,
                        cursor: isSubmitting ? "wait" : "pointer",
                        marginBottom: 28,
                        transition: "all 0.2s",
                        boxShadow: isSubmitting ? "none" : "0 4px 15px rgba(139, 92, 246, 0.3)",
                        opacity: isSubmitting && submittingTier !== planOption.tier ? 0.5 : 1
                      }}
                      onMouseOver={(e) => {
                        if (!isSubmitting) {
                          e.target.style.transform = "translateY(-1px)";
                          e.target.style.boxShadow = "0 6px 20px rgba(139, 92, 246, 0.4)";
                        }
                      }}
                      onMouseOut={(e) => {
                        e.target.style.transform = "translateY(0)";
                        e.target.style.boxShadow = isSubmitting ? "none" : "0 4px 15px rgba(139, 92, 246, 0.3)";
                      }}
                    >
                      {isSubmitting && submittingTier === planOption.tier
                        ? "Redirecting to Shopify..."
                        : trialDaysRemaining === 14
                          ? "Start Free Trial"
                          : trialDaysRemaining > 0
                            ? `Switch Plan (${trialDaysRemaining} days left in trial)`
                            : "Subscribe"}
                    </button>
                  </Form>
                )}

                {/* Features List */}
                <div>
                  {planOption.features.map((feature, index) => (
                    <div
                      key={index}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        marginBottom: 14,
                        gap: 12
                      }}
                    >
                      <span style={{
                        color: "#10b981",
                        fontSize: 16,
                        flexShrink: 0,
                        marginTop: 1
                      }}>
                        ✓
                      </span>
                      <span style={{
                        fontSize: 14,
                        lineHeight: "1.5",
                        color: "#d1d5db"
                      }}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Recovered Revenue Explanation */}
        <div style={{
          padding: 24,
          background: "rgba(30, 20, 50, 0.6)",
          borderRadius: 12,
          border: "1px solid rgba(139, 92, 246, 0.25)",
          marginBottom: 24
        }}>
          <h3 style={{ fontSize: 16, color: "#fff", marginBottom: 12, fontWeight: 600 }}>
            How usage charges work
          </h3>
          <p style={{ color: "#9ca3af", fontSize: 14, lineHeight: "1.7", margin: 0 }}>
            In addition to your flat monthly/annual subscription, a small usage-based commission applies only to
            orders where a customer used a ResparQ-generated discount code (i.e., revenue that was recovered by the app).
            Commission rates: <strong style={{ color: "#d1d5db" }}>5% on Starter</strong>,{" "}
            <strong style={{ color: "#d1d5db" }}>2% on Pro</strong>, and{" "}
            <strong style={{ color: "#d1d5db" }}>1% on Enterprise</strong>.
            Monthly caps ($500/$2,000/$5,000) ensure charges never exceed the limits shown above.
            These charges are billed automatically through Shopify&apos;s billing system — no separate invoicing.
          </p>
        </div>

        {/* 14-Day Money-Back Guarantee */}
        <div style={{
          marginTop: 48,
          padding: 24,
          background: "rgba(16, 185, 129, 0.1)",
          borderRadius: 12,
          border: "1px solid rgba(16, 185, 129, 0.3)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
          <h3 style={{ fontSize: 20, marginBottom: 8, color: "#10b981" }}>14-Day Money-Back Guarantee</h3>
          <p style={{ fontSize: 16, color: "#6ee7b7", margin: 0 }}>
            Not satisfied? Get a full refund, no questions asked.
          </p>
        </div>

        {/* Value Proposition */}
        <div style={{
          marginTop: 48,
          padding: 32,
          background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(124, 58, 237, 0.2) 100%)",
          borderRadius: 12,
          border: "1px solid rgba(139, 92, 246, 0.3)",
          textAlign: "center"
        }}>
          <h3 style={{ fontSize: 24, marginBottom: 16, color: "#fff" }}>Why ResparQ?</h3>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 32,
            marginTop: 32
          }}>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎯</div>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>Performance-First</div>
              <div style={{ fontSize: 14, color: "#a78bfa" }}>
                Focused on sales, not email signups. Auto-applied discounts convert instantly.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🧠</div>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>AI That Learns</div>
              <div style={{ fontSize: 14, color: "#a78bfa" }}>
                Evolution system auto-generates variants and improves over time.
              </div>
            </div>
            <div>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>Simple Pricing</div>
              <div style={{ fontSize: 14, color: "#a78bfa" }}>
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
              color: "#a78bfa",
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
          background: "rgba(30, 20, 50, 0.5)",
          borderRadius: 12,
          border: "1px solid rgba(139, 92, 246, 0.2)"
        }}>
          <h3 style={{ fontSize: 20, marginBottom: 24, color: "#fff" }}>Frequently Asked Questions</h3>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#fff" }}>Can I change plans anytime?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              Yes! Upgrade or downgrade anytime. Pro-rated charges apply. Changes take effect immediately.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#fff" }}>What happens if I hit my impression limit?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              On Starter (1K) and Pro (10K) plans, the modal will stop showing after you hit the limit. Upgrade to Enterprise for unlimited impressions.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#fff" }}>How does annual billing work?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              Pay for 12 months upfront and save 15% (approximately 2 months free). Annual plans are billed once per year.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#fff" }}>What's the difference between AI mode and manual control?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              AI mode (Pro) lets the AI handle everything automatically. Enterprise adds manual controls so you can override AI decisions when you need to (like during sales or special events).
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 16, color: "#fff" }}>What does "% of recovered revenue" mean?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              &ldquo;Recovered revenue&rdquo; refers to the total order value of purchases where a customer used a
              ResparQ-generated discount code at checkout — meaning the app directly helped convert that sale.
              The percentage commission (5%, 2%, or 1% depending on your plan) is charged only on those specific orders,
              not on your overall store revenue. These usage charges are billed monthly through Shopify&apos;s billing system,
              subject to the monthly cap for your plan.
            </p>
          </div>

          <div>
            <strong style={{ fontSize: 16, color: "#fff" }}>What's your refund policy?</strong>
            <p style={{ color: "#9ca3af", marginTop: 8, lineHeight: "1.6", marginBottom: 0 }}>
              We offer a 14-day money-back guarantee on all plans. If you're not satisfied for any reason, contact us for a full refund.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
