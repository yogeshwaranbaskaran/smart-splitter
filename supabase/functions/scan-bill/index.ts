// Supabase Edge Function: scan-bill
// Called directly from the browser (not a webhook). Takes a bill image,
// asks Gemini to read it, and returns the raw extracted JSON.
//
// WHY THIS EXISTS: the Gemini API key used to live in the client bundle as
// VITE_GEMINI_API_KEY, which meant anyone could open DevTools and take it.
// Now the key only ever exists here, on the server.
//
// Secrets it needs (Edge Functions -> Manage secrets):
//   GEMINI_API_KEY   - your Google AI Studio key
//   GEMINI_MODEL     - optional, defaults to gemini-3.1-flash-lite
//
// NOTE: this function does extraction only. All the tax/total math stays in
// src/billparser.js on the client, so the numbers remain deterministic and
// the review screen can recompute them live as the user edits.

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";

// Guard against someone posting a huge payload to burn our quota.
// Base64 inflates bytes by ~33%, so this is roughly a 7 MB image.
const MAX_BASE64_CHARS = 10_000_000;

// Gemini reads PDFs natively, same as images — no page-to-image step needed.
// Digitally generated PDFs (hotel/train/booking receipts) have real embedded
// text, so they read more accurately than a photo ever will.
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const PROMPT = `Look at this bill/receipt (it may be a photo or a PDF). Return ONLY this JSON, no markdown, no explanation.

{
  "items": [
    {
      "name": "english name",
      "quantity": 1,
      "line_amount": 100,
      "tax_rate": 8,
      "tax_included": false
    }
  ],
  "tax_type": "added",
  "grand_total": 1587
}

Rules:
- name: translate to English
- quantity: number of units bought. If the bill shows "3x299", quantity is 3
- line_amount: the amount printed on the bill for that whole line, EXACTLY as shown. Do not add or remove tax — copy the printed number.
- tax_rate: the tax percentage that applies to this item as a number (e.g. 8, 10, 5, 12, 18). If tax is shown only as a total at the bottom, infer the rate for each item; if you cannot tell, use the bill's main rate. If there is genuinely no tax, use 0.
- tax_included: true if the printed line_amount already contains tax, false if tax is added separately (usually summarised at the bottom)
- tax_type: the overall style of the whole bill — "included" if item prices already contain tax, "added" if tax is a separate charge added on top, "none" if there is no tax at all
- grand_total: the final total actually paid, exactly as printed

Tax styles vary by country — infer from the receipt:
- Japan: items marked * = 8% added on top; 内 = tax already included; bags/non-food = 10% added
- India (GST): CGST/SGST/IGST listed at the bottom and added on top; common rates 5/12/18%
- If the item prices already add up (roughly) to the grand total, tax is "included"`;

// The browser calls this cross-origin, so we must answer preflight requests.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "missing_key" }, 500);

    const { imageBase64, mimeType } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return json({ error: "no_image" }, 400);
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return json({ error: "image_too_large" }, 413);
    }
    if (!ALLOWED_MIME.includes(mimeType)) {
      return json({ error: "unsupported_type", mimeType }, 415);
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
        // Ask Gemini for JSON directly instead of hoping it skips the ```json fence.
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Gemini error", res.status, body);
      // 429 = rate limited on the free tier; worth its own message ("try again"),
      // since unlike a real failure it usually succeeds a moment later.
      if (res.status === 429) return json({ error: "rate_limited" }, 429);
      return json({ error: "gemini_failed", status: res.status }, 502);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "empty_response" }, 502);

    // responseMimeType should give us clean JSON, but strip fences just in case.
    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Bad JSON from Gemini", cleaned.slice(0, 500));
      return json({ error: "bad_json" }, 502);
    }

    return json(parsed);
  } catch (err) {
    console.error("scan-bill failed", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
