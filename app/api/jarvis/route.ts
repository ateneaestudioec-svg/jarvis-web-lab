import { GoogleGenAI } from "@google/genai";
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
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "JARVIS todavía no tiene configurada la API de Gemini." },
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
    const ai = new GoogleGenAI({ apiKey });
    const transcript = messages
      .map(
        (message) =>
          `${message.role === "assistant" ? "JARVIS" : "Usuario"}: ${message.content}`,
      )
      .join("\n\n");
    const interaction = await ai.interactions.create({
      model: "gemini-3.5-flash",
      system_instruction: JARVIS_SYSTEM_PROMPT,
      input: `Continúa esta conversación y responde al último mensaje del usuario:\n\n${transcript}`,
      store: false,
    });

    const reply = interaction.output_text?.trim();

    if (!reply) {
      throw new Error("Gemini devolvió una respuesta vacía.");
    }

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Error técnico al consultar Gemini:", error);
    return NextResponse.json(
      { error: "JARVIS no pudo responder en este momento. Inténtalo de nuevo." },
      { status: 502 },
    );
  }
}
