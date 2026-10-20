import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Sign in first." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return json({ error: "Server secrets are missing. Configure Supabase Edge Function secrets." }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData.user) return json({ error: "Invalid session. Sign in again." }, 401);
    const userId = userData.user.id;

    let input: { title?: string; body?: string; url?: string } = {};
    try { input = await req.json(); } catch { /* defaults below */ }
    const title = String(input.title || "Trach Family").slice(0, 120);
    const body = String(input.body || "У тебе є сімейне нагадування.").slice(0, 500);
    const targetUrl = String(input.url || "./");
    if (!targetUrl.startsWith("/") && !targetUrl.startsWith("./") && !targetUrl.startsWith("https://lifhack14-ops.github.io/taxi-manager/")) {
      return json({ error: "Invalid notification URL." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: rows, error: selectError } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, subscription")
      .eq("user_id", userId);
    if (selectError) return json({ error: "Could not load push subscriptions: " + selectError.message }, 500);
    if (!rows?.length) return json({ error: "No devices are subscribed yet. Enable notifications on each iPhone first." }, 400);

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    let sent = 0;
    const staleIds: string[] = [];
    const failures: string[] = [];

    await Promise.all(rows.map(async (row: { id: string; endpoint: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(row.subscription as webpush.PushSubscription, JSON.stringify({
          title, body, url: targetUrl, tag: "trach-family-" + Date.now(),
        }));
        sent++;
      } catch (error) {
        const e = error as { statusCode?: number; message?: string };
        if (e.statusCode === 404 || e.statusCode === 410) staleIds.push(row.id);
        else failures.push(e.message || "Unknown push delivery error");
      }
    }));

    if (staleIds.length) {
      await admin.from("push_subscriptions").delete().in("id", staleIds);
    }
    return json({
      message: `Push sent to ${sent} device(s).`,
      sent,
      total: rows.length,
      staleRemoved: staleIds.length,
      failures: failures.slice(0, 3),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
