import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import AppLayout from "../components/AppLayout";
import { getShopPlan } from "../utils/plan.server";
import {
  MODAL_LAYOUTS,
  ALL_LAYOUT_IDS,
  parseDisabledLayouts,
  getEnabledLayoutIds,
} from "../utils/templates.js";

// =============================================================================
// Pop-up QA — preview every layout on the live theme and turn off any that
// clash. Disabled layouts are stored on Shop.disabledLayouts (JSON string[]).
// The genetic engine stops generating them and ai-decision clamps any that
// slip through, so a turned-off pop-up can never reach a shopper.
// =============================================================================

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const layoutId = formData.get("layoutId");
    const disable = formData.get("disable") === "true";

    if (intent !== "toggle" || !ALL_LAYOUT_IDS.includes(layoutId)) {
      return { success: false, message: "Couldn't save that change. Your layouts are unchanged. Try again." };
    }

    const shop = await db.shop.findUnique({ where: { shopifyDomain: session.shop } });
    if (!shop) {
      return { success: false, message: "Couldn't save that change. Your layouts are unchanged. Try again." };
    }

    const disabled = new Set(parseDisabledLayouts(shop.disabledLayouts));

    if (disable) {
      // Guard: never let the merchant turn off the last enabled layout —
      // shoppers need something to see.
      const remainingEnabled = ALL_LAYOUT_IDS.filter((id) => !disabled.has(id) && id !== layoutId);
      if (remainingEnabled.length === 0) {
        return { success: false, message: "Keep at least one layout on. Shoppers need something to see." };
      }
      disabled.add(layoutId);
    } else {
      disabled.delete(layoutId);
    }

    await db.shop.update({
      where: { id: shop.id },
      data: { disabledLayouts: JSON.stringify([...disabled]) },
    });

    const name = MODAL_LAYOUTS[layoutId]?.name || layoutId;
    return {
      success: true,
      message: disable
        ? `${name} disabled. The AI won't show it to shoppers.`
        : `${name} enabled. The AI can test it with shoppers again.`,
    };
  } catch (error) {
    console.error("[QA Layouts] action error:", error);
    return { success: false, message: "Couldn't save that change. Your layouts are unchanged. Try again." };
  }
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const plan = await getShopPlan(session);

  try {
    const shop = await db.shop.findUnique({ where: { shopifyDomain: session.shop } });
    if (!shop) {
      return { plan, shop: null, layouts: [], staleVariantCount: 0, dbError: false };
    }

    const disabled = parseDisabledLayouts(shop.disabledLayouts);
    const disabledSet = new Set(disabled);

    const layouts = Object.values(MODAL_LAYOUTS).map((l) => ({
      ...l,
      enabled: !disabledSet.has(l.id),
    }));

    // Surface the runtime-fallback case: live variants still pointing at a
    // disabled layout will be shown as Classic Card until they evolve out.
    let staleVariantCount = 0;
    if (disabled.length > 0) {
      staleVariantCount = await db.variant.count({
        where: {
          shopId: shop.id,
          status: { in: ["alive", "champion"] },
          templateId: { in: disabled },
        },
      });
    }

    return {
      plan,
      shop: { shopifyDomain: shop.shopifyDomain, mode: shop.mode },
      layouts,
      enabledCount: getEnabledLayoutIds(shop.disabledLayouts).length,
      staleVariantCount,
      // Brand tokens so the in-app preview renders in the merchant's colors/font,
      // matching how the storefront builds modal props (brandFromSettings).
      brand: {
        primary: shop.brandPrimaryColor,
        secondary: shop.brandSecondaryColor,
        accent: shop.brandAccentColor,
        font: shop.brandFont,
      },
      showPoweredBy: plan?.tier !== "enterprise",
      dbError: false,
    };
  } catch (error) {
    console.error("[QA Layouts] loader error:", error);
    return { plan, shop: null, layouts: [], staleVariantCount: 0, dbError: true };
  }
}

