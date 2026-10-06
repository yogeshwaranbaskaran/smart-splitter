// Supabase Edge Function: notify-selection
//
// Emails people about things that happen to THEIR items in a split:
//   kind "assigned" -> the creator picked items for you
//   kind "changed"  -> the creator changed items they had picked for you
//   kind "disputed" -> someone disagreed; the creator gets told
//
// WHY THIS IS CALLED FROM THE CLIENT, NOT A DB WEBHOOK:
// notify-split-created hangs off a webhook because one split is one INSERT.
// Saving a selection is a DELETE followed by an INSERT of one row PER ITEM, so
// a webhook would fire five times for a five-item assignment and send five
// emails. The client knows the save was one action, so it reports it once.
//
// Reuses the same Brevo secrets as notify-split-created:
//   BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { splitId, kind, forUser, byUser, note } = await req.json();
    if (!splitId || !["assigned", "changed", "disputed"].includes(kind)) {
      return json({ error: "bad_request" }, 400);
    }

    // Service role: needed to read other people's emails, which RLS hides.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: split } = await supabase
      .from("splits")
      .select("name, created_by, group_id")
      .eq("id", splitId)
      .single();
    if (!split) return json({ error: "no_split" }, 404);

    const splitName = split.name?.trim() || "a split";

    // Who hears about it, and what it says.
    let to: string | null = null;
    let subject = "";
    let line = "";

    if (kind === "disputed") {
      // The creator is the one who can fix it, and created_by is already an email.
      to = split.created_by;
      subject = `${splitName}: ${byUser} disagrees with their items`;
      line = note
        ? `<strong>${esc(byUser)}</strong> flagged the items picked for them in <strong>${esc(splitName)}</strong>: “${esc(note)}”`
        : `<strong>${esc(byUser)}</strong> flagged the items picked for them in <strong>${esc(splitName)}</strong>.`;
    } else {
      // Username to email, because selections only store usernames.
      const { data: prof } = await supabase
        .from("profiles")
        .select("email")
        .eq("username", forUser)
        .maybeSingle();
      to = prof?.email ?? null;
      subject = kind === "assigned"
        ? `${byUser} picked your items in ${splitName}`
        : `${byUser} changed your items in ${splitName}`;
      line = kind === "assigned"
        ? `<strong>${esc(byUser)}</strong> chose which items were yours in <strong>${esc(splitName)}</strong>. Open the split to check them, and say so if anything is wrong.`
        : `<strong>${esc(byUser)}</strong> changed the items picked for you in <strong>${esc(splitName)}</strong>. Worth another look.`;
    }

    if (!to) return json({ sent: 0, note: "no recipient email" });

    const appUrl = Deno.env.get("APP_URL") ?? "";
    const html = `
      <div style="font-family: system-ui, sans-serif; font-size: 16px; color: #1a1a1a;">
        <p>${line}</p>
        <p><a href="${appUrl}/split/${splitId}" style="background:#6c5ce7;color:#fff;padding:10px 18px;
        border-radius:8px;text-decoration:none;display:inline-block;">Open the split</a></p>
      </div>`;

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": Deno.env.get("BREVO_API_KEY")!,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: Deno.env.get("BREVO_SENDER_EMAIL")!,
          name: Deno.env.get("BREVO_SENDER_NAME") ?? "Smart Splitter",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Brevo error", res.status, body);
      return json({ error: "brevo_failed", status: res.status }, 502);
    }
    return json({ sent: 1, kind });
  } catch (err) {
    console.error("notify-selection failed", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
