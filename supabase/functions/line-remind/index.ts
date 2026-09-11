import { createClient } from "npm:@supabase/supabase-js@2";
import { composeReminder, TAICHUNG_OFFICE } from "./chat-offer.js";

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function push(token, userId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: String(text).slice(0, 4900) }],
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("xinghong line remind");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("LINE_CRON_SECRET") || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!secret || !timingEqual(secret, got)) return new Response("unauthorized", { status: 401 });

  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!token) return new Response("LINE token missing", { status: 503 });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.rpc("xinghong_due_reminders");
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  let skipped = 0;
  for (const row of data || []) {
    if (!row.line_user_id || row.reminder_sent_at) {
      skipped += 1;
      continue;
    }
    const text = composeReminder(row.interview_date, row.start_time, TAICHUNG_OFFICE);
    const ok = await push(token, row.line_user_id, text);
    if (ok) {
      await sb.rpc("xinghong_mark_reminded", { p_booking_id: row.id });
      sent += 1;
    } else skipped += 1;
  }
  return Response.json({ ok: true, sent, skipped });
});
