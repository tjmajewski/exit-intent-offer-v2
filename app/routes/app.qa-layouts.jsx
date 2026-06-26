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
      shop: { shopifyDomain: shop.shopifyDomain },
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
