import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("REMINDER_CRON_SECRET");
  const providedSecret = req.headers.get("x-reminder-secret");
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return json({ error: "Required Supabase or VAPID secrets are missing." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date().toISOString();
    const { data: reminders, error: reminderError } = await admin
      .from("scheduled_reminders")
      .select("id,user_id,title,body,remind_at")
      .is("sent_at", null)
      .lte("remind_at", now)
      .order("remind_at", { ascending: true })
      .limit(100);

    if (reminderError) throw reminderError;
    if (!reminders?.length) return json({ processed: 0, sent: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    let sentReminders = 0;
    let sentDevices = 0;
    const errors: string[] = [];

    for (const reminder of reminders) {
      const { data: subscriptions, error: subscriptionError } = await admin
        .from("push_subscriptions")
        .select("id,subscription")
        .eq("user_id", reminder.user_id);

      if (subscriptionError) {
        errors.push("Reminder " + reminder.id + ": " + subscriptionError.message);
        continue;
      }
      if (!subscriptions?.length) continue;

      let successfulForReminder = 0;
      const staleIds: string[] = [];
      await Promise.all(subscriptions.map(async (row: { id: string; subscription: unknown }) => {
        try {
          await webpush.sendNotification(row.subscription as any, JSON.stringify({
            title: String(reminder.title || "Taxi Manager").slice(0, 120),
            body: String(reminder.body || "Час виконати заплановане нагадування.").slice(0, 500),
            url: "./",
            tag: "taxi-manager-reminder-" + reminder.id,
          }));
          successfulForReminder++;
          sentDevices++;
        } catch (error) {
          const e = error as { statusCode?: number; message?: string };
          if (e.statusCode === 404 || e.statusCode === 410) staleIds.push(row.id);
          else errors.push("Reminder " + reminder.id + ": " + (e.message || "Push delivery failed"));
        }
      }));

      if (staleIds.length) {
        await admin.from("push_subscriptions").delete().in("id", staleIds);
      }

      if (successfulForReminder > 0) {
        const { error: updateError } = await admin
          .from("scheduled_reminders")
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq("id", reminder.id)
          .is("sent_at", null);
        if (updateError) errors.push("Could not mark reminder " + reminder.id + " sent: " + updateError.message);
        else sentReminders++;
      }
    }

    return json({ processed: reminders.length, sentReminders, sentDevices, errors: errors.slice(0, 10) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
