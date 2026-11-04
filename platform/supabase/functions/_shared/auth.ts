/**
 * Shared auth helpers for Watchman edge functions.
 * Import with a relative path, e.g. `../_shared/auth.ts`.
 */
const textEncoder = new TextEncoder();

/** Constant-time equality for equal-length UTF-8 byte arrays. Unequal lengths return false. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = textEncoder.encode(a);
  const bb = textEncoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i]! ^ bb[i]!;
  }
  return diff === 0;
}

/** SUPABASE_SERVICE_ROLE_KEY with SERVICE_ROLE_KEY fallback. */
export function getServiceRoleKey(): string | null {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    null
  );
}

/**
 * Fail closed for cron-triggered functions.
 * Returns a Response on failure, or null when the x-cron-secret header matches CRON_SECRET.
 */
export function requireCronSecret(req: Request): Response | null {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!cronSecret) {
    console.error("CRON_SECRET is not set");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(provided, cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/**
 * Fail closed for database-webhook secrets.
 * envName: Deno env key; headerName: request header that carries the secret.
 */
export function requireWebhookSecret(
  req: Request,
  envName: string,
  headerName: string,
): Response | null {
  const secret = Deno.env.get(envName) ?? "";
  if (!secret) {
    console.error(`${envName} is not set`);
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provided = (req.headers.get(headerName) ?? "").trim();
  if (!timingSafeEqual(provided, secret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
