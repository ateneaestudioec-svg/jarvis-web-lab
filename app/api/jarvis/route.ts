import { GoogleGenAI } from "@google/genai";
import { createClient } from "next-sanity";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { apiVersion, dataset, projectId } from "../../../sanity/env";
import { HOME_PAGE_CACHE_TAG } from "../../../sanity/lib/client";

const GEMINI_MODEL = "gemini-3.5-flash";
const UPDATE_HERO_TITLE_TOOL = "updateHeroTitle";
const UPDATE_HERO_DESCRIPTION_TOOL = "updateHeroDescription";
const UPDATE_HERO_BUTTON_TEXT_TOOL = "updateHeroButtonText";
const UPDATE_HERO_IMAGE_TOOL = "updateHeroImage";
const MAX_TITLE_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BUTTON_TEXT_LENGTH = 60;
const MAX_TOOL_CALLS = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

const JARVIS_SYSTEM_PROMPT = `Eres JARVIS, el asistente experimental de JARVIS WEB LAB.

Ayudas al usuario a gestionar el contenido de su sitio web mediante conversación natural.

Puedes conversar, explicar tus capacidades, ayudar a redactar contenido y usar exactamente estas herramientas reales:
- updateHeroTitle: cambia únicamente el título principal del Hero.
- updateHeroDescription: cambia únicamente la descripción del Hero.
- updateHeroButtonText: cambia únicamente el texto del botón del Hero.

Cuando el usuario solicite varios de estos cambios en una misma instrucción, solicita una llamada independiente para cada herramienta necesaria. No combines campos ni inventes herramientas.

No tienes herramientas para cambiar colores, estilos, fondos, blogs, código, CSS, archivos arbitrarios, layouts, despliegues, configuración ni ningún otro contenido. Si te piden una acción distinta, explica brevemente que esa capacidad todavía no está habilitada.

Nunca afirmes que realizaste un cambio salvo que recibas un resultado exitoso de la herramienta correspondiente. Si falta un valor concreto o no es válido, solicítalo sin llamar a la herramienta.`;

const IMAGE_SYSTEM_INSTRUCTION = `Ahora también dispones de updateHeroImage, que reemplaza exclusivamente la imagen principal del Hero con el archivo adjunto por el usuario.
Cuando la intención sea reemplazar la imagen con el archivo adjunto, solicita updateHeroImage. Si el usuario pide reemplazarla pero no adjunta un archivo, solicita la herramienta para que el servidor informe que falta.
No uses updateHeroImage para generar, editar, recortar, buscar ni crear imágenes. Esas capacidades, al igual que los cambios de estilos, siguen sin estar habilitadas.`;

const SYSTEM_INSTRUCTION = `${JARVIS_SYSTEM_PROMPT}\n\n${IMAGE_SYSTEM_INSTRUCTION}`;

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
        description: "Nuevo título principal del Hero.",
        maxLength: MAX_TITLE_LENGTH,
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
};

const updateHeroDescriptionTool = {
  type: "function" as const,
  name: UPDATE_HERO_DESCRIPTION_TOOL,
  description:
    "Actualiza exclusivamente la descripción del Hero de la página Home en Sanity.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Nueva descripción del Hero.",
        maxLength: MAX_DESCRIPTION_LENGTH,
      },
    },
    required: ["description"],
    additionalProperties: false,
  },
};

const updateHeroButtonTextTool = {
  type: "function" as const,
  name: UPDATE_HERO_BUTTON_TEXT_TOOL,
  description:
    "Actualiza exclusivamente el texto visible del botón del Hero de la página Home en Sanity.",
  parameters: {
    type: "object",
    properties: {
      buttonText: {
        type: "string",
        description: "Nuevo texto visible del botón del Hero.",
        maxLength: MAX_BUTTON_TEXT_LENGTH,
      },
    },
    required: ["buttonText"],
    additionalProperties: false,
  },
};

const updateHeroImageTool = {
  type: "function" as const,
  name: UPDATE_HERO_IMAGE_TOOL,
  description:
    "Reemplaza exclusivamente la imagen principal del Hero con el archivo de imagen adjunto por el usuario.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const jarvisTools = [
  updateHeroTitleTool,
  updateHeroDescriptionTool,
  updateHeroButtonTextTool,
  updateHeroImageTool,
];

type ToolName =
  | typeof UPDATE_HERO_TITLE_TOOL
  | typeof UPDATE_HERO_DESCRIPTION_TOOL
  | typeof UPDATE_HERO_BUTTON_TEXT_TOOL
  | typeof UPDATE_HERO_IMAGE_TOOL;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type FunctionCallStep = {
  type: "function_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ToolExecutionResult = {
  callId: string;
  name: ToolName;
  success: boolean;
  value?: string;
  reason?: "validation" | "sanity" | "duplicate" | "missing_image";
};

