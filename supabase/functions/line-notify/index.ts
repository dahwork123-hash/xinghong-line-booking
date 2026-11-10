import { createClient } from "npm:@supabase/supabase-js@2";
import { composeInterviewNotice, officeForSlot } from "./chat-offer.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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

export async function sendCandidateNotices(sb, token, chat = { composeInterviewNotice, officeForSlot }) {
  const { data: rows, error } = await sb.rpc("xinghong_claim_candidate_notices");
  if (error) {
    const missing = /claim_candidate_notices|schema cache|does not exist|PGRST202/i.test(String(error.message || error));
    return { ok: false, missing, error: error.message, sent: 0, failed: 0 };
  }
  const { data: board } = await sb.rpc("xinghong_board");
  const schedule = board?.schedule || {};
  let sent = 0;
  let failed = 0;
  for (const row of rows || []) {
    const city = row.interview_city || row.apply_city || "台中";
    const office = chat.officeForSlot(city, schedule, row.interview_date, row.start_time, row.director_id);
    const text = chat.composeInterviewNotice({
      date: row.interview_date,
      start: row.start_time,
      end: row.end_time,
      office,
      directorLabel: row.director_label || "",
    });
    const ok = row.line_user_id ? await push(token, row.line_user_id, text) : false;
    if (ok) {
      await sb.rpc("xinghong_mark_candidate_notice", { p_booking_id: row.id });
      sent += 1;
    } else {
      await sb.rpc("xinghong_release_candidate_notice", { p_booking_id: row.id });
      failed += 1;
    }
  }
  return { ok: true, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return json({ ok: true, service: "xinghong line notify" });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!token) return json({ ok: false, error: "LINE token missing" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const result = await sendCandidateNotices(sb, token);
  if (result.missing) return json({ ok: false, error: "notice function missing", detail: result.error }, 503);
  return json(result, result.ok ? 200 : 500);
});
