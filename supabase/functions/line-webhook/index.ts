import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildLineReply,
  composeOffer,
  DEFAULT_TAICHUNG_WEEK,
  parseSlotTime,
  TAICHUNG_OFFICE,
} from "./chat-offer.js";

const encoder = new TextEncoder();

function bytesToB64(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyLineSignature(raw, header, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = bytesToB64(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  return timingEqual(sig, header);
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function taipeiNowHm() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .slice(0, 5);
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

function directorFor(schedule, isoDay, start) {
  const rule = schedule?.rules?.[0] || {};
  const directors = schedule?.directors || [];
  const assignments = schedule?.assignments || {};
  const times = rule.isoWeekdays?.[isoDay] || rule.isoWeekdays?.[String(isoDay)] || [];
  const time = times.find((t) => parseSlotTime(t)?.start === start);
  const officeId = rule.officeId || "taichung";
  const pool = rule.pool || "general";
  const key = officeId + "|" + pool + "|" + isoDay + "|" + start;
  const id = assignments[key] || directors[0]?.id || "";
  const d = directors.find((x) => x.id === id) || directors[0];
  return {
    id: d?.id || "",
    label: d ? [d.unit, d.name].filter(Boolean).join(" ") : "",
    capacity: Number(rule.capacity) || 5,
    end: parseSlotTime(time)?.end,
  };
}

async function lineReply(token, replyToken, text) {
  if (!replyToken || !text) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: String(text).slice(0, 4900) }],
    }),
  });
}

async function lineName(token, userId) {
  const res = await fetch("https://api.line.me/v2/bot/profile/" + userId, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) return "";
  const data = await res.json();
  return String(data.displayName || "");
}

async function applyActions(sb, schedule, userId, displayName, result) {
  for (const action of result.actions || []) {
    if (action.type === "human") {
      await sb.rpc("xinghong_set_line_mode", {
        p_line_user_id: userId,
        p_mode: "human",
        p_line_name: displayName,
      });
    }
    if (action.type === "cancel") {
      await sb.rpc("xinghong_cancel_by_line", { p_line_user_id: userId });
    }
    if (action.type === "touch") {
      await sb.rpc("xinghong_touch_line", {
        p_line_user_id: userId,
        p_line_name: displayName,
        p_job: action.job || null,
        p_apply_city: action.city || null,
        p_phone: action.phone || null,
      });
    }
    if (action.type === "book") {
      const picked = action.picked;
      const meta = directorFor(schedule, picked.isoDay, picked.start);
      const { error } = await sb.rpc("xinghong_line_book", {
        p_line_user_id: userId,
        p_line_name: displayName,
        p_date: picked.date,
        p_start: picked.start,
        p_end: picked.end || meta.end,
        p_director_id: meta.id,
        p_director_label: meta.label,
        p_capacity: meta.capacity,
      });
      if (error) {
        const msg = String(error.message || error);
        if (msg.includes("SLOT_FULL")) {
          result.text = "這個時段的線上預約名額已滿，請選其他方便的時段，謝謝您！";
        } else {
          result.text = "這個時段現在無法預約，請改選其他時間，或回「聯絡同仁」。";
        }
      }
    }
  }
}

async function replyForText(sb, token, userId, displayName, text) {
  const { data: board } = await sb.rpc("xinghong_board");
  const schedule = board?.schedule || {};
  const isoWeekdays = schedule?.rules?.[0]?.isoWeekdays || DEFAULT_TAICHUNG_WEEK;
  const candidate = (board?.candidates || []).find((c) => c.line_user_id === userId);
  const current = (board?.bookings || []).find((b) => b.candidate_id === candidate?.id);
  const result = buildLineReply({
    text,
    today: taipeiToday(),
    nowHm: taipeiNowHm(),
    isoWeekdays,
    office: TAICHUNG_OFFICE,
    booking: current || null,
    humanMode: candidate?.line_mode === "human",
  });
  if (result.silent) return "";
  await applyActions(sb, schedule, userId, displayName, result);
  return result.text;
}

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("xinghong line webhook");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!secret || !token) return new Response("LINE secrets missing", { status: 503 });

  const raw = await req.text();
  const header = req.headers.get("x-line-signature") || "";
  if (!(await verifyLineSignature(raw, header, secret))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const sb = supabaseAdmin();
  for (const event of body.events || []) {
    const userId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!userId) continue;
    const displayName = await lineName(token, userId);
    if (event.type === "follow") {
      const { data: board } = await sb.rpc("xinghong_board");
      const isoWeekdays = board?.schedule?.rules?.[0]?.isoWeekdays || DEFAULT_TAICHUNG_WEEK;
      await lineReply(token, replyToken, composeOffer(isoWeekdays, TAICHUNG_OFFICE));
      continue;
    }
    if (event.type === "message" && event.message?.type === "text") {
      const text = await replyForText(sb, token, userId, displayName, event.message.text || "");
      await lineReply(token, replyToken, text);
    }
  }
  return new Response("ok");
});
