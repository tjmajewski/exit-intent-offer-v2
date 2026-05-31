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
  customCSS,
  plan,
  aggressionLevel,
  selectedLayout = "classic-card"
}) {
  const planTier = plan?.tier || 'starter';
  const showPoweredBy = planTier !== 'enterprise';
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

  // Discount feature line — AI mode is driven by the aggression slider
  // (0 = announcement only; >0 = AI will offer discounts). Manual mode is
  // driven by the explicit discountEnabled toggle.
  if (isAIMode) {
    if (aggressionLevel && aggressionLevel > 0) {
      features.push({ label: `AI Discount Active (Aggression: ${aggressionLevel}/10)` });
    } else {
      features.push({ label: "No Discount (Announcement Only)" });
    }
  } else {
    if (discountEnabled) {
      if (offerType === 'percentage') {
        features.push({ label: `${discountPercentage}% Discount` });
      } else if (offerType === 'fixed') {
        features.push({ label: `$${discountAmount} Discount` });
      }
    } else {
      features.push({ label: "No Discount (Announcement Only)" });
    }
  }

  if (isAIMode) features.push({ label: "AI Optimization Active" });

  // Theme tokens for preview (merchant's brand colors stand in for what the
  // storefront sniffs from the live theme).
  const previewTokens = {
    primary: brandAccentColor || '#8B5CF6',
    primaryText: '#ffffff',
    foreground: brandPrimaryColor && brandPrimaryColor !== '#000000' ? brandPrimaryColor : '#1f2937',
    background: brandSecondaryColor && brandSecondaryColor !== '#ffffff' ? brandSecondaryColor : '#ffffff',
    muted: '#6b7280',
    borderRadius: '12px',
    fontFamily: brandFont || 'inherit'
  };

  const cardProps = {
    isAIMode,
    displayHeadline,
    displayBody,
    displayCTA,
    showPoweredBy,
    tokens: previewTokens
  };

  // Layout dispatcher — visually mirrors storefront templates in
  // extensions/exit-intent-modal/assets/modal-templates.js. JSX duplicates
  // the renderer for preview-time React rendering.
  const ModalCard = ({ scale = 1, compact = false }) => {
    const layoutId = isAIMode ? 'classic-card' : selectedLayout;
    switch (layoutId) {
      case 'top-banner':
        return <TopBannerPreview {...cardProps} scale={scale} compact={compact} />;
      case 'bottom-sheet':
        return <BottomSheetPreview {...cardProps} scale={scale} compact={compact} />;
      case 'coupon-ticket':
        return <CouponTicketPreview {...cardProps} scale={scale} compact={compact}
                                    discountPercentage={discountPercentage}
                                    discountAmount={discountAmount}
                                    offerType={offerType} />;
      case 'classic-card':
      default:
        return <ClassicCardPreview {...cardProps} scale={scale} compact={compact} />;
    }
  };

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

        <ModalCard scale={0.85} compact />

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

// =============================================================================
// LAYOUT PREVIEW COMPONENTS
// Mirror the storefront renderers in modal-templates.js. Keep visual parity
// when you change one — these are the "what the merchant sees" version.
// =============================================================================

function AIBadge() {
  return (
    <div style={{
      position: 'absolute', top: 14, right: 14,
      background: '#8B5CF6', color: 'white',
      padding: '4px 10px', borderRadius: 6,
      fontSize: 11, fontWeight: 600, zIndex: 2
    }}>AI Mode</div>
  );
}

function PoweredBy() {
  return (
    <div style={{
      marginTop: 14, textAlign: 'right',
      fontSize: 10, opacity: 0.45, color: '#666'
    }}>
      Powered by <span style={{ fontWeight: 600, color: '#8B5CF6' }}>Resparq</span>
    </div>
  );
}

function ClassicCardPreview({ isAIMode, displayHeadline, displayBody, displayCTA, showPoweredBy, tokens, scale, compact }) {
  return (
    <div id="exit-intent-modal" style={{
      background: tokens.background,
      borderRadius: tokens.borderRadius,
      padding: scale < 1 ? '28px 22px 22px' : '40px 36px 32px',
      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.12)',
      border: '1px solid #e5e7eb',
      position: 'relative',
      fontFamily: tokens.fontFamily
    }}>
      {isAIMode && <AIBadge />}
      {!compact && <PreviewCloseBtn />}
      <h2 style={{
        margin: isAIMode && compact ? '28px 0 12px' : '0 0 12px',
        fontSize: scale < 1 ? '22px' : '28px',
        fontWeight: 700,
        color: isAIMode ? '#6b7280' : tokens.foreground,
        fontStyle: isAIMode ? 'italic' : 'normal',
        lineHeight: 1.25,
        letterSpacing: '-0.02em'
      }}>{displayHeadline}</h2>
      <p style={{
        margin: '0 0 22px',
        fontSize: scale < 1 ? '14px' : '15px',
        lineHeight: 1.5,
        color: tokens.muted,
        fontStyle: isAIMode ? 'italic' : 'normal'
      }}>{displayBody}</p>
      <PrimaryCta tokens={tokens} isAIMode={isAIMode} scale={scale}>{displayCTA}</PrimaryCta>
      {showPoweredBy && <PoweredBy />}
    </div>
  );
}

