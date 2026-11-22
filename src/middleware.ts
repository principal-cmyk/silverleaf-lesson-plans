import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  ACCESS_PATH,
  accessToken,
  gatePageHtml,
  isTunnelRequest,
  safeEqual,
  safeNext,
} from "./lib/accessGate";
import { routing } from "./i18n/routing";

/**
 * Locale negotiation (next-intl v4) plus the public-tunnel access gate.
 *
 * Redirects locale-less requests to a prefixed path (e.g. `/` → `/en`) and
 * makes the matched `[locale]` segment available to `src/i18n/request.ts`.
 * Only page paths get locale negotiation; `/api` and file-like paths skip it
 * but are still access-gated.
 *
 * @see docs/i18n.md
 */
const intl = createMiddleware(routing);

function needsLocale(pathname: string): boolean {
  return !pathname.startsWith("/api") && !pathname.includes(".");
}

export default async function middleware(request: NextRequest) {
  const code = process.env["SITE_ACCESS_CODE"]?.trim();
  const secret = process.env["SESSION_SECRET"] ?? "";

  if (code && isTunnelRequest(request.headers)) {
    // Fail closed: a gate configured without a signing secret serves nothing.
    if (!secret) return new NextResponse("Service unavailable", { status: 503 });
    const expected = await accessToken(code, secret);

    if (request.nextUrl.pathname === ACCESS_PATH && request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const given = String(form?.get("code") ?? "").trim();
      const next = safeNext(String(form?.get("next") ?? ""));
      if (!safeEqual(given, code)) {
        return new NextResponse(gatePageHtml(true, next), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const res = NextResponse.redirect(new URL(next, request.nextUrl.origin), 303);
      res.cookies.set(ACCESS_COOKIE, expected, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }

    const cookie = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
    if (!safeEqual(cookie, expected)) {
      const { pathname, search } = request.nextUrl;
      return new NextResponse(gatePageHtml(false, pathname + search), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }

  return needsLocale(request.nextUrl.pathname) ? intl(request) : NextResponse.next();
}

export const config = {
  /**
   * Node runtime so SITE_ACCESS_CODE / SESSION_SECRET are read at request
   * time; the edge runtime would inline them at build time.
   */
  runtime: "nodejs",
  /**
   * Run on every pathname EXCEPT Next.js build assets and `/_vercel`.
   * (`/api` and dotted paths are matched so the access gate covers them;
   * `needsLocale` keeps them out of locale negotiation.)
   */
  matcher: ["/", "/((?!_next/static|_next/image|_vercel|favicon.ico).*)"],
};
