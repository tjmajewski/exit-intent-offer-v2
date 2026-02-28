import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
import * as Sentry from "@sentry/remix";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  // Log to Sentry
  Sentry.captureException(error);

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{
          padding: 48,
          textAlign: 'center',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column'
        }}>
          <h1 style={{ fontSize: 24, marginBottom: 16, color: '#1f2937' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 400 }}>
            We've been notified and are working on it. Please try refreshing the page.
          </p>
          <pre style={{
            background: '#f3f4f6',
            padding: 16,
            borderRadius: 8,
            fontSize: 12,
            textAlign: 'left',
            maxWidth: 700,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            marginBottom: 24,
            color: '#dc2626'
          }}>
            {message}
            {stack ? `\n\n${stack}` : ''}
          </pre>
          <a
            href="/app"
            style={{
              color: '#8B5CF6',
              textDecoration: 'underline',
              fontSize: 16
            }}
          >
            Go back home
          </a>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
