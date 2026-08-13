import OpenAI from "openai";
import { NextResponse } from "next/server";
import { JARVIS_SYSTEM_PROMPT } from "../../../lib/jarvis/systemPrompt";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function isValidMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Partial<ChatMessage>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= 4000
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "JARVIS todavía no tiene configurada la API de OpenAI." },
      { status: 503 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const messages =
    body && typeof body === "object" && "messages" in body
      ? (body as { messages: unknown }).messages
      : null;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    !messages.every(isValidMessage)
  ) {
    return NextResponse.json(
      { error: "Los mensajes enviados no son válidos." },
      { status: 400 },
    );
  }

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
      instructions: JARVIS_SYSTEM_PROMPT,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 600,
      store: false,
    });

    const reply = response.output_text.trim();

    if (!reply) {
      throw new Error("OpenAI devolvió una respuesta vacía.");
    }

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Error al consultar OpenAI:", error);
    return NextResponse.json(
      { error: "JARVIS no pudo responder en este momento." },
      { status: 502 },
    );
  }
}
