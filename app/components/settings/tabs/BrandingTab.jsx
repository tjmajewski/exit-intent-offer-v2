import { useState } from "react";
import Editor from "@monaco-editor/react";

export default function BrandingTab({
  plan,
  settings,
  brandPrimaryColor,
  setBrandPrimaryColor,
  brandSecondaryColor,
  setBrandSecondaryColor,
  brandAccentColor,
  setBrandAccentColor,
  brandFont,
  setBrandFont,
  customCSS,
  setCustomCSS,
  setFormChanged
}) {
  const [autoDetecting, setAutoDetecting] = useState(false);

  if (plan?.tier !== 'enterprise') {
    return (
      <div style={{
        background: 'white',
        padding: 48,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '4px 12px',
          background: '#8B5CF6',
          color: 'white',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 16
        }}>
          ENTERPRISE
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Brand Customization</h2>
        <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
          Customize your modal colors and fonts to match your brand perfectly. 
          Available on Enterprise plan.
        </p>
        <button
          type="button"
          onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
          style={{
            padding: '12px 24px',
            background: '#8B5CF6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
            fontWeight: 500
          }}
        >
          Upgrade to Enterprise
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Hidden inputs to preserve trigger settings when saving from Branding tab */}
      <input type="hidden" name="exitIntentEnabled" value={settings.exitIntentEnabled || settings.triggers?.exitIntent ? "on" : ""} />
      <input type="hidden" name="timeDelayEnabled" value={settings.timeDelayEnabled || settings.triggers?.timeDelay ? "on" : ""} />
      <input type="hidden" name="timeDelaySeconds" value={settings.timeDelaySeconds || settings.triggers?.timeDelaySeconds || 30} />
      <input type="hidden" name="cartValueEnabled" value={settings.cartValueEnabled || settings.triggers?.cartValue ? "on" : ""} />
      <input type="hidden" name="cartValueMin" value={settings.cartValueMin || settings.triggers?.minCartValue || 0} />
      <input type="hidden" name="cartValueMax" value={settings.cartValueMax || settings.triggers?.maxCartValue || 1000} />
      
      <div style={{ 
        background: "white", 
        padding: 24, 
        borderRadius: 8, 
        border: "1px solid #e5e7eb",
        marginBottom: 24 
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Brand Customization</h2>
            <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
              Customize the modal to match your brand
            </p>
          </div>
          <span style={{ 
            padding: "4px 12px", 
            background: "#8B5CF6", 
            color: "white", 
            borderRadius: 4, 
            fontSize: 12,
            fontWeight: 600 
          }}>
            ENTERPRISE
          </span>
        </div>

        {/* Auto-Detect Button */}
        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            onClick={async () => {
              setAutoDetecting(true);
              try {
                const response = await fetch('/apps/exit-intent/api/detect-brand', {
                  method: 'POST'
                });
                const data = await response.json();
                if (data.success) {
                  setBrandPrimaryColor(data.colors.primary);
                  setBrandSecondaryColor(data.colors.secondary);
                  setBrandAccentColor(data.colors.accent);
                  setBrandFont(data.colors.font);
                }
              } catch (error) {
                console.error('Auto-detect failed:', error);
              } finally {
                setAutoDetecting(false);
              }
            }}
            disabled={autoDetecting}
            style={{
              padding: "10px 20px",
              background: autoDetecting ? "#9ca3af" : "#10b981",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: autoDetecting ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 500
            }}
          >
            {autoDetecting ? "Detecting..." : "Auto-Detect Brand Colors"}
          </button>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
            Automatically detect colors from your store's homepage
          </div>
        </div>

        {/* Color Pickers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
              Primary Color
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                name="brandPrimaryColor"
                value={brandPrimaryColor}
                onChange={(e) => { setBrandPrimaryColor(e.target.value); setFormChanged(true); }}
                style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
              />
              <input
                type="text"
                value={brandPrimaryColor}
                onChange={(e) => { setBrandPrimaryColor(e.target.value); setFormChanged(true); }}
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
              Secondary Color
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                name="brandSecondaryColor"
                value={brandSecondaryColor}
                onChange={(e) => { setBrandSecondaryColor(e.target.value); setFormChanged(true); }}
                style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
              />
              <input
                type="text"
                value={brandSecondaryColor}
                onChange={(e) => { setBrandSecondaryColor(e.target.value); setFormChanged(true); }}
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
              Accent Color
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                name="brandAccentColor"
                value={brandAccentColor}
                onChange={(e) => { setBrandAccentColor(e.target.value); setFormChanged(true); }}
                style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
              />
              <input
                type="text"
                value={brandAccentColor}
                onChange={(e) => { setBrandAccentColor(e.target.value); setFormChanged(true); }}
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
              />
            </div>
          </div>
        </div>

        {/* Font Selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
            Font Family
          </label>
          <select
            name="brandFont"
            value={brandFont}
            onChange={(e) => { setBrandFont(e.target.value); setFormChanged(true); }}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              fontSize: 14
            }}
          >
            <option value="system">System Default</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="'Helvetica Neue', sans-serif">Helvetica</option>
            <option value="'Georgia', serif">Georgia</option>
            <option value="'Times New Roman', serif">Times New Roman</option>
            <option value="'Courier New', monospace">Courier</option>
            <option value="'Roboto', sans-serif">Roboto</option>
            <option value="'Open Sans', sans-serif">Open Sans</option>
            <option value="'Lato', sans-serif">Lato</option>
            <option value="'Montserrat', sans-serif">Montserrat</option>
          </select>
        </div>

        {/* Custom CSS Section */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
            Custom CSS (Advanced)
          </label>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
            Add custom CSS to style your modal. You can change colors, fonts, spacing, etc. 
            <strong> You cannot change modal copy</strong> (that's controlled by AI/admin).
          </div>
          {/* Monaco Editor */}
          <div style={{ 
            border: "1px solid #d1d5db", 
            borderRadius: 6,
            overflow: "hidden"
          }}>
            <Editor
              height="300px"
              defaultLanguage="css"
              value={customCSS}
              onChange={(value) => { 
                setCustomCSS(value || ""); 
                setFormChanged(true); 
              }}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                wrappingIndent: "indent",
                automaticLayout: true,
                tabSize: 2,
                formatOnPaste: true,
                formatOnType: true
              }}
            />
          </div>
          
          {/* Hidden input to submit with form */}
          <input type="hidden" name="customCSS" value={customCSS} />
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
            {customCSS?.length || 0} / 102,400 characters (100KB max)
          </div>
        </div>

      </div>
    </>
  );
}
