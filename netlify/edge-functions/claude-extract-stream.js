// Save this file as: netlify/edge-functions/claude-extract-stream.js
// This must go under netlify/edge-functions/, NOT netlify/functions/ —
// standard Functions are capped at a 30-second invocation limit even while
// streaming; Edge Functions are not, which is the whole point of this file.

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const jsonErrorHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  let prompt, apiKey, maxTokens;
  try {
    ({ prompt, apiKey, maxTokens } = await req.json());
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonErrorHeaders,
    });
  }

  if (!prompt || !apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing prompt or apiKey" }),
      { status: 400, headers: jsonErrorHeaders }
    );
  }

  const DEFAULT_MAX_TOKENS = 4096;
  const HARD_MAX_TOKENS = 8192;
  const requestedMaxTokens = Math.min(
    parseInt(maxTokens, 10) || DEFAULT_MAX_TOKENS,
    HARD_MAX_TOKENS
  );

  let anthropicResponse;
  try {
    anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: requestedMaxTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reach Claude API", details: err.message }),
      { status: 502, headers: jsonErrorHeaders }
    );
  }

  if (!anthropicResponse.ok || !anthropicResponse.body) {
    let details = "Unknown error";
    try {
      const errJson = await anthropicResponse.json();
      details = errJson?.error?.message || details;
    } catch (e) {
      // response body wasn't JSON — leave details as "Unknown error"
    }
    return new Response(
      JSON.stringify({ error: "Claude API error", details }),
      { status: anthropicResponse.status || 502, headers: jsonErrorHeaders }
    );
  }

  // We re-stream as newline-delimited JSON (NDJSON) — one small JSON object
  // per line — rather than passing Anthropic's raw SSE straight through.
  // It's simpler for the browser to parse with a plain ReadableStream reader
  // than reimplementing SSE framing on the client.
  //
  // Lines look like:
  //   {"type":"delta","text":"..."}          — one per chunk of text
  //   {"type":"done","stopReason":"end_turn"} — exactly one, at the end
  //   {"type":"error","message":"..."}        — only if something broke mid-stream
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicResponse.body.getReader();
      let buffer = "";

      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Anthropic's SSE frames are separated by newlines; keep any
          // trailing partial line in the buffer for the next chunk.
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            let event;
            try {
              event = JSON.parse(jsonStr);
            } catch (e) {
              continue; // skip any line that isn't valid JSON
            }

            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              send({ type: "delta", text: event.delta.text });
            } else if (event.type === "message_delta" && event.delta?.stop_reason) {
              send({ type: "done", stopReason: event.delta.stop_reason });
            } else if (event.type === "error") {
              send({ type: "error", message: event.error?.message || "Stream error" });
            }
          }
        }
      } catch (err) {
        send({ type: "error", message: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    },
  });
};

// Edge Functions need an explicit path — they aren't automatically
// reachable at /.netlify/functions/<name> the way standard Functions are.
export const config = {
  path: "/api/claude-extract-stream",
};