// Schematic wireframe of where/how each layout sits on the page. Position and
// footprint are what clash with a theme, so this gives merchants an at-a-glance
// read before they open a full storefront preview. Purely illustrative — the
// real render is the "Preview on store" button.
function LayoutThumbnail({ id }) {
  const dark = "#1f2937";
  const accent = "#008060";
  const line = "#cbd5e1";

  // Shared "browser page" frame: light canvas + a faux header bar.
  const Frame = ({ children }) => (
    <svg viewBox="0 0 300 150" width="100%" height="118" role="img" preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", borderRadius: 8, background: "#f8fafc", border: "1px solid #eef2f7" }}>
      <rect x="0" y="0" width="300" height="22" fill="#eef2f7" />
      <circle cx="12" cy="11" r="3" fill="#cbd5e1" />
      <circle cx="22" cy="11" r="3" fill="#cbd5e1" />
      <circle cx="32" cy="11" r="3" fill="#cbd5e1" />
      <rect x="44" y="6" width="120" height="10" rx="3" fill="#dbe3ec" />
      {/* faint page content lines */}
      <rect x="20" y="34" width="180" height="6" rx="3" fill="#e9eef3" />
      <rect x="20" y="46" width="140" height="6" rx="3" fill="#e9eef3" />
      <rect x="20" y="118" width="160" height="6" rx="3" fill="#e9eef3" />
      <rect x="20" y="130" width="110" height="6" rx="3" fill="#e9eef3" />
      {children}
    </svg>
  );

  switch (id) {
    case "top-banner":
      return (
        <Frame>
          <rect x="0" y="22" width="300" height="20" fill={dark} />
          <rect x="12" y="29" width="150" height="6" rx="3" fill="#fff" opacity="0.9" />
          <rect x="236" y="27" width="52" height="10" rx="5" fill={accent} />
        </Frame>
      );
    case "bottom-sheet":
      return (
        <Frame>
          <rect x="0" y="100" width="300" height="50" rx="10" fill={dark} />
          <rect x="130" y="106" width="40" height="3" rx="1.5" fill="#fff" opacity="0.5" />
          <rect x="20" y="116" width="150" height="7" rx="3" fill="#fff" opacity="0.9" />
          <rect x="20" y="130" width="100" height="5" rx="2.5" fill="#fff" opacity="0.5" />
          <rect x="214" y="118" width="66" height="16" rx="8" fill={accent} />
        </Frame>
      );
    case "coupon-ticket":
      return (
        <Frame>
          <rect x="60" y="48" width="180" height="60" rx="8" fill={dark}
            stroke="#9ca3af" strokeWidth="2" strokeDasharray="5 4" />
          <circle cx="60" cy="78" r="8" fill="#f8fafc" />
          <circle cx="240" cy="78" r="8" fill="#f8fafc" />
          <rect x="78" y="62" width="120" height="9" rx="4" fill={accent} />
          <rect x="78" y="80" width="90" height="6" rx="3" fill="#fff" opacity="0.7" />
        </Frame>
      );
    case "split-hero":
      return (
        <Frame>
          <rect x="40" y="44" width="220" height="64" rx="8" fill="#fff" stroke={line} />
          <rect x="40" y="44" width="100" height="64" rx="8" fill={accent} />
          <rect x="140" y="44" width="2" height="64" fill={line} />
          <rect x="156" y="58" width="88" height="7" rx="3" fill={dark} />
          <rect x="156" y="72" width="64" height="5" rx="2.5" fill="#9ca3af" />
          <rect x="156" y="90" width="56" height="12" rx="6" fill={accent} />
        </Frame>
      );
    case "timer-front":
      return (
        <Frame>
          <rect x="70" y="42" width="160" height="68" rx="8" fill="#fff" stroke={line} />
          <rect x="106" y="52" width="36" height="14" rx="3" fill={dark} />
          <rect x="146" y="52" width="36" height="14" rx="3" fill={dark} />
          <rect x="186" y="52" width="14" height="14" rx="3" fill={dark} />
          <rect x="92" y="74" width="116" height="6" rx="3" fill="#9ca3af" />
          <rect x="112" y="88" width="76" height="14" rx="7" fill={accent} />
        </Frame>
      );
    case "testimonial":
      return (
        <Frame>
          <rect x="70" y="42" width="160" height="68" rx="8" fill="#fff" stroke={line} />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={108 + i * 17} cy="56" r="4" fill="#f59e0b" />
          ))}
          <rect x="92" y="70" width="116" height="6" rx="3" fill="#9ca3af" />
          <rect x="100" y="82" width="100" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="112" y="94" width="76" height="12" rx="6" fill={accent} />
        </Frame>
      );
    case "scratch-reveal":
      return (
        <Frame>
          <rect x="74" y="44" width="152" height="64" rx="8" fill="#fff" stroke={line} />
          <rect x="92" y="58" width="116" height="36" rx="6" fill="#9ca3af" />
          <path d="M92 94 L208 58" stroke="#fff" strokeWidth="3" opacity="0.7" />
          <path d="M92 80 L150 58" stroke="#fff" strokeWidth="3" opacity="0.5" />
          <rect x="120" y="98" width="60" height="6" rx="3" fill={accent} />
        </Frame>
      );
    case "classic-card":
    default:
      return (
        <Frame>
          <rect x="0" y="22" width="300" height="128" fill="#0f172a" opacity="0.18" />
          <rect x="84" y="44" width="132" height="66" rx="10" fill="#fff" stroke={line} />
          <rect x="100" y="56" width="100" height="8" rx="4" fill={dark} />
          <rect x="100" y="70" width="76" height="5" rx="2.5" fill="#9ca3af" />
          <rect x="100" y="90" width="64" height="13" rx="6.5" fill={accent} />
        </Frame>
      );
  }
}

