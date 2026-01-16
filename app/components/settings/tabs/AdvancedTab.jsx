export default function AdvancedTab({
  plan,
  optimizationMode,
  canChooseRedirect,
  settings,
  canUseCartValue
}) {
  if (plan && plan.tier === 'starter') {
    return (
      <div style={{
        background: 'white',
        padding: 80,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        textAlign: 'center',
        marginBottom: 24
      }}>
        <div style={{
          display: 'inline-block',
          padding: '4px 12px',
          background: '#f3f4f6',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          color: '#6b7280',
          marginBottom: 24
        }}>
          PRO
        </div>
        <h2 style={{ fontSize: 28, marginBottom: 16, fontWeight: 700 }}>Advanced Settings</h2>
        <p style={{ color: '#6b7280', marginBottom: 32, fontSize: 17, lineHeight: 1.6 }}>
          Choose redirect destinations, set cart value conditions, and fine-tune your modal behavior. Available on Pro and Enterprise plans.
        </p>
        
        
          <button
          type="button"
          onClick={() => window.location.href = '/app/upgrade'}
          style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
            color: 'white',
            padding: '14px 32px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            fontSize: 16,
            transition: 'transform 0.2s',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          Upgrade to Pro
        </button>
      </div>
    );
  }

  if (optimizationMode === "ai") {
    return (
      <div style={{
        background: 'white',
        padding: 48,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        textAlign: 'center',
        marginBottom: 24
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>AI Mode Active</h2>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          Advanced settings are managed by AI. Switch to Manual Mode in the Quick Setup tab to access manual controls.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Redirect Destination & Cart Value Conditions Sections */}
      <div style={{ 
        background: "white", 
        padding: 24, 
        borderRadius: 8, 
        border: "1px solid #e5e7eb",
        marginBottom: 24,
        opacity: canChooseRedirect ? 1 : 0.5,
        position: 'relative'
      }}>
        <h2 style={{ fontSize: 20, marginBottom: 20 }}>
          After Click Behavior <span style={{ color: "#dc2626" }}>*</span>
          {!canChooseRedirect && (
            <span style={{ 
              marginLeft: 8, 
              padding: "2px 8px", 
              background: "#8B5CF6", 
              color: "white", 
              borderRadius: 4, 
              fontSize: 12,
              fontWeight: 600 
            }}>
              PRO
            </span>
          )}
        </h2>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
            Where should customers go after clicking the CTA?
          </label>
          
          <label style={{ 
            display: "flex", 
            alignItems: "flex-start", 
            cursor: canChooseRedirect ? "pointer" : "not-allowed",
            padding: 16,
            border: "2px solid",
            borderRadius: 8,
            marginBottom: 12,
            background: (settings.redirectDestination === "checkout" || !settings.redirectDestination) ? "#f0fdf4" : "white",
            borderColor: (settings.redirectDestination === "checkout" || !settings.redirectDestination) ? "#10b981" : "#e5e7eb",
            transition: "all 0.2s"
          }}>
            <input
              type="radio"
              name="redirectDestination"
              value="checkout"
              defaultChecked={!settings.redirectDestination || settings.redirectDestination === "checkout"}
              disabled={!canChooseRedirect}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Checkout {!canChooseRedirect && "(Starter Plan Default)"}
              </div>
              <div style={{ fontSize: 14, color: "#666" }}>
                Send customers directly to checkout. Fewer steps = higher conversion. Discount auto-applies.
              </div>
            </div>
          </label>

          <label style={{ 
            display: "flex", 
            alignItems: "flex-start", 
            cursor: canChooseRedirect ? "pointer" : "not-allowed",
            padding: 16,
            border: "2px solid",
            borderRadius: 8,
            background: settings.redirectDestination === "cart" ? "#f0fdf4" : "white",
            borderColor: settings.redirectDestination === "cart" ? "#10b981" : "#e5e7eb",
            transition: "all 0.2s"
          }}>
            <input
              type="radio"
              name="redirectDestination"
              value="cart"
              defaultChecked={settings.redirectDestination === "cart"}
              disabled={!canChooseRedirect}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Cart Page*
              </div>
              <div style={{ fontSize: 14, color: "#666" }}>
                Send customers to cart page first. Gives them a chance to review or add more items before checkout.
              </div>
              <div style={{ fontSize: 13, color: "#f59e0b", marginTop: 8, fontStyle: "italic" }}>
                *If discount is enabled and your theme doesn't have a cart discount field, customers will be automatically redirected to checkout to apply the discount.
              </div>
            </div>
          </label>
        </div>

        {!canChooseRedirect ? (
          <div style={{
            padding: 12,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 14,
            color: "#92400e",
            marginTop: 16
          }}>
             <strong>Upgrade to Pro</strong> to choose between cart and checkout redirect and A/B test which converts better.{" "}
            <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
              Learn more →
            </a>
          </div>
        ) : (
          <div style={{
            padding: 12,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 14,
            color: "#92400e",
            marginTop: 16
          }}>
            🧪 <strong>A/B Testing Tip:</strong> This is a great variable to test! Try both and see which converts better for your store.
          </div>
        )}
      </div>
      
      {/* Cart Value Conditions Section */}
      <div style={{ 
        background: "white", 
        padding: 24, 
        borderRadius: 8, 
        border: "1px solid #e5e7eb",
        marginBottom: 24 
      }}>
        <h2 style={{ fontSize: 20, marginBottom: 20 }}>Additional Conditions <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(Optional)</span></h2>

        <div style={{ 
          marginBottom: 20,
          opacity: canUseCartValue ? 1 : 0.5,
          position: 'relative'
        }}>
          <label style={{ display: "flex", alignItems: "center", cursor: canUseCartValue ? "pointer" : "not-allowed" }}>
            <input
              type="checkbox"
              name="cartValueEnabled"
              defaultChecked={settings.cartValueEnabled}
              disabled={!canUseCartValue}
              style={{ marginRight: 12, width: 20, height: 20 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>
                Cart Value Range
                {!canUseCartValue && (
                  <span style={{ 
                    marginLeft: 8, 
                    padding: "2px 8px", 
                    background: "#8B5CF6", 
                    color: "white", 
                    borderRadius: 4, 
                    fontSize: 12,
                    fontWeight: 600 
                  }}>
                    PRO
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14, color: "#666" }}>
                Only show modal if cart value falls within a specific range
              </div>
            </div>
          </label>
          <div style={{ marginLeft: 32, marginTop: 12, display: "flex", gap: 20 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                Minimum ($):
              </label>
              <input
                type="number"
                name="cartValueMin"
                defaultValue={settings.cartValueMin}
                min="0"
                step="0.01"
                disabled={!canUseCartValue}
                style={{ 
                  padding: "8px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  width: 120
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                Maximum ($):
              </label>
              <input
                type="number"
                name="cartValueMax"
                defaultValue={settings.cartValueMax}
                min="0"
                step="0.01"
                disabled={!canUseCartValue}
                style={{ 
                  padding: "8px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  width: 120
                }}
              />
            </div>
          </div>
          
          {!canUseCartValue && (
            <div style={{ 
              marginTop: 12, 
              padding: 12, 
              background: "#fef3c7", 
              borderRadius: 6,
              fontSize: 14 
            }}>
               <strong>Upgrade to Pro</strong> to target specific cart value ranges.{" "}
              <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                Learn more →
              </a>
            </div>
          )}
        </div>

        <div style={{
          padding: 12,
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 6,
          fontSize: 14,
          color: "#0c4a6e"
        }}>
           <strong>Example:</strong> Set minimum to $100 and maximum to $3000 to only show the modal for mid-range carts. Combine with any trigger above!
        </div>
      </div>
    </>
  );
}
