// Super admin console layout. NOT embedded in Shopify — standalone,
// password-protected operator console. See SUPER_ADMIN_GUIDE.md.
import { Outlet, Link, useLocation } from "react-router";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { ADMIN_RESPONSE_HEADERS } from "../utils/admin-auth.server.js";

export async function loader() {
  // Auth is enforced per-child-route (login must stay reachable). The layout
  // only stamps anti-index headers.
  return null;
}

export function headers() {
  return ADMIN_RESPONSE_HEADERS;
}

const NAV = [
  { to: "/admin", label: "Customers" },
  { to: "/admin/ai", label: "AI Dashboard" },
];

export default function AdminLayout() {
  const location = useLocation();
  const isLogin = location.pathname.startsWith("/admin/login");

  return (
    <PolarisAppProvider i18n={{}}>
      <div style={{ minHeight: "100vh", background: "#f6f6f7" }}>
        {!isLogin && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "24px",
              padding: "12px 24px",
              background: "#1a1a19",
              color: "#ffffff",
            }}
          >
            <span style={{ fontWeight: 700 }}>Resparq · Super Admin</span>
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  color:
                    location.pathname === item.to ||
                    (item.to !== "/admin" && location.pathname.startsWith(item.to))
                      ? "#ffffff"
                      : "#c3c2b7",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {item.label}
              </Link>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <Link to="/admin/logout" style={{ color: "#c3c2b7", textDecoration: "none" }}>
                Log out
              </Link>
            </div>
          </div>
        )}
        <Outlet />
      </div>
    </PolarisAppProvider>
  );
}