// Build the srcdoc for the preview iframe. The iframe is a same-origin blank
// document we fully control (no storefront CSP/X-Frame-Options involved), sized
// to the chosen device. Because the storefront renderer keys "mobile" off
// `matchMedia('(max-width: 768px)')` against the iframe's own viewport, sizing
// the iframe to a phone width makes the modal render its real mobile behavior —
// accurate desktop/mobile without any device spoofing.
function buildPreviewSrcDoc({ layoutId, brand, showPoweredBy }) {
  const cfg = JSON.stringify({ layoutId, brand: brand || {}, showPoweredBy: showPoweredBy !== false });
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html,body{margin:0;padding:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  body{background:#eef1f5;}
  header.rq-h{height:52px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;padding:0 18px;gap:10px;}
  .rq-logo{width:96px;height:14px;border-radius:4px;background:#d6dbe2;}
  .rq-nav{flex:1;display:flex;gap:14px;justify-content:flex-end;}
  .rq-nav span{width:46px;height:8px;border-radius:4px;background:#e3e7ec;}
  .rq-body{padding:22px;}
  .rq-body .l{height:9px;border-radius:5px;background:#e3e7ec;margin:0 0 12px;}
  .rq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:14px;margin-top:18px;}
  .rq-grid .c{height:120px;border-radius:10px;background:#e3e7ec;}
</style></head>
<body>
  <header class="rq-h"><div class="rq-logo"></div><div class="rq-nav"><span></span><span></span><span></span></div></header>
  <div class="rq-body">
    <div class="l" style="width:60%"></div>
    <div class="l" style="width:42%"></div>
    <div class="rq-grid"><div class="c"></div><div class="c"></div><div class="c"></div><div class="c"></div><div class="c"></div><div class="c"></div></div>
  </div>
  <script>window.__RQ = ${cfg};</script>
  <script src="/qa-modal-templates.js"></script>
  <script>
    (function () {
      function go(tries) {
        if (!window.ResparqTemplates || typeof window.ResparqTemplates.render !== 'function') {
          if (tries > 60) return;
          return setTimeout(function () { go((tries || 0) + 1); }, 25);
        }
        var c = window.__RQ, b = c.brand || {};
        function custom(v, def) { return v && v !== def ? v : undefined; }
        var props = {
          headline: 'Wait, your 15% off is still here',
          subhead: 'Finish checkout and your discount applies automatically.',
          cta: 'Claim My Discount',
          secondaryCta: 'No thanks',
          showSecondary: true,
          code: 'PREVIEW15',
          amountText: '15%',
          timerEndsAt: c.layoutId === 'timer-front' ? Date.now() + 86400000 : null,
          showPoweredBy: c.showPoweredBy,
          themeOverrides: {
            primary: custom(b.accent, '#f59e0b'),
            background: custom(b.secondary, '#ffffff') || '#ffffff',
            foreground: custom(b.primary, '#000000'),
            fontFamily: b.font && b.font !== 'system' ? b.font : undefined
          }
        };
        try {
          var h = window.ResparqTemplates.render(c.layoutId, props);
          if (h && h.overlay) {
            h.overlay.style.position = 'fixed';
            h.overlay.style.inset = '0';
            document.body.appendChild(h.overlay);
            var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
            if (h.primaryCta) h.primaryCta.onclick = stop;
            if (h.secondaryCta) h.secondaryCta.onclick = stop;
            if (h.closeBtn) h.closeBtn.style.display = 'none';
          }
        } catch (err) { /* preview-only; ignore */ }
      }
      go(0);
    })();
  </script>
</body></html>`;
}

// Full-screen in-admin preview: renders the real storefront template inside a
// device-sized iframe, with desktop/mobile toggle and layout switching.
function PreviewOverlay({ layouts, index, device, brand, showPoweredBy, previewUrl, onSetIndex, onSetDevice, onClose, fetcher }) {
  const layout = layouts[index];

  // Reload the iframe whenever the layout or device changes.
  const srcDoc = useMemo(
    () => buildPreviewSrcDoc({ layoutId: layout.id, brand, showPoweredBy }),
    [layout.id, brand, showPoweredBy],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onSetIndex((index + 1) % layouts.length);
      else if (e.key === "ArrowLeft") onSetIndex((index - 1 + layouts.length) % layouts.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, layouts.length, onClose, onSetIndex]);

  const isMobile = device === "mobile";
  const frameW = isMobile ? 390 : 1000;
  const frameH = isMobile ? 760 : 600;

  const deviceBtn = (id, label) => (
    <button
      onClick={() => onSetDevice(id)}
      style={{
        padding: "6px 14px",
        border: "1px solid " + (device === id ? "#111827" : "#d1d5db"),
        background: device === id ? "#111827" : "white",
        color: device === id ? "white" : "#374151",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 3000,
        background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 16, width: "100%", maxWidth: 1080,
          maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 24px 70px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{layout.name}</div>
          <span
            style={{
              padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: layout.enabled ? "#dcfce7" : "#fee2e2",
              color: layout.enabled ? "#166534" : "#991b1b",
            }}
          >
            {layout.enabled ? "On" : "Off"}
          </span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {deviceBtn("desktop", "Desktop")}
            {deviceBtn("mobile", "Mobile")}
          </div>
          <button
            onClick={onClose}
            aria-label="Close preview"
            style={{ marginLeft: 8, width: 32, height: 32, borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "#6b7280" }}
          >
            ×
          </button>
        </div>

        {/* Stage */}
        <div style={{ flex: 1, overflow: "auto", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div
            style={{
              width: frameW, maxWidth: "100%", height: frameH, maxHeight: "100%",
              background: "white", borderRadius: isMobile ? 28 : 12,
              border: isMobile ? "8px solid #111827" : "1px solid #cbd5e1",
              overflow: "hidden", boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
            }}
          >
            <iframe
              key={device}
              title={`${layout.name} preview (${device})`}
              srcDoc={srcDoc}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderTop: "1px solid #e5e7eb" }}>
          <button
            onClick={() => onSetIndex((index - 1 + layouts.length) % layouts.length)}
            style={{ padding: "8px 14px", border: "1px solid #d1d5db", background: "white", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            ← Previous
          </button>
          <button
            onClick={() => onSetIndex((index + 1) % layouts.length)}
            style={{ padding: "8px 14px", border: "1px solid #d1d5db", background: "white", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Next →
          </button>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{index + 1} of {layouts.length}</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <a
              href={previewUrl(layout.id)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: "8px 14px", border: "1px solid #d1d5db", background: "white", color: "#374151", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              Open on store
            </a>
            <fetcher.Form method="post" style={{ margin: 0 }}>
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="layoutId" value={layout.id} />
              <input type="hidden" name="disable" value={layout.enabled ? "true" : "false"} />
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  background: layout.enabled ? "white" : "#008060",
                  color: layout.enabled ? "#dc2626" : "white",
                  border: layout.enabled ? "1px solid #fca5a5" : "1px solid #008060",
                  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                {layout.enabled ? "Disable" : "Enable"}
              </button>
            </fetcher.Form>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, tone, onDone }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: tone === "error" ? "#7f1d1d" : "#111827",
        color: "white",
        padding: "12px 20px",
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        zIndex: 2000,
        maxWidth: 480,
      }}
    >
      {message}
    </div>
  );
}

export default function QaLayouts() {
  const data = useLoaderData();
  const { plan, shop, layouts, enabledCount, staleVariantCount, dbError, brand, showPoweredBy } = data;
  const fetcher = useFetcher();
  const [toast, setToast] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [device, setDevice] = useState("desktop");

  // Surface action results as a toast (success or failure).
  useEffect(() => {
    if (fetcher.data?.message) {
      setToast({ message: fetcher.data.message, tone: fetcher.data.success ? "info" : "error" });
    }
  }, [fetcher.data]);

  if (dbError) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40 }}>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Pop-up QA</h1>
          <div style={{ background: "white", padding: 48, borderRadius: 8, border: "1px solid #e5e7eb", textAlign: "center" }}>
            <p style={{ color: "#666" }}>{"Couldn't load your layouts right now. Refresh to try again."}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!shop) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40 }}>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Pop-up QA</h1>
          <p style={{ color: "#666" }}>No shop data found.</p>
        </div>
      </AppLayout>
    );
  }

  const previewUrl = (id) => `https://${shop.shopifyDomain}/?resparqPreview=${id}`;
  const busyLayoutId = fetcher.state !== "idle" ? fetcher.formData?.get("layoutId") : null;

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Pop-up QA</h1>
          <p style={{ color: "#666", marginBottom: 0 }}>
            {"Preview each pop-up layout on your live theme and turn off any that don't fit. The AI only shows shoppers the layouts you keep on."}
          </p>
        </div>

        {/* Prerequisite banner — preview only renders if the app embed is on */}
        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            fontSize: 13,
            color: "#1e3a8a",
            lineHeight: 1.6,
          }}
        >
          <strong>Two ways to preview.</strong> {"“Preview here” renders the exact pop-up in desktop and mobile, right in this page. To also check it against your real theme, use “Open on your live store” — that one needs the Resparq app embed on (Online Store → Themes → Customize → App embeds)."}
        </div>

        {/* Mode-aware note — disabling only affects AI-mode auto-selection */}
        {shop.mode !== "ai" && (
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              fontSize: 13,
              color: "#4b5563",
              lineHeight: 1.6,
            }}
          >
            {"You're in Manual mode, so your storefront always uses the one layout you picked in Settings. These on/off controls take effect when you switch to AI mode and let it choose layouts for you. Preview still works either way."}
          </div>
        )}

        {/* Stale-variant note — runtime fallback in effect */}
        {staleVariantCount > 0 && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              fontSize: 13,
              color: "#78350f",
              lineHeight: 1.6,
            }}
          >
            Some saved variants used a layout you turned off. Shoppers see Classic Card instead until
            those variants evolve out.
          </div>
        )}

        <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
          {enabledCount} of {layouts.length} layouts enabled
        </div>

        {/* Layout grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          {layouts.map((l, idx) => {
            const isBusy = busyLayoutId === l.id;
            return (
              <div
                key={l.id}
                style={{
                  background: "white",
                  border: `2px solid ${l.enabled ? "#e5e7eb" : "#fca5a5"}`,
                  borderRadius: 12,
                  padding: 20,
                  opacity: l.enabled ? 1 : 0.75,
                  transition: "all 0.2s",
                }}
              >
                <button
                  type="button"
                  onClick={() => { setDevice("desktop"); setPreviewIndex(idx); }}
                  title="Preview this layout here"
                  style={{
                    display: "block", width: "100%", padding: 0, border: "none", background: "none",
                    cursor: "pointer", marginBottom: 12, position: "relative",
                    filter: l.enabled ? "none" : "grayscale(1)",
                  }}
                >
                  <LayoutThumbnail id={l.id} />
                </button>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>{l.name}</div>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: l.enabled ? "#dcfce7" : "#fee2e2",
                      color: l.enabled ? "#166534" : "#991b1b",
                    }}
                  >
                    {l.enabled ? "On" : "Off"}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, minHeight: 36 }}>
                  {l.description}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setDevice("desktop"); setPreviewIndex(idx); }}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      background: "#111827",
                      color: "white",
                      border: "1px solid #111827",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Preview here
                  </button>

                  <fetcher.Form method="post" style={{ margin: 0, flex: 1 }}>
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="layoutId" value={l.id} />
                    <input type="hidden" name="disable" value={l.enabled ? "true" : "false"} />
                    <button
                      type="submit"
                      disabled={isBusy}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: l.enabled ? "white" : "#008060",
                        color: l.enabled ? "#dc2626" : "white",
                        border: l.enabled ? "1px solid #fca5a5" : "1px solid #008060",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: isBusy ? "default" : "pointer",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      {isBusy ? "Saving…" : l.enabled ? "Disable" : "Enable"}
                    </button>
                  </fetcher.Form>
                </div>

                <a
                  href={previewUrl(l.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", fontSize: 12, color: "#2563eb", textDecoration: "none", marginTop: 12, fontWeight: 500 }}
                >
                  Open on your live store ↗
                </a>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6, lineHeight: 1.5 }}>
                  {"“Preview here” shows the exact pop-up in desktop and mobile. “Open on your live store” checks it against your real theme. Nothing is tracked."}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {previewIndex !== null && layouts[previewIndex] && (
        <PreviewOverlay
          layouts={layouts}
          index={previewIndex}
          device={device}
          brand={brand}
          showPoweredBy={showPoweredBy}
          previewUrl={previewUrl}
          onSetIndex={setPreviewIndex}
          onSetDevice={setDevice}
          onClose={() => setPreviewIndex(null)}
          fetcher={fetcher}
        />
      )}

      <Toast message={toast?.message} tone={toast?.tone} onDone={() => setToast(null)} />
    </AppLayout>
  );
}
