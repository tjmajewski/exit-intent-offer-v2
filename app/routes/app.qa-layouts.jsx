import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useState } from "react";
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
  const { plan, shop, layouts, enabledCount, staleVariantCount, dbError } = data;
  const fetcher = useFetcher();
  const [toast, setToast] = useState(null);

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
          <strong>Before you preview:</strong> Preview shows the pop-up on your real theme. If nothing
          appears, turn on the Resparq app embed under Online Store → Themes → Customize → App embeds.
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
          {layouts.map((l) => {
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
                <div style={{ marginBottom: 12, position: "relative", filter: l.enabled ? "none" : "grayscale(1)" }}>
                  <LayoutThumbnail id={l.id} />
                </div>

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
                  <a
                    href={previewUrl(l.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "10px 12px",
                      background: "#111827",
                      color: "white",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Preview on store
                  </a>

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

                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, lineHeight: 1.5 }}>
                  Opens your live store in a new tab with this pop-up showing. Nothing is tracked and no
                  discount is created.
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Toast message={toast?.message} tone={toast?.tone} onDone={() => setToast(null)} />
    </AppLayout>
  );
}
