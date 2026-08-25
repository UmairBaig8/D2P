export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
  'access-control-max-age': '86400',
};

export function corsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
