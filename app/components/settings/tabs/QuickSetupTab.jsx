import { useState } from "react";
import { Link } from "react-router";
import { MODAL_TEMPLATES } from "../../../utils/templates";

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
  modalHeadline,
  setModalHeadline,
  modalBody,
  setModalBody,
  ctaButton,
  setCtaButton,
  setFormChanged,
  showPreview,
  setShowPreview,
  setActiveTab,
  canUseAllTriggers,
  canUseCartValue
}) {
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

      {/* AI Mode Active - Guide to AI Settings */}
      {optimizationMode === "ai" && (
        <div style={{ 
          background: "#f5f3ff", 
          padding: 24, 
          borderRadius: 8, 
          border: "2px solid #8B5CF6",
          marginBottom: 24
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ fontSize: 40 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8, color: "#8B5CF6", fontWeight: 600 }}>
                AI Mode Enabled
              </h3>
              <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                The AI will automatically test and optimize your offers. Configure AI settings like optimization goal, discount aggression, and budget cap in the <strong>AI Settings</strong> tab.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                style={{
                  padding: "10px 20px",
                  background: "#8B5CF6",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Go to AI Settings →
              </button>
            </div>
          </div>
        </div>
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

            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              style={{ 
                padding: "10px 20px", 
                background: "#f3f4f6", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 16
              }}
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </button>
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
                    style={{ marginRight: 12, marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Dollar Amount Off</div>
                    <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                      e.g., "10DOLLARSOFF" for $10 discount
                    </div>
                    <span style={{ marginRight: 8, color: "#666" }}>$</span>
                    <input
                      type="number"
                      name="discountAmount"
                      defaultValue={settings.discountAmount || 10}
                      min="1"
                      step="1"
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
              
              {settings.discountCode && (
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
            </div>

            <div style={{
              padding: 12,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
              fontSize: 14,
              color: "#1e40af"
            }}>
              💡 <strong>Tip:</strong> If discount is disabled, the modal will still show but won't include a discount offer. Great for simple cart reminders or announcements!
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
                  ⭐ <strong>Upgrade to Pro</strong> to unlock time delay triggers and cart value targeting.{" "}
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
