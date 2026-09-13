export const loader = () => {
  const body = `User-agent: *
Disallow: /
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
