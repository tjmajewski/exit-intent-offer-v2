import { useState } from "react";
import { Link } from "react-router";
import { MODAL_TEMPLATES, getAvailableLayouts } from "../../../utils/templates";
import AISettingsTab from "./AISettingsTab";

export default function QuickSetupTab({
  settings,
  plan,
  availableTemplates,
  canUseAIMode,
  optimizationMode,
  setOptimizationMode,
  selectedTemplate,
  setSelectedTemplate,
  applyTemplate,
  selectedLayout,
  setSelectedLayout,
  modalHeadline,
  setModalHeadline,
  modalBody,
  setModalBody,
  ctaButton,
  setCtaButton,
  setFormChanged,
  setActiveTab,
  canUseAllTriggers,
  canUseCartValue,
  aggressionLevel,
  setAggressionLevel,
  mutationRate,
  setMutationRate,
  crossoverRate,
  setCrossoverRate,
  selectionPressure,
  setSelectionPressure
}) {
  // State for discount code mode to show/hide input fields
  const [manualDiscountCodeMode, setManualDiscountCodeMode] = useState(
    settings.manualDiscountCodeMode || "unique"
  );

  return (
    <>
      {/* Optimization Mode Selector */}
      <div style={{ 
        background: "white", 
        padding: 24, 
        borderRadius: 8, 
        border: "1px solid #e5e7eb",
        marginBottom: 24 
      }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>How do you want to manage your offers?</h2>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
          Choose between full manual control or AI-powered optimization
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Manual Mode */}
          <label style={{ 
            display: "flex", 
            flexDirection: "column",
            cursor: "pointer",
            padding: 20,
            border: optimizationMode === "manual" ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
            borderRadius: 8,
            background: optimizationMode === "manual" ? "#f5f3ff" : "white"
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <input
                type="radio"
                value="manual"
                checked={optimizationMode === "manual"}
                onChange={(e) => { setOptimizationMode(e.target.value); setFormChanged(true); }}
                style={{ marginRight: 12 }}
              />
              <div style={{ fontWeight: 600, fontSize: 16 }}>Manual Mode</div>
            </div>
            <div style={{ fontSize: 14, color: "#666", marginLeft: 28 }}>
              Full control over templates, copy, and triggers. Perfect for testing specific offers.
            </div>
          </label>

          {/* AI Mode */}
          <label style={{ 
            display: "flex", 
            flexDirection: "column",
            cursor: canUseAIMode ? "pointer" : "not-allowed",
            padding: 20,
            border: optimizationMode === "ai" ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
            borderRadius: 8,
            background: optimizationMode === "ai" ? "#f5f3ff" : "white",
            opacity: canUseAIMode ? 1 : 0.6
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <input
                type="radio"
                value="ai"
                checked={optimizationMode === "ai"}
                onChange={(e) => { setOptimizationMode(e.target.value); setFormChanged(true); }}
                disabled={!canUseAIMode}
                style={{ marginRight: 12 }}
              />
              <div style={{ fontWeight: 600, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                AI Mode
                {!canUseAIMode && (
                  <span style={{ 
                    padding: "2px 8px", 
                    background: "#8B5CF6", 
                    color: "white", 
                    borderRadius: 4, 
                    fontSize: 11,
                    fontWeight: 600 
                  }}>
                    PRO
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: 14, color: "#666", marginLeft: 28 }}>
              AI automatically tests and optimizes to maximize results. Configure in AI Settings tab.
            </div>
          </label>
        </div>

        {!canUseAIMode && (
          <div style={{ 
            marginTop: 16, 
            padding: 12, 
            background: "#fef3c7", 
            borderRadius: 6,
            fontSize: 14,
            textAlign: "center"
          }}>
             <strong>Upgrade to Pro</strong> to unlock AI Mode with automatic optimization.{" "}
            <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
              Learn more →
            </a>
          </div>
        )}
      </div>

      {/* AI Mode Active - Inline AI Settings */}
      {optimizationMode === "ai" && (
        <AISettingsTab
          canUseAIMode={canUseAIMode}
          optimizationMode={optimizationMode}
          settings={settings}
          aggressionLevel={aggressionLevel}
          setAggressionLevel={setAggressionLevel}
          setFormChanged={setFormChanged}
          plan={plan}
          mutationRate={mutationRate}
          setMutationRate={setMutationRate}
          crossoverRate={crossoverRate}
          setCrossoverRate={setCrossoverRate}
          selectionPressure={selectionPressure}
          setSelectionPressure={setSelectionPressure}
        />
      )}

      {/* Manual Mode - Show All Settings */}
      {optimizationMode === "manual" && (
        <>
          {/* Template Selector */}
          <div style={{ 
            background: "white", 
            padding: 24, 
            borderRadius: 8, 
            border: "1px solid #e5e7eb",
            marginBottom: 24 
          }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>
              Choose a Template
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
              Start with a pre-made template and customize it to match your brand
            </p>

            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", 
              gap: 16 
            }}>
              {availableTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template.id)}
                  style={{
                    padding: 16,
                    border: selectedTemplate === template.id ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
                    borderRadius: 8,
                    background: selectedTemplate === template.id ? "#f5f3ff" : "white",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s"
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{template.icon}</div>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{template.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{template.description}</div>
                </button>
              ))}
            </div>

            <input type="hidden" name="template" value={selectedTemplate} />
          </div>

          {/* Modal Layout (visual template) — manual mode only */}
          <div style={{
            background: "white",
            padding: 24,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            marginBottom: 24
          }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>
              Choose a Modal Design
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
              The visual layout of the popup. Each design works with any copy template.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12
            }}>
              {getAvailableLayouts().map((layout) => {
                const isSelected = selectedLayout === layout.id;
                return (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() => {
                      setSelectedLayout(layout.id);
                      setFormChanged(true);
                    }}
                    style={{
                      padding: 14,
                      border: isSelected ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: isSelected ? "#f5f3ff" : "white",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s"
                    }}
                  >
                    <LayoutThumbnail layoutId={layout.id} selected={isSelected} />
                    <div style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>{layout.name}</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{layout.description}</div>
                  </button>
                );
              })}
            </div>

            <input type="hidden" name="manualTemplateId" value={selectedLayout} />
          </div>

          {/* Modal Content Section */}
          <div style={{ 
            background: "white", 
            padding: 24, 
            borderRadius: 8, 
            border: "1px solid #e5e7eb",
            marginBottom: 24 
          }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>
              Modal Content
            </h2>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                Headline <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                name="modalHeadline"
                value={modalHeadline}
                onChange={(e) => { setModalHeadline(e.target.value); setFormChanged(true); }}
                style={{ 
                  width: "100%", 
                  padding: "10px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16
                }}
                required
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                Body Text <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea
                name="modalBody"
                value={modalBody}
                onChange={(e) => { setModalBody(e.target.value); setFormChanged(true); }}
                rows={4}
                style={{ 
                  width: "100%", 
                  padding: "10px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16,
                  fontFamily: "inherit"
                }}
                required
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                Button Text <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                name="ctaButton"
                value={ctaButton}
                onChange={(e) => { setCtaButton(e.target.value); setFormChanged(true); }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="showProductImages"
                  defaultChecked={settings.showProductImages}
                  onChange={() => setFormChanged(true)}
                  style={{ marginRight: 12, width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Show Product Images</div>
                  <div style={{ fontSize: 14, color: "#666" }}>
                    Display up to 3 items from the customer's cart inside the pop-up
                    (skipped on the Top Banner and Scratch Reveal layouts)
                  </div>
                </div>
              </label>
              {/* Presence marker: this checkbox only exists on the Quick Setup tab.
                  Unchecked and unmounted are indistinguishable in FormData, so the
                  action keys off this marker to avoid wiping the saved value. */}
              <input type="hidden" name="showProductImagesPresent" value="1" />
            </div>

          </div>

          {/* Discount Section */}
          <div style={{ 
            background: "white", 
            padding: 24, 
            borderRadius: 8, 
            border: "1px solid #e5e7eb",
            marginBottom: 24 
          }}>
            <h2 style={{ fontSize: 20, marginBottom: 20 }}>Discount Offer <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(Optional)</span></h2>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="discountEnabled"
                  defaultChecked={settings.discountEnabled}
                  onChange={() => setFormChanged(true)}
                  style={{ marginRight: 12, width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Enable Discount Offer</div>
                  <div style={{ fontSize: 14, color: "#666" }}>
                    Automatically apply discount when customer clicks the CTA
                  </div>
                </div>
              </label>
            </div>

            {/* Discount Code Mode */}
            <div style={{ marginLeft: 32, marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
                Discount Code Type
              </label>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="manualDiscountCodeMode"
                    value="generic"
                    checked={manualDiscountCodeMode === "generic"}
                    style={{ marginRight: 12, marginTop: 4 }}
                    onChange={(e) => { setManualDiscountCodeMode("generic"); setFormChanged(true); }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Generic Code (Same for everyone)</div>
                    <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                      Same code for every customer. Easy to track, no expiry.
                    </div>
                    {manualDiscountCodeMode === "generic" && (
                      <div style={{ fontSize: 13, color: "#6b7280" }}>
                        Auto-branded with your store name (e.g. <strong style={{ color: "#374151" }}>YOURSTORESAVE10</strong>).
                      </div>
                    )}
                  </div>
                </label>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="manualDiscountCodeMode"
                    value="unique"
                    checked={manualDiscountCodeMode === "unique"}
                    style={{ marginRight: 12, marginTop: 4 }}
                    onChange={(e) => { setManualDiscountCodeMode("unique"); setFormChanged(true); }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Unique Codes (One per customer)</div>
                    <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                      Generate unique codes with 24-hour expiry. Creates urgency and prevents code sharing.
                    </div>
                    {manualDiscountCodeMode === "unique" && (
                      <div style={{ fontSize: 13, color: "#6b7280" }}>
                        Codes auto-branded with your store name (e.g. <strong style={{ color: "#374151" }}>YOURSTORE-A1B2C3</strong>).
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>

            <div style={{ marginLeft: 32, marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
                Offer Type
              </label>
              
              {/* Percentage Discount */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="offerType"
                    value="percentage"
                    defaultChecked={settings.offerType === "percentage" || !settings.offerType}
                    onChange={() => setFormChanged(true)}
                    style={{ marginRight: 12, marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Percentage Off</div>
                    <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                      e.g., "10OFF" for 10% discount
                    </div>
                    <input
                      type="number"
                      name="discountPercentage"
                      defaultValue={settings.discountPercentage || 10}
                      min="1"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onInput={(e) => {
                        e.target.value = e.target.value.replace(/[^0-9]/g, '');
                      }}
                      onChange={() => setFormChanged(true)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        width: 100,
                        fontSize: 16
                      }}
                    />
                    <span style={{ marginLeft: 8, color: "#666" }}>%</span>
                  </div>
                </label>
              </div>

              {/* Fixed Dollar Amount */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="offerType"
                    value="fixed"
                    defaultChecked={settings.offerType === "fixed"}
                    onChange={() => setFormChanged(true)}
                    style={{ marginRight: 12, marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Fixed Amount Off</div>
                    <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                      Whole numbers only, in your store's currency (e.g. 10 = $10 off, €10 off, ¥10 off).
                    </div>
                    <input
                      type="number"
                      name="discountAmount"
                      defaultValue={settings.discountAmount || 10}
                      min="1"
                      step="1"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onInput={(e) => {
                        e.target.value = e.target.value.replace(/[^0-9]/g, '');
                      }}
                      onChange={() => setFormChanged(true)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        width: 100,
                        fontSize: 16
                      }}
                    />
                  </div>
                </label>
              </div>
              
              {manualDiscountCodeMode === "generic" && settings.discountCode && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#f9fafb",
                  borderRadius: 6,
                  fontSize: 14
                }}>
                  <strong>Current code:</strong> {settings.discountCode}
                  <div style={{ color: "#666", marginTop: 4 }}>
                    This code will be automatically applied at checkout
                  </div>
                </div>
              )}
              {manualDiscountCodeMode === "unique" && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#f0fdf4",
                  borderRadius: 6,
                  fontSize: 14,
                  border: "1px solid #bbf7d0"
                }}>
                  <strong>Unique codes enabled</strong>
                  <div style={{ color: "#15803d", marginTop: 4 }}>
                    A fresh code branded with your store name (e.g. <strong>YOURSTORE-A1B2C3</strong>) is generated for each customer. Codes expire in 24 hours and can only be used once.
                  </div>
                </div>
              )}
            </div>

            <div style={{
              padding: 12,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
              fontSize: 14,
              color: "#1e40af"
            }}>
               <strong>Tip:</strong> If discount is disabled, the modal will still show but won't include a discount offer. Great for simple cart reminders or announcements!
            </div>
          </div>

          {/* Trigger Conditions Section */}
          <div style={{ 
            background: "white", 
            padding: 24, 
            borderRadius: 8, 
            border: "1px solid #e5e7eb",
            marginBottom: 24 
          }}>
            <h2 style={{ fontSize: 20, marginBottom: 20 }}>When to Show Modal <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(At least one required)</span></h2>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="exitIntentEnabled"
                  defaultChecked={settings.exitIntentEnabled}
                  onChange={() => setFormChanged(true)}
                  style={{ marginRight: 12, width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Exit Intent</div>
                  <div style={{ fontSize: 14, color: "#666" }}>
                    Show modal when cursor moves towards top of browser (customer trying to leave)
                  </div>
                </div>
              </label>
            </div>

            <div style={{ 
              marginBottom: 20,
              opacity: canUseAllTriggers ? 1 : 0.5,
              position: 'relative'
            }}>
              <label style={{ display: "flex", alignItems: "center", cursor: canUseAllTriggers ? "pointer" : "not-allowed" }}>
                <input
                  type="checkbox"
                  name="timeDelayEnabled"
                  defaultChecked={settings.timeDelayEnabled}
                  disabled={!canUseAllTriggers}
                  onChange={() => setFormChanged(true)}
                  style={{ marginRight: 12, width: 20, height: 20 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>
                    Time Delay on Cart Page
                    {!canUseAllTriggers && (
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
                    Show modal after customer spends time on cart page or has mini cart open
                  </div>
                </div>
              </label>
              <div style={{ marginLeft: 32, marginTop: 12 }}>
                <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                  Seconds to wait:
                </label>
                <input
                  type="number"
                  name="timeDelaySeconds"
                  defaultValue={settings.timeDelaySeconds}
                  min="5"
                  max="300"
                  disabled={!canUseAllTriggers}
                  onChange={() => setFormChanged(true)}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    width: 100
                  }}
                />
              </div>
              
              {!canUseAllTriggers && (
                <div style={{ 
                  marginTop: 12, 
                  padding: 12, 
                  background: "#fef3c7", 
                  borderRadius: 6,
                  fontSize: 14 
                }}>
                   <strong>Upgrade to Pro</strong> to unlock time delay triggers and cart value targeting.{" "}
                  <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                    Learn more →
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// =============================================================================
// LayoutThumbnail — tiny visual mockup for each layout in the picker.
// Pure SVG so it ships without an asset pipeline.
// =============================================================================
function LayoutThumbnail({ layoutId, selected }) {
  const stroke = selected ? "#8B5CF6" : "#9ca3af";
  const fill = selected ? "#8B5CF6" : "#cbd5e1";
  const muted = selected ? "rgba(139,92,246,0.18)" : "#e5e7eb";
  const box = { width: "100%", height: 70, background: "#f9fafb", borderRadius: 6, position: "relative", overflow: "hidden" };

  switch (layoutId) {
    case "classic-card":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="40" y="14" width="80" height="42" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <rect x="50" y="22" width="40" height="4" rx="1" fill={stroke} />
          <rect x="50" y="30" width="60" height="3" rx="1" fill={muted} />
          <rect x="50" y="42" width="60" height="8" rx="2" fill={fill} />
        </svg>
      );
    case "top-banner":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="0" y="0" width="160" height="16" fill={fill} />
          <rect x="6" y="6" width="60" height="4" rx="1" fill="white" />
          <rect x="118" y="4" width="36" height="8" rx="2" fill="white" />
          <rect x="20" y="28" width="120" height="3" rx="1" fill={muted} />
          <rect x="20" y="36" width="100" height="3" rx="1" fill={muted} />
          <rect x="20" y="44" width="110" height="3" rx="1" fill={muted} />
        </svg>
      );
    case "bottom-sheet":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="20" y="32" width="120" height="38" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <rect x="74" y="36" width="12" height="2" rx="1" fill={muted} />
          <rect x="30" y="44" width="50" height="4" rx="1" fill={stroke} />
          <rect x="30" y="52" width="80" height="3" rx="1" fill={muted} />
          <rect x="30" y="60" width="100" height="6" rx="2" fill={fill} />
        </svg>
      );
    case "coupon-ticket":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="30" y="10" width="100" height="50" rx="4" fill="white" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 2" />
          <text x="80" y="22" textAnchor="middle" fontSize="6" fontWeight="700" fill={stroke} letterSpacing="0.5">COUPON</text>
          <text x="80" y="42" textAnchor="middle" fontSize="18" fontWeight="800" fill={stroke}>15%</text>
          <rect x="55" y="48" width="50" height="7" rx="2" fill={fill} />
        </svg>
      );
    case "split-hero":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="24" y="14" width="112" height="42" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <path d="M24 20 a6 6 0 0 1 6 -6 h36 v42 h-36 a6 6 0 0 1 -6 -6 Z" fill={fill} />
          <text x="48" y="40" textAnchor="middle" fontSize="13" fontWeight="800" fill="white">25%</text>
          <rect x="78" y="22" width="44" height="4" rx="1" fill={stroke} />
          <rect x="78" y="30" width="50" height="3" rx="1" fill={muted} />
          <rect x="78" y="42" width="50" height="8" rx="2" fill={fill} />
        </svg>
      );
    case "timer-front":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="36" y="8" width="88" height="54" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <rect x="60" y="16" width="18" height="14" rx="2" fill={fill} />
          <rect x="82" y="16" width="18" height="14" rx="2" fill={fill} />
          <rect x="78" y="21" width="4" height="4" rx="1" fill={stroke} />
          <rect x="56" y="38" width="48" height="3" rx="1" fill={stroke} />
          <rect x="60" y="50" width="40" height="7" rx="2" fill={fill} />
        </svg>
      );
    case "testimonial":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="34" y="10" width="92" height="50" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <text x="80" y="26" textAnchor="middle" fontSize="9" fill={fill} letterSpacing="1">★★★★★</text>
          <rect x="50" y="32" width="60" height="3" rx="1" fill={muted} />
          <rect x="56" y="39" width="48" height="3" rx="1" fill={muted} />
          <rect x="58" y="48" width="44" height="7" rx="2" fill={fill} />
        </svg>
      );
    case "scratch-reveal":
      return (
        <svg viewBox="0 0 160 70" style={box} preserveAspectRatio="none">
          <rect x="0" y="0" width="160" height="70" fill="#f9fafb" />
          <rect x="34" y="10" width="92" height="50" rx="6" fill="white" stroke={stroke} strokeWidth="1.5" />
          <rect x="48" y="20" width="64" height="22" rx="4" fill={muted} />
          <text x="76" y="36" textAnchor="middle" fontSize="11" fontWeight="800" fill={fill}>30%</text>
          <path d="M96 22 l14 -4 M98 30 l16 -3" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          <rect x="58" y="48" width="44" height="7" rx="2" fill={fill} />
        </svg>
      );
    default:
      return <div style={box} />;
  }
}
