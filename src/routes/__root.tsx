import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { LanguageProvider, useLang } from "../lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn't exist. Head back to your farm dashboard.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again in a moment.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#9a3412" },
      { title: "MirchiRakshak AI — Smart chili farming assistant" },
      { name: "description", content: "AI-powered disease detection, weather intelligence, and voice guidance for chili farmers. Works in Telugu, Hindi and English." },
      { name: "author", content: "MirchiRakshak" },
      { property: "og:title", content: "MirchiRakshak AI" },
      { property: "og:description", content: "AI-powered chili farming assistant. Detect diseases, predict outbreaks, get treatment plans in your language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/mirchi-icon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Telugu:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const unsubscribeFirebase = onAuthStateChanged(auth, () => {
      router.invalidate();
      queryClient.invalidateQueries();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });

    return () => {
      unsubscribeFirebase();
      sub.subscription.unsubscribe();
    };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RootOutlet />
        <Toaster position="top-center" richColors closeButton />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function RootOutlet() {
  const { setLang } = useLang();

  // Load user's language preference from database on mount and auth changes
  useEffect(() => {
    const loadUserLanguage = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
          if (!data) {
            const meta = user.user_metadata || {};
            await supabase.from("profiles").upsert({
              id: user.id,
              full_name: meta.full_name || meta.name || user.email?.split("@")[0] || "Farmer",
              phone: meta.phone || null,
              district: "Guntur",
              language: "en",
            });
          } else if (data?.language) {
            setLang(data.language as "en" | "hi" | "te");
          }
        }
      } catch (error) {
        console.error("Failed to sync user profile/language:", error);
      }
    };

    loadUserLanguage();

    // Subscribe to auth changes to reload language preference
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadUserLanguage();
    });

    return () => sub.subscription.unsubscribe();
  }, [setLang]);

  return (
    <>
      <Outlet />
    </>
  );
}
