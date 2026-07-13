import Anthropic from "@anthropic-ai/sdk";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { prompt, apiKey } = await req.json();
    if (!prompt || !apiKey) {
      return new Response(JSON.stringify({ error: "Missing prompt or apiKey" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return new Response(JSON.stringify({ success: true, data: text }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed", details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
