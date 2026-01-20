import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  // Polaris i18n configuration  const i18n = {
    Polaris: {
      Avatar: {
        label: "Avatar",
        labelWithInitials: "Avatar with initials {initials}",
      },
      ContextualSaveBar: {
        save: "Save",
        discard: "Discard",
      },
      TextField: {
        characterCount: "{count} characters",
      },
      TopBar: {
        toggleMenuLabel: "Toggle menu",
      },
      Modal: {
        iFrameTitle: "body markup",
      },
      Frame: {
        skipToContent: "Skip to content",
        navigationLabel: "Navigation",
        Navigation: {
          closeMobileNavigationLabel: "Close navigation",
        },
      },
    },
  };

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={i18n}>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
