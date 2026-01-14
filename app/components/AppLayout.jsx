import { Link, useLocation, useFetcher } from "react-router";

function DevPlanSwitcher({ plan }) {
  const fetcher = useFetcher();
  
  if (process.env.NODE_ENV !== 'development' || !plan) {
    return null;
  }
  
  return (
    <div style={{
      position: "absolute",
      bottom: 100,
      left: 24,
      right: 24,
      padding: 12,
      background: "rgba(251, 191, 36, 0.2)",
      border: "1px solid rgba(251, 191, 36, 0.4)",
      borderRadius: 6,
      fontSize: 11
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: "#fbbf24" }}>
        🔧 DEV MODE
      </div>
      <fetcher.Form method="post" action="/app/dev-update-plan">
        <select
          name="tier"
          defaultValue={plan.tier}
          onChange={(e) => {
            e.target.form.requestSubmit();
          }}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 4,
            color: '#1f2937',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </fetcher.Form>
    </div>
  );
}

export default function AppLayout({ children, plan }) {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;
  
  const getIcon = (iconName) => {
    const icons = {
      dashboard: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      ),
      settings: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M23 12h-6m-6 0H1m18.8 5.2l-4.2-4.2m0-6l4.2-4.2"></path>
        </svg>
      ),
      analytics: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="20" x2="12" y2="10"></line>
          <line x1="18" y1="20" x2="18" y2="4"></line>
          <line x1="6" y1="20" x2="6" y2="16"></line>
        </svg>
      ),
      promotions: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
      ),
      cart: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
      ),
      upgrade: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14"></path>
          <path d="M12 5l7 7-7 7"></path>
        </svg>
      )
    };
    return icons[iconName];
  };

  const navItems = [
    { path: "/app", label: "Dashboard", icon: "dashboard" },
    { path: "/app/settings", label: "Settings", icon: "settings" },
    { 
      path: "/app/analytics", 
      label: "Performance", 
      icon: "analytics",
      badge: plan?.tier === "starter" ? "PRO" : null
    },
    { 
      path: "/app/conversions", 
      label: "Conversions", 
      icon: "cart",
      badge: plan?.tier === "starter" ? "PRO" : null
    },
    { 
      path: "/app/promotions", 
      label: "Promotions", 
      icon: "promotions",
      badge: plan?.tier !== "enterprise" ? "ENTERPRISE" : null
    },
    ...(plan?.tier !== "enterprise" ? [{ path: "/app/upgrade", label: "Upgrade", icon: "upgrade", highlight: true }] : [])
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
          <img 
            src="/resparq_outline_final.svg" 
            alt="ResparQ" 
            style={{ 
              width: "100%", 
              height: "auto",
              maxWidth: 180
            }} 
          />
          <p style={{ fontSize: 12, opacity: 0.7, margin: "8px 0 0 0" }}>Performance-first exit intent</p>
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
                {getIcon(item.icon)}
                <span style={{ fontSize: 14, fontWeight: isActive(item.path) ? 600 : 400 }}>
                  {item.label}
                </span>
              </div>
              {item.badge && (
                <span style={{
                  padding: "2px 6px",
                  background: item.badge === "ENTERPRISE" ? "#fbbf24" : "#8B5CF6",
                  color: item.badge === "ENTERPRISE" ? "#78350f" : "white",
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

        {/* DEV: Plan Switcher */}
        <DevPlanSwitcher plan={plan} />

        {/* Plan Badge at Bottom */}
        {plan && (
          <div style={{
            position: "absolute",
            bottom: process.env.NODE_ENV === 'development' ? 180 : 24,
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