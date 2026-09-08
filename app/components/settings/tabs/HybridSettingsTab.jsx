// Hybrid ("Guided") mode settings — the merchant pins ONE offer for everyone;
// the AI owns copy, timing, placement, and targeting. This block renders ONLY
// the merchant-controlled levers: the pinned offer and the discount-code type.
// The aggression slider (AISettingsTab) is intentionally NOT rendered here —
// pinning the number IS the aggression setting.
export default function HybridSettingsTab({
  hybridOfferType,
  setHybridOfferType,
  hybridOfferAmount,
  setHybridOfferAmount,
  hybridDiscountCodeMode,
  setHybridDiscountCodeMode,
  settings,
  setFormChanged
}) {
  const card = {
    background: "white",
    padding: 24,
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    marginBottom: 24
  };
  const numberInput = {
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    width: 100,
    fontSize: 16
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 20, marginBottom: 8 }}>Your pinned offer</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Every eligible shopper gets this exact offer. AI handles the rest: who sees it, when, and how.
      </p>

      {/* Pinned offer: type + amount */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
          Offer Type
        </label>

        {/* Percentage */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="radio"
              name="hybridOfferType"
              value="percentage"
              checked={hybridOfferType === "percentage"}
              onChange={() => { setHybridOfferType("percentage"); setFormChanged(true); }}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Percentage Off</div>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                A percentage off the order, e.g. 15% off.
              </div>
            </div>
          </label>
        </div>

        {/* Fixed */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="radio"
              name="hybridOfferType"
              value="fixed"
              checked={hybridOfferType === "fixed"}
              onChange={() => { setHybridOfferType("fixed"); setFormChanged(true); }}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Fixed Amount Off</div>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                Whole numbers only, in your store's currency (e.g. 15 = $15 off).
              </div>
            </div>
          </label>
        </div>

        {/* Single pinned amount, meaning depends on the type above */}
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
          Amount
        </label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <input
            type="number"
            name="hybridOfferAmount"
            value={hybridOfferAmount}
            min="0"
            max={hybridOfferType === "percentage" ? "100" : undefined}
            step="1"
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(e) => {
              setHybridOfferAmount(e.target.value.replace(/[^0-9]/g, ''));
              setFormChanged(true);
            }}
            style={numberInput}
          />
          <span style={{ marginLeft: 8, color: "#666" }}>
            {hybridOfferType === "percentage" ? "%" : "off"}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          Set to <strong>0</strong> to run reminder-only (no discount, just the exit nudge).
        </div>
      </div>

      {/* Discount code type: generic vs unique */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
          Discount Code Type
        </label>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="radio"
              name="hybridDiscountCodeMode"
              value="generic"
              checked={hybridDiscountCodeMode === "generic"}
              onChange={() => { setHybridDiscountCodeMode("generic"); setFormChanged(true); }}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Same code for everyone</div>
              <div style={{ fontSize: 14, color: "#666" }}>
                One reusable code, no expiry. Auto-branded with your store name.
              </div>
            </div>
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="radio"
              name="hybridDiscountCodeMode"
              value="unique"
              checked={hybridDiscountCodeMode === "unique"}
              onChange={() => { setHybridDiscountCodeMode("unique"); setFormChanged(true); }}
              style={{ marginRight: 12, marginTop: 4 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Unique code per shopper</div>
              <div style={{ fontSize: 14, color: "#666" }}>
                A fresh code per shopper with 24-hour expiry. Prevents code sharing.
              </div>
            </div>
          </label>
        </div>
      </div>

      {hybridDiscountCodeMode === "generic" && settings?.hybridGenericDiscountCode && (
        <div style={{ marginTop: 8, padding: 12, background: "#f9fafb", borderRadius: 6, fontSize: 14 }}>
          <strong>Current code:</strong> {settings.hybridGenericDiscountCode}
          <div style={{ color: "#666", marginTop: 4 }}>
            Applied automatically at checkout. Stacks on top of your existing offers where Shopify allows.
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, padding: 12, background: "#f5f3ff", borderRadius: 6, fontSize: 14, color: "#4b3f72" }}>
        Every eligible shopper gets this exact offer. AI handles the rest.
      </div>
    </div>
  );
}
