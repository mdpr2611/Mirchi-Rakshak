import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) return { user: session.user };

      const { data: { user } } = await supabase.auth.getUser();
      if (user) return { user };
    } catch (e) {
      console.warn("Supabase auth check:", e);
    }

    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});

