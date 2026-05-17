import { useEffect } from "react";

export default function SettingsPreview({
  variant = "modal",
  isOpen,
  onClose,
  optimizationMode,
  modalHeadline,
  modalBody,
  ctaButton,
  discountEnabled,
  offerType,
  discountPercentage,
  discountAmount,
  exitIntentEnabled,
  timeDelayEnabled,
  timeDelaySeconds,
  cartValueEnabled,
  cartValueMin,
  cartValueMax,
  brandPrimaryColor,
  brandSecondaryColor,
  brandAccentColor,
  brandFont,
  customCSS
}) {
  const active = variant === "inline" ? true : !!isOpen;

  useEffect(() => {
    if (!active || !customCSS) return;

    const styleId = 'settings-preview-custom-css';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = customCSS;
    document.head.appendChild(style);

    return () => {
      const styleToRemove = document.getElementById(styleId);
      if (styleToRemove) styleToRemove.remove();
    };
  }, [active, customCSS]);

  if (variant === "modal" && !isOpen) return null;

  const isAIMode = optimizationMode === 'ai';
  const displayHeadline = isAIMode
    ? "AI will generate optimized copy"
    : (modalHeadline || "Wait! Don't leave yet ");
  const displayBody = isAIMode
    ? "The AI will test different headlines, body text, and CTAs to find what converts best for your audience."
    : (modalBody || "Your items are waiting for you. Complete your purchase now!");
  const displayCTA = isAIMode
    ? "AI-Generated CTA"
    : (ctaButton || "Complete My Order");

  const features = [];
  const triggers = [];
  if (exitIntentEnabled) triggers.push("Exit Intent");
  if (timeDelayEnabled) triggers.push(`Timer (${timeDelaySeconds}s)`);
  if (triggers.length > 0) {
    features.push({ label: `Triggers: ${triggers.join(", ")}` });
  }
  if (cartValueEnabled && (cartValueMin || cartValueMax)) {
    const min = cartValueMin || 0;
    const max = cartValueMax || "∞";
    features.push({ label: `Cart Value: $${min} - $${max}` });
  }
  if (discountEnabled) {
    if (offerType === 'percentage') {
      features.push({ label: `${discountPercentage}% Discount` });
    } else if (offerType === 'fixed') {
      features.push({ label: `$${discountAmount} Discount` });
    }
  } else {
    features.push({ label: "No Discount (Announcement Only)" });
  }
  if (isAIMode) features.push({ label: "AI Optimization Active" });

  // Reusable modal card preview
  const ModalCard = ({ scale = 1 }) => (
    <div id="exit-intent-modal" style={{
      background: 'white',
      borderRadius: '16px',
      padding: scale < 1 ? '32px 24px 24px 24px' : '48px 40px 40px 40px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb',
      position: 'relative'
    }}>
      {isAIMode && (
        <div style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: '#8B5CF6',
          color: 'white',
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: '600'
        }}>
          AI Mode
        </div>
      )}

      <button
        type="button"
        disabled
        style={{
          position: 'absolute',
          top: '20px',
          right: isAIMode ? '110px' : '20px',
          background: '#f3f4f6',
          border: 'none',
          fontSize: '20px',
          color: '#6b7280',
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'not-allowed',
          opacity: 0.5
        }}
      >
        ×
      </button>

      <h2 style={{
        margin: '0 0 16px 0',
        fontSize: scale < 1 ? '22px' : '32px',
        fontWeight: '700',
        color: isAIMode ? '#6b7280' : '#1f2937',
        fontFamily: brandFont || 'inherit',
        fontStyle: isAIMode ? 'italic' : 'normal',
        lineHeight: '1.3',
        letterSpacing: '-0.02em'
      }}>
        {displayHeadline}
      </h2>

      <p style={{
        margin: '0 0 24px 0',
        fontSize: scale < 1 ? '14px' : '17px',
        lineHeight: '1.6',
        color: '#6b7280',
        fontFamily: brandFont || 'inherit',
        fontStyle: isAIMode ? 'italic' : 'normal'
      }}>
        {displayBody}
      </p>

      <button
        type="button"
        disabled
        style={{
          background: isAIMode ? '#9ca3af' : (brandAccentColor || '#8B5CF6'),
          color: 'white',
          border: 'none',
          padding: scale < 1 ? '14px 24px' : '18px 32px',
          fontSize: scale < 1 ? '14px' : '17px',
          fontWeight: '600',
          borderRadius: '12px',
          boxShadow: isAIMode ? 'none' : '0 4px 14px 0 rgba(139, 92, 246, 0.39)',
          cursor: 'not-allowed',
          width: '100%',
          fontFamily: brandFont || 'inherit',
          opacity: isAIMode ? 0.7 : 1
        }}
      >
        {displayCTA}
      </button>

      <div style={{
        marginTop: '16px',
        textAlign: 'right',
        fontSize: '11px',
        color: '#9ca3af'
      }}>
        <span>Powered by </span>
        <span style={{ fontWeight: '600', color: '#8B5CF6' }}>Resparq</span>
      </div>
    </div>
  );

  // ============ INLINE VARIANT (sticky side panel) ============
  if (variant === "inline") {
    return (
      <div style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '20px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.15)'
            }} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
              Live Preview
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#9ca3af' }}>
            Updates as you type
          </span>
        </div>

        <ModalCard scale={0.85} />

        {features.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{
              fontSize: '11px',
              fontWeight: '600',
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px'
            }}>
              Active
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {features.map((feature, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 10px',
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#374151'
                  }}
                >
                  {feature.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {isAIMode && (
          <div style={{
            marginTop: '14px',
            padding: '10px 12px',
            background: '#f5f3ff',
            border: '1px solid #8B5CF6',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#6b21a8',
            lineHeight: '1.5'
          }}>
            Preview shows placeholder copy. Live modals use AI-generated content.
          </div>
        )}
      </div>
    );
  }

  // ============ MODAL VARIANT (full-screen overlay) ============
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'white',
            borderRadius: '16px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}
        >
          <div style={{
            padding: '24px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '4px' }}>
                Modal Preview
              </h2>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                Full-size view of your modal
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: '#f3f4f6',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#6b7280',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: '32px', display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 400px' }}>
              <ModalCard scale={1} />
            </div>

            <div style={{ flex: '1 1 300px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
                Active Features
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {features.map((feature, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px 16px',
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#374151'
                    }}
                  >
                    {feature.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
