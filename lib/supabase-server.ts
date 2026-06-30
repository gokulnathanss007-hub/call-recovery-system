import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cookie-bound Supabase client for Server Components / Route Handlers / Server Actions.
// Runs as the signed-in user — RLS policies (see supabase/migrations/002_*) scope every
// query to that user's own clinic. Distinct from lib/supabase.ts, which is the
// service-role client used by webhooks and the Trigger.dev job to bypass RLS.
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — middleware refreshes the
            // session cookie on the next request, so this is safe to ignore.
          }
        },
      },
    }
  );
}
