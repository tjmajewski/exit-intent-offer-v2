import { Link, useLocation } from "react-router";

export default function AppLayout({ children, plan }) {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;
  
  const navItems = [
    { path: "/app", label: "Dashboard", icon: "🏠" },
    { path: "/app/settings", label: "Settings", icon: "⚙️" },
    { 
      path: "/app/analytics", 
      label: "Analytics", 
      icon: "📊",
      badge: plan?.tier !== "enterprise" ? "ENTERPRISE" : null
    },
    ...(plan?.tier !== "enterprise" ? [{ path: "/app/upgrade", label: "Upgrade", icon: "🚀", highlight: true }] : [])
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <div style={{
        width: 240,
        background: "#1f2937",
        color: "white",
        padding: "24px 0",
        position: "fixed",
        height: "100vh",
        overflowY: "auto"
      }}>
        {/* Logo */}
        <div style={{ padding: "0 24px", marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Exit Intent Offer</h2>
          <p style={{ fontSize: 12, opacity: 0.7, margin: "4px 0 0 0" }}>Performance-first modals</p>
        </div>

        {/* Navigation */}
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 24px",
                color: "white",
                textDecoration: "none",
                background: isActive(item.path) ? "rgba(139, 92, 246, 0.2)" : "transparent",
                borderLeft: isActive(item.path) ? "3px solid #8B5CF6" : "3px solid transparent",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                if (!isActive(item.path)) {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive(item.path)) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ fontSize: 14, fontWeight: isActive(item.path) ? 600 : 400 }}>
                  {item.label}
                </span>
              </div>
              {item.badge && (
                <span style={{
                  padding: "2px 6px",
                  background: "#8B5CF6",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600
                }}>
                  {item.badge}
                </span>
              )}
              {item.highlight && !item.badge && (
                <span style={{ fontSize: 12, opacity: 0.5 }}>→</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Plan Badge at Bottom */}
        {plan && (
          <div style={{
            position: "absolute",
            bottom: 24,
            left: 24,
            right: 24,
            padding: 12,
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: 6,
            fontSize: 12
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {plan.tier.toUpperCase()} PLAN
            </div>
            <div style={{ opacity: 0.7, fontSize: 11 }}>
              {plan.status === "trialing" ? "Trial Active" : "Active"}
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ marginLeft: 240, flex: 1, background: "#f9fafb" }}>
        {children}
      </div>
    </div>
  );
}