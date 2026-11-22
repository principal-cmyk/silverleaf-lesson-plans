/**
 * Shared access-code gate for traffic arriving through the public tunnel.
 *
 * Cloudflare's tunnel adds `cf-connecting-ip` to every request it forwards and
 * a client cannot strip it, so "has that header" == "came from the internet".
 * Local (localhost / school LAN) requests carry no such header and are never
 * gated. The gate is OFF unless SITE_ACCESS_CODE is set.
 *
 * Edge-runtime safe (Web Crypto only) because it runs in `middleware.ts`.
 * It reads process.env directly for the same reason: `src/lib/env.ts` is a
 * Node-side module.
 */

export const ACCESS_COOKIE = "sl_access";
export const ACCESS_PATH = "/__access";

const encoder = new TextEncoder();

export function isTunnelRequest(headers: Headers): boolean {
  return headers.has("cf-connecting-ip");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/**
 * Cookie value: HMAC of the access code keyed by the session secret. Changing
 * either the code or the secret invalidates every issued cookie.
 */
export async function accessToken(code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`access-gate:${code}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only same-site relative paths may be used as the post-unlock destination. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith(ACCESS_PATH)) return "/";
  return next;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function gatePageHtml(failed: boolean, next = "/"): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Silverleaf Academy</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7f4;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 12px #0002;max-width:22rem;width:calc(100% - 2rem)}
h1{font-size:1.2rem;margin:0 0 .5rem}p{color:#555;margin:0 0 1rem;font-size:.9rem}
input,button{width:100%;box-sizing:border-box;padding:.7rem;font-size:1rem;border-radius:8px}
input{border:1px solid #bbb;margin-bottom:.75rem}button{border:0;background:#1f6f43;color:#fff;cursor:pointer}
.err{color:#b00020}</style></head><body>
<form method="post" action="${ACCESS_PATH}">
<input type="hidden" name="next" value="${escapeAttr(safeNext(next))}"><h1>Silverleaf Academy Lesson Plans</h1>
<p>Enter the staff access code you were given.</p>
${failed ? '<p class="err">That code is not correct.</p>' : ""}
<input name="code" type="password" autocomplete="off" autofocus required>
<button type="submit">Continue</button></form></body></html>`;
}
