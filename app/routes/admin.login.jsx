import { redirect, Form, useActionData } from "react-router";
import { Card, Page, TextField, Button, Banner, BlockStack, Text } from "@shopify/polaris";
import { useState } from "react";
import {
  isAdminConfigured,
  verifyAdminPassword,
  createAdminSessionCookie,
  hasValidAdminSession,
  ADMIN_RESPONSE_HEADERS,
} from "../utils/admin-auth.server.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { logAdminAction } from "../utils/admin-audit.server.js";

export function headers() {
  return ADMIN_RESPONSE_HEADERS;
}

export async function loader({ request }) {
  if (isAdminConfigured() && hasValidAdminSession(request)) {
    throw redirect("/admin");
  }
  return { configured: isAdminConfigured() };
}

export async function action({ request }) {
  // Fail closed when unconfigured; brute-force protection on top.
  if (!isAdminConfigured()) {
    return { error: "Admin console is not configured on this deployment." };
  }
  const limited = enforceRateLimit(request, "admin-login", {
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (limited) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  const formData = await request.formData();
  const password = formData.get("password");

  if (!verifyAdminPassword(password)) {
    await logAdminAction(request, "login_failed");
    return { error: "Wrong password." };
  }

  await logAdminAction(request, "login");
  throw redirect("/admin", {
    headers: { "Set-Cookie": createAdminSessionCookie() },
  });
}

export default function AdminLogin() {
  const actionData = useActionData();
  const [password, setPassword] = useState("");

  return (
    <Page narrowWidth title="Super Admin">
      <Card>
        <Form method="post">
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Operator login
            </Text>
            {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
            <TextField
              label="Admin password"
              type="password"
              name="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <Button submit variant="primary">
              Log in
            </Button>
          </BlockStack>
        </Form>
      </Card>
    </Page>
  );
}
