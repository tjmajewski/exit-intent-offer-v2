import { useFetcher, Link } from "react-router";

const STEPS = {
  starter: [
    {
      key: "themeExtension",
      label: "Install the app in your theme",
      description: "Add the Resparq app embed to your theme so the modal can appear on your storefront.",
      actionLabel: "Open Theme Editor",
      actionType: "themeEditor",
    },
    {
      key: "configureOffer",
      label: "Configure your first offer",
      description: "Set up your modal headline, copy, and discount offer in Settings.",
      actionLabel: "Go to Settings",
      actionType: "link",
      href: "/app/settings",
    },
    {
      key: "enableModal",
      label: "Enable your modal",
      description: "Toggle the modal on so it starts showing to customers.",
      actionType: "toggle",
    },
    {
      key: "firstImpression",
      label: "Get your first impression",
      description: "Once enabled, your modal will show to customers who are about to leave your store.",
      actionType: "waiting",
    },
  ],
  pro: [
    {
      key: "themeExtension",
      label: "Install the app in your theme",
      description: "Add the Resparq app embed to your theme so the modal can appear on your storefront.",
      actionLabel: "Open Theme Editor",
      actionType: "themeEditor",
    },
    {
      key: "configureAI",
      label: "Configure AI decisioning",
      description: "Set up AI mode to automatically optimize your offers for maximum revenue.",
      actionLabel: "Go to Settings",
      actionType: "link",
      href: "/app/settings",
    },
    {
      key: "enableModal",
      label: "Enable your modal",
      description: "Toggle the modal on so it starts showing to customers.",
      actionType: "toggle",
    },
    {
      key: "firstImpression",
      label: "Get your first impression",
      description: "Once enabled, your modal will show to customers who are about to leave your store.",
      actionType: "waiting",
    },
  ],
};

STEPS.enterprise = STEPS.pro;

export default function OnboardingChecklist({ completedSteps, planTier, shopDomain, onToggle }) {
  const fetcher = useFetcher();
  const steps = STEPS[planTier] || STEPS.starter;
  const completedCount = steps.filter((s) => completedSteps[s.key]).length;
  const allComplete = completedCount === steps.length;

  if (allComplete) {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
          border: "1px solid #6ee7b7",
          borderRadius: 12,
          padding: 20,
          marginBottom: 32,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 24 }}>&#10003;</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#065f46" }}>
            You're all set!
          </div>
          <div style={{ fontSize: 14, color: "#047857", marginTop: 2 }}>
            Resparq is live on your store and recovering revenue. Check your dashboard for results.
          </div>
        </div>
      </div>
    );
  }

  const handleDismiss = () => {
    fetcher.submit(
      { actionType: "onboardingAction", onboardingField: "dismissed", onboardingValue: "true" },
      { method: "post" }
    );
  };

  const handleThemeEditorClick = () => {
    fetcher.submit(
      { actionType: "onboardingAction", onboardingField: "themeEditorClicked", onboardingValue: "true" },
      { method: "post" }
    );
  };

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 24,
        marginBottom: 32,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>
            Get started with Resparq
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "#6b7280" }}>
            {completedCount} of {steps.length} complete
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            color: "#9ca3af",
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
          title="Dismiss checklist"
        >
          &times;
        </button>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 6,
          background: "#f3f4f6",
          borderRadius: 3,
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(completedCount / steps.length) * 100}%`,
            background: "linear-gradient(90deg, #8b5cf6, #a78bfa)",
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((step, index) => {
          const isComplete = completedSteps[step.key];
          const isLast = index === steps.length - 1;

          return (
            <div
              key={step.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 0",
                borderBottom: isLast ? "none" : "1px solid #f3f4f6",
              }}
            >
              {/* Check circle */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: isComplete ? "none" : "2px solid #d1d5db",
                  background: isComplete ? "#8b5cf6" : "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                  transition: "all 0.2s",
                }}
              >
                {isComplete && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: isComplete ? "#9ca3af" : "#111827",
                    textDecoration: isComplete ? "line-through" : "none",
                  }}
                >
                  {step.label}
                </div>
                {!isComplete && (
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                    {step.description}
                  </div>
                )}
              </div>

              {/* Action */}
              {!isComplete && step.actionType === "themeEditor" && (
                <a
                  href={`https://${shopDomain}/admin/themes/current/editor?context=apps`}
                  target="_top"
                  rel="noreferrer"
                  onClick={handleThemeEditorClick}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#8b5cf6",
                    color: "white",
                    padding: "6px 14px",
                    borderRadius: 6,
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {step.actionLabel} &rarr;
                </a>
              )}
              {!isComplete && step.actionType === "link" && (
                <Link
                  to={step.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#8b5cf6",
                    color: "white",
                    padding: "6px 14px",
                    borderRadius: 6,
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {step.actionLabel} &rarr;
                </Link>
              )}
              {!isComplete && step.actionType === "toggle" && (
                <button
                  type="button"
                  onClick={onToggle}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#8b5cf6",
                    color: "white",
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Enable now
                </button>
              )}
              {!isComplete && step.actionType === "waiting" && (
                <span
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    fontStyle: "italic",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Waiting...
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
