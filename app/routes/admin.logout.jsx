import { redirect } from "react-router";
import { clearAdminSessionCookie } from "../utils/admin-auth.server.js";

export async function loader() {
  throw redirect("/admin/login", {
    headers: { "Set-Cookie": clearAdminSessionCookie() },
  });
}
