export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  const DEFAULT_MAX_TOKENS = 4096;
  const HARD_MAX_TOKENS = 8192; // safety ceiling regardless of what the client asks for

  try {
    const { prompt, apiKey, maxTokens } = await req.json();
    if (!prompt || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing prompt or apiKey" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const requestedMaxTokens = Math.min(
      parseInt(maxTokens, 10) || DEFAULT_MAX_TOKENS,
      HARD_MAX_TOKENS
    );

    // Call Claude API directly (no SDK dependency needed)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: requestedMaxTokens,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return new Response(
        JSON.stringify({
          error: "Claude API error",
          details: error.error?.message || "Unknown error"
        }),
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return new Response(
      JSON.stringify({
        success: true,
        data: text,
        stopReason: data.stop_reason || null // "end_turn" | "max_tokens" | "stop_sequence" | ...
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        details: error.message
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
