export const loader = () => {
  // Site is Disallow: / in robots.txt, so no URLs to expose. Return a valid
  // empty sitemap so crawler requests stop throwing "No route matches".
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>
`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
