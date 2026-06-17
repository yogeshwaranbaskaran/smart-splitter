// Supabase Edge Function: notify-split-created
// Triggered by a Database Webhook on INSERT into `splits`.
// Emails every ACCEPTED group member (except the split creator) via Brevo.
//
// Secrets it needs (set with: Edge Functions -> Manage secrets, or supabase secrets set):
//   BREVO_API_KEY        - your Brevo API key
//   BREVO_SENDER_EMAIL   - the email you verified as a Brevo sender
//   BREVO_SENDER_NAME    - display name, e.g. "Smart Splitter"
//   APP_URL              - your deployed app URL, e.g. https://smart-splitter-psi.vercel.app
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The Database Webhook sends a payload shaped like:
// { type: "INSERT", table: "splits", record: { ...the new split row }, old_record: null }
interface WebhookPayload {
  type: string;
  table: string;
  record: {
    id: string;
    name: string | null;
    created_by: string | null; // creator's email
    group_id: string | null;
    split_type: string | null;
  };
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const split = payload.record;

    // Only act on inserts into splits that belong to a group.
    if (payload.type !== "INSERT" || !split?.group_id) {
      return json({ skipped: "not a group split insert" });
    }

    // Service-role client: bypasses RLS so the function can read members' emails.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Group name for the email subject/body.
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", split.group_id)
      .single();
    const groupName = group?.name ?? "your group";

    // Accepted members of this group, minus the creator.
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select("email")
      .eq("group_id", split.group_id)
      .eq("status", "accepted");

    if (membersError) throw membersError;

    const creator = (split.created_by ?? "").toLowerCase();
    const recipients = (members ?? [])
      .map((m) => m.email)
      .filter((e): e is string => !!e && e.toLowerCase() !== creator);

    if (recipients.length === 0) {
      return json({ sent: 0, note: "no recipients (only the creator?)" });
    }

    const appUrl = Deno.env.get("APP_URL") ?? "";
    const splitName = split.name?.trim() || "a new split";
    const subject = `New split in ${groupName}`;
    const htmlContent = `
      <div style="font-family: system-ui, sans-serif; font-size: 16px; color: #1a1a1a;">
        <p>A new split — <strong>${escapeHtml(splitName)}</strong> — was just added to
        <strong>${escapeHtml(groupName)}</strong> on Smart Splitter.</p>
        <p>Open the app to pick what's yours:</p>
        <p><a href="${appUrl}" style="background:#6c5ce7;color:#fff;padding:10px 18px;
        border-radius:8px;text-decoration:none;display:inline-block;">Open Smart Splitter</a></p>
      </div>`;

    // Brevo lets you send to many recipients in one call via the `to` array.
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
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
        to: recipients.map((email) => ({ email })),
        subject,
        htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const body = await brevoRes.text();
      console.error("Brevo error", brevoRes.status, body);
      return json({ error: "brevo_failed", status: brevoRes.status, body }, 502);
    }

    return json({ sent: recipients.length });
  } catch (err) {
    console.error("notify-split-created failed", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
