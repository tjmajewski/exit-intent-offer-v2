// No favicon for the app backend; return 204 so bots/browsers stop 500ing.
export const loader = () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "public, max-age=604800",
    },
  });
};
