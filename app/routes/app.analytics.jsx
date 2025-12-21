import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getDefaultModalLibrary } from "../utils/modalHash";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : { tier: "starter" };

    const modalLibrary = data.data.shop?.modalLibrary?.value
      ? JSON.parse(data.data.shop.modalLibrary.value)
      : getDefaultModalLibrary();

    return { plan, modalLibrary };
  } catch (error) {
    console.error("Error loading analytics:", error);
    return { 
      plan: { tier: "starter" },
      modalLibrary: getDefaultModalLibrary()
    };
  }
}

export default function Analytics() {
  const { plan, modalLibrary } = useLoaderData();
  const canAccessAnalytics = plan ? hasFeature(plan, 'perModalAnalytics') : false;

  if (!canAccessAnalytics) {
    return (
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, marginBottom: 16 }}>Per-Modal Analytics</h1>
        
        <div style={{
          background: "white",
          padding: 48,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Enterprise Feature</h2>
          <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Compare performance across all your modal campaigns, track trends over time, 
            and make data-driven decisions about your exit intent strategy.
          </p>
          
          {/* Blurred preview */}
          <div style={{ filter: "blur(8px)", opacity: 0.5, marginBottom: 32 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ padding: 16, textAlign: "left" }}>Modal Name</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Impressions</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Clicks</th>
                  <th style={{ padding: 16, textAlign: "right" }}>CVR</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 16 }}>Holiday Special 15%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>12,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4,231</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4.2%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$8,420</td>
                </tr>
                <tr>
                  <td style={{ padding: 16 }}>Welcome 10% Off</td>
                  <td style={{ padding: 16, textAlign: "right" }}>8,234</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2.8%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$4,210</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Link
            to="/app/upgrade"
            style={{
              display: "inline-block",
              padding: "12px 32px",
              background: "#8B5CF6",
              color: "white",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 16
            }}
          >
            Upgrade to Enterprise
          </Link>
        </div>

        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Link
            to="/app"
            style={{
              color: "#8B5CF6",
              textDecoration: "none",
              fontSize: 16
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Enterprise view
  const modals = modalLibrary.modals || [];
  const activeModal = modals.find(m => m.modalId === modalLibrary.currentModalId);

  return (
    <div style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Per-Modal Analytics</h1>
        <p style={{ color: "#666" }}>
          Compare performance across all your modal campaigns
        </p>
      </div>

      {/* Current Modal Highlight */}
      {activeModal && (
        <div style={{
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          padding: 24,
          borderRadius: 12,
          color: "white",
          marginBottom: 32
        }}>
          <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 4 }}>Currently Active</div>
          <div style={{ fontSize: 24, fontWeight: "bold" }}>{activeModal.modalName}</div>
          <div style={{ fontSize: 14, opacity: 0.8, marginTop: 8 }}>
            Active since {new Date(activeModal.lastActiveAt).toLocaleDateString()}
          </div>
        </div>
      )}

      {/* Modal Performance Table */}
      <div style={{
        background: "white",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        overflow: "hidden"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Modal Name</th>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Live Dates</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Impressions</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Clicks</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>CTR</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Conversions</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>CVR</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {modals.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
                  No modals created yet. Save your first modal in Settings to start tracking performance.
                </td>
              </tr>
            ) : (
              modals.map((modal) => {
                const ctr = modal.stats.impressions > 0 
                  ? ((modal.stats.clicks / modal.stats.impressions) * 100).toFixed(1)
                  : 0;
                const cvr = modal.stats.impressions > 0
                  ? ((modal.stats.conversions / modal.stats.impressions) * 100).toFixed(1)
                  : 0;

                return (
                  <tr 
                    key={modal.modalId}
                    style={{ 
                      borderBottom: "1px solid #e5e7eb",
                      background: modal.active ? "#f0f9ff" : "white"
                    }}
                  >
                    <td style={{ padding: 16, fontWeight: 500 }}>
                      {modal.modalName}
                      {modal.active && (
                        <span style={{
                          marginLeft: 8,
                          padding: "2px 6px",
                          background: "#10b981",
                          color: "white",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          ACTIVE
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 16, fontSize: 14, color: "#6b7280" }}>
                      {modal.active ? (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - Present
                        </div>
                      ) : (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - {new Date(modal.lastActiveAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.impressions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.clicks.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {ctr}%
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.conversions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>
                      {cvr}%
                    </td>
                    <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: "#10b981" }}>
                      ${modal.stats.revenue.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 32, textAlign: "center" }}>
        <Link
          to="/app"
          style={{
            color: "#8B5CF6",
            textDecoration: "none",
            fontSize: 16
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}