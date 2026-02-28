import { useEffect } from "react";

export default function SettingsPreview({
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
  // Inject custom CSS into preview when modal opens
  useEffect(() => {
    if (!isOpen || !customCSS) return;
    
    const styleId = 'settings-preview-custom-css';
    
    // Remove existing style if present
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Inject new custom CSS
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = customCSS;
    document.head.appendChild(style);
    
    // Cleanup on unmount or when modal closes
    return () => {
      const styleToRemove = document.getElementById(styleId);
      if (styleToRemove) {
        styleToRemove.remove();
      }
    };
  }, [isOpen, customCSS]);
  
  if (!isOpen) return null;

  // Determine if mobile for responsive preview
  const isMobile = false; // Always show desktop preview in settings

  // AI mode shows dummy copy
  const isAIMode = optimizationMode === 'ai';
  const displayHeadline = isAIMode 
    ? "AI will generate optimized copy" 
    : (modalHeadline || "Wait! Don't leave yet ");
  const displayBody = isAIMode 
    ? "The AI will test different headlines, body text, and CTAs to find what converts best for your audience."
    : (modalBody || "Complete your purchase now and get free shipping on your order!");
  const displayCTA = isAIMode 
    ? "AI-Generated CTA" 
    : (ctaButton || "Complete My Order");

  // Build feature list
  const features = [];
  
  // Triggers
  const triggers = [];
  if (exitIntentEnabled) triggers.push("Exit Intent");
  if (timeDelayEnabled) triggers.push(`Timer (${timeDelaySeconds}s)`);
  if (triggers.length > 0) {
    features.push({ label: `Triggers: ${triggers.join(", ")}` });
  }
  
  // Cart Value Targeting
  if (cartValueEnabled && (cartValueMin || cartValueMax)) {
    const min = cartValueMin || 0;
    const max = cartValueMax || "∞";
    features.push({ label: `Cart Value: $${min} - $${max}` });
  }
  
  // Discount
  if (discountEnabled) {
    if (offerType === 'percentage') {
      features.push({ label: `${discountPercentage}% Discount` });
    } else if (offerType === 'fixed') {
      features.push({ label: `$${discountAmount} Discount` });
    }
  } else {
    features.push({ label: "No Discount (Announcement Only)" });
  }
  
  // AI Mode
  if (isAIMode) {
    features.push({ label: "AI Optimization Active" });
  }

  return (
    <>
      {/* Overlay */}
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
        {/* Preview Container */}
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
          {/* Header */}
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
                This is how your modal will appear to customers
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

          {/* Content */}
          <div style={{ padding: '32px', display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            {/* Modal Preview */}
            <div style={{ flex: '1 1 400px' }}>
              <div id="exit-intent-modal" style={{
                background: 'white',
                borderRadius: '16px',
                padding: '48px 40px 40px 40px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                border: '1px solid #e5e7eb',
                position: 'relative'
              }}>
                {/* AI Mode Badge */}
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
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                   AI Mode
                  </div>
                )}

                {/* Close button (non-functional in preview) */}
                <button
                  type="button"
                  disabled
                  style={{
                    position: 'absolute',
                    top: '20px',
                    right: isAIMode ? '110px' : '20px',
                    background: '#f3f4f6',
                    border: 'none',
                    fontSize: '24px',
                    color: '#6b7280',
                    width: '32px',
                    height: '32px',
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

                {/* Headline */}
                <h2 style={{
                  margin: '0 0 16px 0',
                  fontSize: '32px',
                  fontWeight: '700',
                  color: isAIMode ? '#6b7280' : '#1f2937',
                  fontFamily: brandFont || 'inherit',
                  fontStyle: isAIMode ? 'italic' : 'normal',
                  lineHeight: '1.3',
                  letterSpacing: '-0.02em'
                }}>
                  {displayHeadline}
                </h2>

                {/* Body */}
                <p style={{
                  margin: '0 0 32px 0',
                  fontSize: '17px',
                  lineHeight: '1.6',
                  color: isAIMode ? '#6b7280' : '#6b7280',
                  fontFamily: brandFont || 'inherit',
                  fontStyle: isAIMode ? 'italic' : 'normal'
                }}>
                  {displayBody}
                </p>

                {/* CTA Button */}
                <button
                  type="button"
                  disabled
                  style={{
                    background: isAIMode 
                      ? '#9ca3af' 
                      : (brandAccentColor || '#8B5CF6'),
                    color: 'white',
                    border: 'none',
                    padding: '18px 32px',
                    fontSize: '17px',
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

                {/* Powered by badge */}
                <div style={{
                  marginTop: '16px',
                  textAlign: 'right',
                  fontSize: '11px',
                  color: '#9ca3af'
                }}>
                  <span>Powered by </span>
                  <span style={{ fontWeight: '600', color: '#8B5CF6' }}>Repsarq</span>
                  <span style={{ fontSize: '13px' }}> </span>
                </div>
              </div>
            </div>

            {/* Features Sidebar */}
            <div style={{ flex: '1 1 300px' }}>
              <h3 style={{ 
                fontSize: '16px', 
                fontWeight: '600', 
                marginBottom: '16px',
                color: '#1f2937'
              }}>
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
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <span style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                      {feature.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* AI Mode Explanation */}
              {isAIMode && (
                <div style={{
                  marginTop: '24px',
                  padding: '16px',
                  background: '#f5f3ff',
                  border: '2px solid #8B5CF6',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '14px', color: '#6b21a8', lineHeight: '1.6' }}>
                    <strong style={{ display: 'block', marginBottom: '8px' }}>
                      AI Mode Active
                    </strong>
                    The AI will automatically test different copy variations to find what converts best. The preview shows placeholder text - actual modals will use AI-generated content.
                  </div>
                </div>
              )}

              {/* Note about unsaved changes */}
              <div style={{
                marginTop: '24px',
                padding: '12px',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#92400e'
              }}>
                <strong>Note:</strong> This preview shows your current form values. Remember to save your changes to make them live!
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