function TopBannerPreview({ isAIMode, displayHeadline, displayBody, displayCTA, tokens }) {
  return (
    <div style={{
      background: tokens.primary,
      color: tokens.primaryText,
      padding: '12px 16px',
      borderRadius: 8,
      fontFamily: tokens.fontFamily,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
      position: 'relative'
    }}>
      {isAIMode && <AIBadge />}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <strong style={{ fontSize: 14, fontWeight: 700, fontStyle: isAIMode ? 'italic' : 'normal' }}>
          {displayHeadline}
        </strong>
        {displayBody && (
          <span style={{ fontSize: 13, opacity: 0.9, marginLeft: 8, fontStyle: isAIMode ? 'italic' : 'normal' }}>
            {displayBody.length > 50 ? displayBody.slice(0, 50) + '…' : displayBody}
          </span>
        )}
      </div>
      <button type="button" disabled style={{
        background: tokens.primaryText,
        color: tokens.primary,
        border: 'none',
        padding: '7px 16px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: tokens.borderRadius,
        cursor: 'not-allowed',
        fontFamily: tokens.fontFamily,
        whiteSpace: 'nowrap'
      }}>{displayCTA}</button>
    </div>
  );
}

function BottomSheetPreview({ isAIMode, displayHeadline, displayBody, displayCTA, showPoweredBy, tokens, scale, compact }) {
  return (
    <div id="exit-intent-modal" style={{
      background: tokens.background,
      borderRadius: '20px 20px 8px 8px',
      padding: '14px 22px 22px',
      boxShadow: '0 -8px 25px -8px rgba(0,0,0,0.15)',
      border: '1px solid #e5e7eb',
      position: 'relative',
      fontFamily: tokens.fontFamily
    }}>
      {isAIMode && <AIBadge />}
      <div style={{
        width: 40, height: 4,
        background: 'rgba(0,0,0,0.18)',
        borderRadius: 999,
        margin: '0 auto 16px'
      }} />
      {!compact && <PreviewCloseBtn />}
      <h2 style={{
        margin: '4px 0 8px',
        fontSize: scale < 1 ? '20px' : '22px',
        fontWeight: 700,
        color: isAIMode ? '#6b7280' : tokens.foreground,
        fontStyle: isAIMode ? 'italic' : 'normal',
        letterSpacing: '-0.01em'
      }}>{displayHeadline}</h2>
      <p style={{
        margin: '0 0 20px',
        fontSize: 14,
        lineHeight: 1.5,
        color: tokens.muted,
        fontStyle: isAIMode ? 'italic' : 'normal'
      }}>{displayBody}</p>
      <PrimaryCta tokens={tokens} isAIMode={isAIMode} scale={scale}>{displayCTA}</PrimaryCta>
      {showPoweredBy && <PoweredBy />}
    </div>
  );
}

function CouponTicketPreview({ isAIMode, displayHeadline, displayBody, displayCTA, showPoweredBy, tokens, scale, discountPercentage, discountAmount, offerType }) {
  const heroAmount = offerType === 'fixed' ? `$${discountAmount || 10}` : `${discountPercentage || 15}%`;
  return (
    <div style={{ position: 'relative', fontFamily: tokens.fontFamily }}>
      {isAIMode && <AIBadge />}
      <div id="exit-intent-modal" style={{
        background: tokens.background,
        color: tokens.foreground,
        border: `2px dashed ${tokens.primary}`,
        borderRadius: 14,
        padding: '24px 22px',
        textAlign: 'center',
        boxShadow: '0 15px 40px -15px rgba(0,0,0,0.25)'
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.15em', color: tokens.primary,
          marginBottom: 8
        }}>EXCLUSIVE OFFER</div>
        <div style={{
          fontSize: scale < 1 ? '36px' : '46px',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: isAIMode ? '#6b7280' : tokens.foreground,
          margin: '4px 0 6px',
          fontStyle: isAIMode ? 'italic' : 'normal'
        }}>{isAIMode ? heroAmount : heroAmount}</div>
        <div style={{
          fontSize: 13, color: tokens.muted,
          marginBottom: 18, lineHeight: 1.4,
          fontStyle: isAIMode ? 'italic' : 'normal'
        }}>{displayBody}</div>
        <PrimaryCta tokens={tokens} isAIMode={isAIMode} scale={scale}>{displayCTA}</PrimaryCta>
        {showPoweredBy && <PoweredBy />}
      </div>
    </div>
  );
}

function PreviewCloseBtn() {
  return (
    <button type="button" disabled style={{
      position: 'absolute', top: 14, right: 14,
      background: 'rgba(0,0,0,0.06)', border: 'none',
      fontSize: 18, color: '#6b7280',
      width: 28, height: 28, borderRadius: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'not-allowed', opacity: 0.6
    }}>×</button>
  );
}

function PrimaryCta({ tokens, isAIMode, scale, children }) {
  return (
    <button type="button" disabled style={{
      background: isAIMode ? '#9ca3af' : tokens.primary,
      color: tokens.primaryText,
      border: 'none',
      padding: scale < 1 ? '12px 22px' : '14px 28px',
      fontSize: scale < 1 ? '14px' : '16px',
      fontWeight: 600,
      borderRadius: tokens.borderRadius,
      cursor: 'not-allowed',
      width: '100%',
      fontFamily: tokens.fontFamily,
      opacity: isAIMode ? 0.7 : 1
    }}>{children}</button>
  );
}
