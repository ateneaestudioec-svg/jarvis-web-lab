import { GoogleGenAI } from "@google/genai";
import { createClient } from "next-sanity";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { apiVersion, dataset, projectId } from "../../../sanity/env";

const GEMINI_MODEL = "gemini-3.5-flash";
const UPDATE_HERO_TITLE_TOOL = "updateHeroTitle";
const MAX_TITLE_LENGTH = 150;

const JARVIS_SYSTEM_PROMPT = `Eres JARVIS, el asistente experimental de JARVIS WEB LAB.

Ayudas al usuario a gestionar el contenido de su sitio web mediante conversación natural.

Puedes conversar, explicar tus capacidades, ayudar a redactar contenido y explicar cómo podría modificarse una web.

Actualmente tienes una sola herramienta real: updateHeroTitle. Úsala únicamente cuando el usuario solicite cambiar el título principal del Hero de la Home y proporcione un título concreto y válido.

No tienes herramientas para cambiar imágenes, descripciones, botones, blogs, código, CSS, archivos, despliegues ni ningún otro contenido. Si te piden una acción distinta, explica brevemente que esa capacidad todavía no está habilitada.

Nunca afirmes que realizaste un cambio salvo que recibas un resultado exitoso de la herramienta. Si falta el nuevo título o no es válido, solicita un título válido sin llamar a la herramienta.`;

const updateHeroTitleTool = {
  type: "function" as const,
  name: UPDATE_HERO_TITLE_TOOL,
  description:
    "Actualiza exclusivamente el título principal del Hero de la página Home en Sanity.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Nuevo título principal del Hero, con un máximo de 150 caracteres.",
        maxLength: MAX_TITLE_LENGTH,
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ValidTitleResult =
  | { ok: true; title: string }
  | { ok: false };

type FunctionCallStep = {
  type: "function_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export async function GET() {
  return NextResponse.json({
    status: "ok",
    provider: "gemini",
    configured: Boolean(process.env.GEMINI_API_KEY),
    heroTitleToolConfigured: Boolean(process.env.SANITY_API_WRITE_TOKEN),
  });
}

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

function validateTitleArguments(value: unknown): ValidTitleResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }

  const argumentsObject = value as Record<string, unknown>;
  const keys = Object.keys(argumentsObject);

  if (
    keys.length !== 1 ||
    keys[0] !== "title" ||
    typeof argumentsObject.title !== "string"
  ) {
    return { ok: false };
  }

  const title = argumentsObject.title.trim();

  if (!title || title.length > MAX_TITLE_LENGTH) {
    return { ok: false };
  }

  return { ok: true, title };
}

function isFunctionCallStep(value: unknown): value is FunctionCallStep {
  if (!value || typeof value !== "object") return false;

  const step = value as Partial<FunctionCallStep>;
  return (
    step.type === "function_call" &&
    typeof step.id === "string" &&
    typeof step.name === "string" &&
    Boolean(step.arguments) &&
    typeof step.arguments === "object" &&
    !Array.isArray(step.arguments)
  );
}

async function updateHeroTitle(title: string) {
  const token = process.env.SANITY_API_WRITE_TOKEN;

  if (!token || !projectId) {
    throw new Error("Sanity write client is not configured.");
  }

  const writeClient = createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    token,
  });

  const documents = await writeClient.fetch<Array<{ _id: string }>>(
    `*[_type == "homePage" && !(_id in path("drafts.**"))]{_id}`,
    {},
    { cache: "no-store" },
  );

  if (documents.length !== 1) {
    throw new Error(
      `Expected exactly one published homePage document, found ${documents.length}.`,
    );
  }

  const documentId = documents[0]._id;

  await writeClient.patch(documentId).set({ heroTitle: title }).commit();
  revalidatePath("/");

  return { success: true, title, documentId };
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

  const transcript = messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "JARVIS" : "Usuario"}: ${message.content}`,
    )
    .join("\n\n");
  const prompt = `Continúa esta conversación y responde al último mensaje del usuario:\n\n${transcript}`;
  const ai = new GoogleGenAI({ apiKey });
  const history: Array<Record<string, unknown>> = [
    {
      type: "user_input",
      content: [{ type: "text", text: prompt }],
    },
  ];

  let interaction;

  try {
    interaction = await ai.interactions.create({
      model: GEMINI_MODEL,
      system_instruction: JARVIS_SYSTEM_PROMPT,
      input: history,
      tools: [updateHeroTitleTool],
      store: false,
    });
  } catch (error) {
    console.error("Gemini no pudo interpretar la solicitud:", error);
    return NextResponse.json(
      { error: "No pude interpretar la solicitud en este momento." },
      { status: 502 },
    );
  }

  const functionCalls = interaction.steps.filter(isFunctionCallStep);

  if (functionCalls.length === 0) {
    const reply = interaction.output_text?.trim();

    if (!reply) {
      return NextResponse.json(
        { error: "No pude interpretar la solicitud en este momento." },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply });
  }

  if (
    functionCalls.length !== 1 ||
    functionCalls[0].name !== UPDATE_HERO_TITLE_TOOL
  ) {
    console.error("Gemini solicitó una llamada de herramienta no permitida.");
    return NextResponse.json(
      { error: "No pude interpretar la solicitud en este momento." },
      { status: 502 },
    );
  }

  const functionCall = functionCalls[0];
  const validTitle = validateTitleArguments(functionCall.arguments);

  if (!validTitle.ok) {
    return NextResponse.json({
      reply: "Necesito un título válido para realizar el cambio.",
    });
  }

  let toolResult: Awaited<ReturnType<typeof updateHeroTitle>>;

  try {
    toolResult = await updateHeroTitle(validTitle.title);
  } catch (error) {
    console.error("Sanity no pudo actualizar heroTitle:", error);
    return NextResponse.json(
      { error: "Entendí el cambio, pero no pude actualizar el sitio." },
      { status: 502 },
    );
  }

  history.push(...interaction.steps);
  history.push({
    type: "function_result",
    name: functionCall.name,
    call_id: functionCall.id,
    result: [
      {
        type: "text",
        text: JSON.stringify({ success: true, title: toolResult.title }),
      },
    ],
  });

  try {
    const finalInteraction = await ai.interactions.create({
      model: GEMINI_MODEL,
      system_instruction: JARVIS_SYSTEM_PROMPT,
      input: history,
      tools: [updateHeroTitleTool],
      store: false,
    });
    const reply = finalInteraction.output_text?.trim();

    return NextResponse.json({
      reply:
        reply ||
        `He actualizado el título principal a “${toolResult.title}”.`,
    });
  } catch (error) {
    console.error("Gemini no pudo redactar la confirmación final:", error);
    return NextResponse.json({
      reply: `He actualizado el título principal a “${toolResult.title}”.`,
    });
  }
}
