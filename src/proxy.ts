import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs before routes render: refreshes the Supabase session cookie and keeps signed-out
 * visitors out of the authenticated workspace. Authorization is still enforced again in
 * every route handler and by row-level security; this is a UX guard, not the only gate.
 */
const PROTECTED = [/^\/app(\/|$)/, /^\/admin(\/|$)/];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Supabase not configured: the app runs in demo workspace mode (see lib/auth/session.ts).
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && PROTECTED.some((re) => re.test(request.nextUrl.pathname))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|api/stripe/webhook|api/cron|api/webhooks|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|json)$).*)"],
};