type ImageAttachment = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
};

type ParsedRequest = {
  messages: unknown;
  image: File | null;
};

type WriteContext = {
  documentId: string;
  writeClient: ReturnType<typeof createClient>;
};

export async function GET() {
  return NextResponse.json({
    status: "ok",
    provider: "gemini",
    configured: Boolean(process.env.GEMINI_API_KEY),
    contentToolsConfigured: Boolean(process.env.SANITY_API_WRITE_TOKEN),
    tools: [
      UPDATE_HERO_TITLE_TOOL,
      UPDATE_HERO_DESCRIPTION_TOOL,
      UPDATE_HERO_BUTTON_TEXT_TOOL,
      UPDATE_HERO_IMAGE_TOOL,
    ],
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

function isToolName(value: string): value is ToolName {
  return (
    value === UPDATE_HERO_TITLE_TOOL ||
    value === UPDATE_HERO_DESCRIPTION_TOOL ||
    value === UPDATE_HERO_BUTTON_TEXT_TOOL ||
    value === UPDATE_HERO_IMAGE_TOOL
  );
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const rawMessages = formData.get("messages");
    const image = formData.get("image");

    if (typeof rawMessages !== "string") {
      throw new Error("Missing messages.");
    }

    return {
      messages: JSON.parse(rawMessages) as unknown,
      image: image instanceof File && image.size > 0 ? image : null,
    };
  }

  const body = (await request.json()) as unknown;
  return {
    messages:
      body && typeof body === "object" && "messages" in body
        ? (body as { messages: unknown }).messages
        : null,
    image: null,
  };
}

function hasValidImageSignature(buffer: Buffer, contentType: string) {
  if (contentType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (contentType === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }

  return (
    contentType === "image/webp" &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

async function validateImage(file: File): Promise<ImageAttachment | null> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (
    file.size === 0 ||
    file.size > MAX_IMAGE_SIZE ||
    !ALLOWED_IMAGE_TYPES.has(file.type) ||
    !ALLOWED_IMAGE_EXTENSIONS.has(extension)
  ) {
    return null;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasValidImageSignature(buffer, file.type)) return null;

  return {
    buffer,
    contentType: file.type as ImageAttachment["contentType"],
    filename: `hero-${Date.now()}.${extension === "jpeg" ? "jpg" : extension}`,
  };
}

function validateSingleStringArgument(
  value: unknown,
  key: string,
  maxLength: number,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const argumentsObject = value as Record<string, unknown>;
  const keys = Object.keys(argumentsObject);

  if (
    keys.length !== 1 ||
    keys[0] !== key ||
    typeof argumentsObject[key] !== "string"
  ) {
    return null;
  }

  const normalizedValue = argumentsObject[key].trim();

  if (!normalizedValue || normalizedValue.length > maxLength) {
    return null;
  }

  return normalizedValue;
}

function validateToolArguments(call: FunctionCallStep): string | null {
  switch (call.name) {
    case UPDATE_HERO_TITLE_TOOL:
      return validateSingleStringArgument(
        call.arguments,
        "title",
        MAX_TITLE_LENGTH,
      );
    case UPDATE_HERO_DESCRIPTION_TOOL:
      return validateSingleStringArgument(
        call.arguments,
        "description",
        MAX_DESCRIPTION_LENGTH,
      );
    case UPDATE_HERO_BUTTON_TEXT_TOOL:
      return validateSingleStringArgument(
        call.arguments,
        "buttonText",
        MAX_BUTTON_TEXT_LENGTH,
      );
    case UPDATE_HERO_IMAGE_TOOL:
      return Object.keys(call.arguments).length === 0 ? "__image__" : null;
    default:
      return null;
  }
}

function logTechnicalError(context: string, error: unknown) {
  const safeError =
    error && typeof error === "object"
      ? {
          name: "name" in error ? String(error.name) : "Error",
          message: "message" in error ? String(error.message) : "Unknown error",
          status: "status" in error ? String(error.status) : undefined,
        }
      : { name: "Error", message: String(error) };

  console.error(context, safeError);
}

async function createWriteContext(): Promise<WriteContext> {
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
    { cache: "no-store", perspective: "published" },
  );

  if (documents.length !== 1) {
    throw new Error(
      `Expected exactly one published homePage document, found ${documents.length}.`,
    );
  }

  return { documentId: documents[0]._id, writeClient };
}

async function executeToolCall(
  call: FunctionCallStep,
  context: WriteContext,
  image: ImageAttachment | null,
): Promise<ToolExecutionResult> {
  const name = call.name as ToolName;
  const value = validateToolArguments(call);

  if (!value) {
    return {
      callId: call.id,
      name,
      success: false,
      reason: "validation",
    };
  }

  if (name === UPDATE_HERO_IMAGE_TOOL && !image) {
    return { callId: call.id, name, success: false, reason: "missing_image" };
  }

  try {
    switch (name) {
      case UPDATE_HERO_TITLE_TOOL:
        await context.writeClient
          .patch(context.documentId)
          .set({ heroTitle: value })
          .commit();
        break;
      case UPDATE_HERO_DESCRIPTION_TOOL:
        await context.writeClient
          .patch(context.documentId)
          .set({ heroDescription: value })
          .commit();
        break;
      case UPDATE_HERO_BUTTON_TEXT_TOOL:
        await context.writeClient
          .patch(context.documentId)
          .set({ heroButtonText: value })
          .commit();
        break;
      case UPDATE_HERO_IMAGE_TOOL: {
        const asset = await context.writeClient.assets.upload(
          "image",
          image!.buffer,
          { filename: image!.filename, contentType: image!.contentType },
        );
        await context.writeClient
          .patch(context.documentId)
          .set({
            heroImage: {
              _type: "image",
              asset: { _type: "reference", _ref: asset._id },
            },
          })
          .commit();
        break;
      }
    }

    return {
      callId: call.id,
      name,
      success: true,
      value: name === UPDATE_HERO_IMAGE_TOOL ? undefined : value,
    };
  } catch (error) {
    logTechnicalError(`Sanity no pudo ejecutar ${name}:`, error);
    return {
      callId: call.id,
      name,
      success: false,
      reason: "sanity",
    };
  }
}

function toolLabel(name: ToolName) {
  switch (name) {
    case UPDATE_HERO_TITLE_TOOL:
      return "el título principal";
    case UPDATE_HERO_DESCRIPTION_TOOL:
      return "la descripción del Hero";
    case UPDATE_HERO_BUTTON_TEXT_TOOL:
      return "el texto del botón";
    case UPDATE_HERO_IMAGE_TOOL:
      return "la imagen principal";
  }
}

function joinLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? "el contenido";
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

function summarizeToolResults(results: ToolExecutionResult[]) {
  const successful = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);

  if (successful.length === 0) {
    if (failed.some((result) => result.reason === "missing_image")) {
      return "Necesito que adjuntes una imagen válida para actualizar la imagen principal.";
    }

    if (failed.length === 1 && failed[0].reason === "validation") {
      switch (failed[0].name) {
        case UPDATE_HERO_TITLE_TOOL:
          return "Necesito un título válido para realizar el cambio.";
        case UPDATE_HERO_DESCRIPTION_TOOL:
          return "Necesito una descripción válida para realizar el cambio.";
        case UPDATE_HERO_BUTTON_TEXT_TOOL:
          return "Necesito un texto de botón válido para realizar el cambio.";
      }
    }

    if (
      failed.length === 1 &&
      failed[0].name === UPDATE_HERO_IMAGE_TOOL &&
      failed[0].reason === "sanity"
    ) {
      return "Entendí el cambio, pero no pude actualizar la imagen principal.";
    }

    return "Entendí los cambios, pero no pude actualizar el sitio.";
  }

  const successfulLabels = successful.map((result) => toolLabel(result.name));

  if (failed.length > 0) {
    const failedLabels = failed.map((result) => toolLabel(result.name));
    return `Actualicé ${joinLabels(successfulLabels)}, pero no pude modificar ${joinLabels(failedLabels)}.`;
  }

  if (successful.length === 1) {
    const result = successful[0];
    if (result.name === UPDATE_HERO_BUTTON_TEXT_TOOL) {
      return `Listo. Cambié el texto del botón a “${result.value}”.`;
    }
    return `Listo. Actualicé ${toolLabel(result.name)}.`;
  }

  return `Actualicé ${joinLabels(successfulLabels)} correctamente.`;
}

function toFunctionResult(result: ToolExecutionResult) {
  return {
    type: "function_result",
    name: result.name,
    call_id: result.callId,
    is_error: !result.success,
    result: [
      {
        type: "text",
        text: JSON.stringify(
          result.success
            ? { success: true, value: result.value }
            : { success: false, reason: result.reason },
        ),
      },
    ],
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "JARVIS todavía no tiene configurada la API de Gemini." },
      { status: 503 },
    );
  }

  let parsedRequest: ParsedRequest;

  try {
    parsedRequest = await parseRequest(request);
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const messages = parsedRequest.messages;

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

  let imageAttachment: ImageAttachment | null = null;
  if (parsedRequest.image) {
    imageAttachment = await validateImage(parsedRequest.image);
    if (!imageAttachment) {
      return NextResponse.json(
        {
          error:
            "El archivo no es válido. Usa una imagen JPG, PNG o WEBP de hasta 5 MB.",
        },
        { status: 400 },
      );
    }
  }

  const transcript = messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "JARVIS" : "Usuario"}: ${message.content}`,
    )
    .join("\n\n");
  const prompt = `Continúa esta conversación y responde al último mensaje del usuario.
Archivo de imagen adjunto en esta solicitud: ${imageAttachment ? "sí" : "no"}.

${transcript}`;
  const ai = new GoogleGenAI({ apiKey });
  const history: Array<Record<string, unknown>> = [
    {
      type: "user_input",
      content: [{ type: "text", text: prompt }],
    },
  ];
  const executionResults: ToolExecutionResult[] = [];
  const executedTools = new Set<ToolName>();
  let writeContextPromise: Promise<WriteContext> | null = null;
  let interaction;

  try {
    interaction = await ai.interactions.create({
      model: GEMINI_MODEL,
      system_instruction: SYSTEM_INSTRUCTION,
      input: history,
      tools: jarvisTools,
      store: false,
    });
  } catch (error) {
    logTechnicalError("Gemini no pudo interpretar la solicitud:", error);
    return NextResponse.json(
      { error: "No pude interpretar la solicitud en este momento." },
      { status: 502 },
    );
  }

  for (let round = 0; round < MAX_TOOL_CALLS; round += 1) {
    const functionCalls = interaction.steps.filter(isFunctionCallStep);

    if (functionCalls.length === 0) {
      if (executionResults.length > 0) {
        return NextResponse.json({
          reply: summarizeToolResults(executionResults),
        });
      }

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
      functionCalls.some((call) => !isToolName(call.name)) ||
      executionResults.length + functionCalls.length > MAX_TOOL_CALLS
    ) {
      console.error("Gemini solicitó una herramienta no permitida o demasiadas llamadas.");
      return NextResponse.json(
        executionResults.length > 0
          ? { reply: summarizeToolResults(executionResults) }
          : { error: "No pude interpretar la solicitud en este momento." },
        { status: executionResults.length > 0 ? 200 : 502 },
      );
    }

    const roundResults: ToolExecutionResult[] = [];

    for (const call of functionCalls) {
      const name = call.name as ToolName;

      if (executedTools.has(name)) {
        roundResults.push({
          callId: call.id,
          name,
          success: false,
          reason: "duplicate",
        });
        continue;
      }

      executedTools.add(name);
      const value = validateToolArguments(call);

      if (!value) {
        roundResults.push({
          callId: call.id,
          name,
          success: false,
          reason: "validation",
        });
        continue;
      }

      if (name === UPDATE_HERO_IMAGE_TOOL && !imageAttachment) {
        roundResults.push({
          callId: call.id,
          name,
          success: false,
          reason: "missing_image",
        });
        continue;
      }

      try {
        writeContextPromise ??= createWriteContext();
        const context = await writeContextPromise;
        roundResults.push(
          await executeToolCall(call, context, imageAttachment),
        );
      } catch (error) {
        logTechnicalError("No se pudo preparar la escritura en Sanity:", error);
        roundResults.push({
          callId: call.id,
          name,
          success: false,
          reason: "sanity",
        });
      }
    }

    executionResults.push(...roundResults);

    if (roundResults.some((result) => result.success)) {
      try {
        revalidateTag(HOME_PAGE_CACHE_TAG, { expire: 0 });
        revalidatePath("/", "page");
      } catch (error) {
        logTechnicalError("No se pudo revalidar la Home:", error);
      }
    }

    history.push(...interaction.steps);
    history.push(...roundResults.map(toFunctionResult));

    try {
      interaction = await ai.interactions.create({
        model: GEMINI_MODEL,
        system_instruction: SYSTEM_INSTRUCTION,
        input: history,
        tools: jarvisTools,
        store: false,
      });
    } catch (error) {
      logTechnicalError("Gemini no pudo continuar después de las herramientas:", error);
      return NextResponse.json({
        reply: summarizeToolResults(executionResults),
      });
    }
  }

  return NextResponse.json({
    reply:
      executionResults.length > 0
        ? summarizeToolResults(executionResults)
        : "No pude interpretar la solicitud en este momento.",
  });
}
