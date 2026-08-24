import { GoogleGenAI } from "@google/genai";
import { createClient } from "next-sanity";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { apiVersion, dataset, projectId } from "../../../sanity/env";
import { HOME_PAGE_CACHE_TAG } from "../../../sanity/lib/client";
import { validateImageFile, type ValidatedImage } from "../../../lib/jarvis/image";
import {
  createBlogDraft,
  getBlogPost,
  listBlogPosts,
  updateBlogDraft,
  validateBlogDraftInput,
  validateBlogSections,
} from "../../../lib/jarvis/blog";

const GEMINI_MODEL = "gemini-3.5-flash";
const UPDATE_HERO_TITLE_TOOL = "updateHeroTitle";
const UPDATE_HERO_DESCRIPTION_TOOL = "updateHeroDescription";
const UPDATE_HERO_BUTTON_TEXT_TOOL = "updateHeroButtonText";
const UPDATE_HERO_IMAGE_TOOL = "updateHeroImage";
const GET_HOME_CONTENT_TOOL = "getHomeContent";
const GET_BLOG_POSTS_TOOL = "getBlogPosts";
const GET_BLOG_POST_TOOL = "getBlogPost";
const CREATE_BLOG_DRAFT_TOOL = "createBlogDraft";
const UPDATE_BLOG_TITLE_TOOL = "updateBlogTitle";
const UPDATE_BLOG_EXCERPT_TOOL = "updateBlogExcerpt";
const UPDATE_BLOG_SEO_TOOL = "updateBlogSeo";
const UPDATE_BLOG_CONTENT_TOOL = "updateBlogContent";
const MAX_TITLE_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BUTTON_TEXT_LENGTH = 60;
const MAX_TOOL_CALLS = 8;

const SYSTEM_INSTRUCTION = `Eres JARVIS, el administrador inteligente de JARVIS WEB LAB.

Ayudas al usuario a consultar, analizar y gestionar el contenido de su sitio mediante conversación natural.

Herramienta de lectura:
- getHomeContent: consulta el estado real y publicado de la Home. Úsala siempre antes de responder preguntas dependientes del contenido actual, como qué tiene la Home, cuál es el valor actual, qué mejorarías, si un texto es largo o qué debería cambiarse.

Herramientas de escritura autorizadas:
- updateHeroTitle: cambia únicamente el título principal del Hero.
- updateHeroDescription: cambia únicamente la descripción del Hero.
- updateHeroButtonText: cambia únicamente el texto del botón del Hero.
- updateHeroImage: reemplaza únicamente la imagen principal con un archivo adjunto por el usuario.

Puedes explicar sin consultar Sanity que actualmente puedes leer y modificar el contenido autorizado de la Home y administrar borradores de Blog. No puedes cambiar colores, tipografías, estilos, layout, crear secciones, publicar artículos ni modificar código.

Cuando el usuario pida recomendaciones sobre el contenido, llama primero getHomeContent, recomienda cambios concretos y no modifiques nada hasta recibir aprobación. Conserva el contexto de la conversación para entender aprobaciones inequívocas como “Hazlo”. Si una petición es ambigua y el contexto no aclara el elemento, pregunta si se refiere al título, descripción, botón o imagen.

Cuando solicite varios cambios aprobados, usa una llamada independiente por herramienta. No combines campos ni inventes herramientas. Para reemplazar la imagen, llama updateHeroImage; si falta el archivo, el servidor lo indicará. No uses esa herramienta para generar, editar, recortar o buscar imágenes.

Nunca afirmes que realizaste un cambio salvo que recibas un resultado exitoso de la herramienta correspondiente. Sanity es la fuente de verdad para el contenido actual.`;

const BLOG_SYSTEM_INSTRUCTION = `También administras borradores de Blog.
- getBlogPosts consulta la lista real antes de responder preguntas sobre entradas o borradores.
- getBlogPost consulta el contenido real de un artículo concreto antes de recomendar cambios.
- createBlogDraft genera una entrada completa y la guarda exclusivamente como borrador. Respeta tema, longitud, tono, audiencia, objetivo, SEO y CTA solicitados. Estructura el contenido en párrafos y subtítulos. No prometas optimización SEO absoluta; habla de buenas prácticas on-page.
- updateBlogTitle, updateBlogExcerpt, updateBlogSeo y updateBlogContent modifican exclusivamente el campo indicado de un borrador concreto.

Nunca publiques. Aunque el usuario pida crear y publicar, puedes crear el borrador pero debes explicar que publicar requiere revisión humana. No elimines entradas. Para acciones “Mejorar con Jarvis”, consulta primero el artículo, ofrece sugerencias y espera aprobación inequívoca antes de actualizar.`;

const FULL_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION}\n\n${BLOG_SYSTEM_INSTRUCTION}`;

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

const getHomeContentTool = {
  type: "function" as const,
  name: GET_HOME_CONTENT_TOOL,
  description:
    "Consulta el contenido publicado actual de la Home para responder preguntas o hacer recomendaciones basadas en datos reales.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const blogContentSchema = {
  type: "array",
  minItems: 1,
  maxItems: 80,
  items: {
    type: "object",
    properties: {
      style: { type: "string", enum: ["normal", "h2", "h3"] },
      text: { type: "string", maxLength: 4000 },
    },
    required: ["style", "text"],
    additionalProperties: false,
  },
};

const getBlogPostsTool = {
  type: "function" as const,
  name: GET_BLOG_POSTS_TOOL,
  description: "Consulta las entradas y borradores reales existentes en Sanity.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

const getBlogPostTool = {
  type: "function" as const,
  name: GET_BLOG_POST_TOOL,
  description: "Consulta el contenido real de una entrada concreta antes de analizarla.",
  parameters: {
    type: "object",
    properties: { slug: { type: "string", maxLength: 96 } },
    required: ["slug"],
    additionalProperties: false,
  },
};

const createBlogDraftTool = {
  type: "function" as const,
  name: CREATE_BLOG_DRAFT_TOOL,
  description: "Genera y crea una entrada completa exclusivamente como borrador en Sanity.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 150 },
      slug: { type: "string", maxLength: 120 },
      excerpt: { type: "string", maxLength: 300 },
      content: blogContentSchema,
      seoTitle: { type: "string", maxLength: 70 },
      seoDescription: { type: "string", maxLength: 170 },
    },
    required: ["title", "slug", "excerpt", "content", "seoTitle", "seoDescription"],
    additionalProperties: false,
  },
};

const updateBlogTitleTool = {
  type: "function" as const,
  name: UPDATE_BLOG_TITLE_TOOL,
  description: "Actualiza únicamente el título de un borrador de Blog identificado por su slug.",
  parameters: {
    type: "object",
    properties: { slug: { type: "string", maxLength: 96 }, title: { type: "string", maxLength: 150 } },
    required: ["slug", "title"],
    additionalProperties: false,
  },
};

const updateBlogExcerptTool = {
  type: "function" as const,
  name: UPDATE_BLOG_EXCERPT_TOOL,
  description: "Actualiza únicamente el extracto de un borrador de Blog.",
  parameters: {
    type: "object",
    properties: { slug: { type: "string", maxLength: 96 }, excerpt: { type: "string", maxLength: 300 } },
    required: ["slug", "excerpt"],
    additionalProperties: false,
  },
};

const updateBlogSeoTool = {
  type: "function" as const,
  name: UPDATE_BLOG_SEO_TOOL,
  description: "Actualiza únicamente el SEO title y la SEO description de un borrador.",
  parameters: {
    type: "object",
    properties: {
      slug: { type: "string", maxLength: 96 },
      seoTitle: { type: "string", maxLength: 70 },
      seoDescription: { type: "string", maxLength: 170 },
    },
    required: ["slug", "seoTitle", "seoDescription"],
    additionalProperties: false,
  },
};

const updateBlogContentTool = {
  type: "function" as const,
  name: UPDATE_BLOG_CONTENT_TOOL,
  description: "Actualiza únicamente el contenido Portable Text de un borrador.",
  parameters: {
    type: "object",
    properties: { slug: { type: "string", maxLength: 96 }, content: blogContentSchema },
    required: ["slug", "content"],
    additionalProperties: false,
  },
};

const jarvisTools = [
  updateHeroTitleTool,
  updateHeroDescriptionTool,
  updateHeroButtonTextTool,
  updateHeroImageTool,
  getHomeContentTool,
  getBlogPostsTool,
  getBlogPostTool,
  createBlogDraftTool,
  updateBlogTitleTool,
  updateBlogExcerptTool,
  updateBlogSeoTool,
  updateBlogContentTool,
];

type ToolName =
  | typeof UPDATE_HERO_TITLE_TOOL
  | typeof UPDATE_HERO_DESCRIPTION_TOOL
  | typeof UPDATE_HERO_BUTTON_TEXT_TOOL
  | typeof UPDATE_HERO_IMAGE_TOOL
  | typeof GET_HOME_CONTENT_TOOL
  | typeof GET_BLOG_POSTS_TOOL
  | typeof GET_BLOG_POST_TOOL
  | typeof CREATE_BLOG_DRAFT_TOOL
  | typeof UPDATE_BLOG_TITLE_TOOL
  | typeof UPDATE_BLOG_EXCERPT_TOOL
  | typeof UPDATE_BLOG_SEO_TOOL
  | typeof UPDATE_BLOG_CONTENT_TOOL;

type HomeContentResult = {
  heroTitle: string;
  heroDescription: string;
  heroButtonText: string;
  heroImage: {
    configured: boolean;
    filename?: string;
    mimeType?: string;
    url?: string;
  };
};

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
  data?: unknown;
  reason?: "validation" | "sanity" | "duplicate" | "missing_image";
};

type ImageAttachment = ValidatedImage;

type ParsedRequest = {
  messages: unknown;
  image: File | null;
  mode: "chat" | "manual";
  changes: unknown;
};

type WriteContext = {
  documentId: string;
  writeClient: ReturnType<typeof createClient>;
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
    value === UPDATE_HERO_IMAGE_TOOL ||
    value === GET_HOME_CONTENT_TOOL ||
    value === GET_BLOG_POSTS_TOOL ||
    value === GET_BLOG_POST_TOOL ||
    value === CREATE_BLOG_DRAFT_TOOL ||
    value === UPDATE_BLOG_TITLE_TOOL ||
    value === UPDATE_BLOG_EXCERPT_TOOL ||
    value === UPDATE_BLOG_SEO_TOOL ||
    value === UPDATE_BLOG_CONTENT_TOOL
  );
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const rawMessages = formData.get("messages");
    const rawChanges = formData.get("changes");
    const image = formData.get("image");
    const mode = formData.get("mode") === "manual" ? "manual" : "chat";

    if (mode === "chat" && typeof rawMessages !== "string") {
      throw new Error("Missing messages.");
    }

    return {
      messages:
        typeof rawMessages === "string"
          ? (JSON.parse(rawMessages) as unknown)
          : null,
      image: image instanceof File && image.size > 0 ? image : null,
      mode,
      changes:
        typeof rawChanges === "string"
          ? (JSON.parse(rawChanges) as unknown)
          : null,
    };
  }

  const body = (await request.json()) as unknown;
  return {
    messages:
      body && typeof body === "object" && "messages" in body
        ? (body as { messages: unknown }).messages
        : null,
    image: null,
    mode: "chat",
    changes: null,
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
    case GET_HOME_CONTENT_TOOL:
      return Object.keys(call.arguments).length === 0 ? "__read__" : null;
    case GET_BLOG_POSTS_TOOL:
      return Object.keys(call.arguments).length === 0 ? "__blog_list__" : null;
    case GET_BLOG_POST_TOOL:
      return validateStrictStrings(call.arguments, { slug: 96 }) ? "__blog_post__" : null;
    case CREATE_BLOG_DRAFT_TOOL:
      return validateBlogDraftInput(call.arguments) ? "__blog_create__" : null;
    case UPDATE_BLOG_TITLE_TOOL:
      return validateStrictStrings(call.arguments, { slug: 96, title: 150 }) ? "__blog_title__" : null;
    case UPDATE_BLOG_EXCERPT_TOOL:
      return validateStrictStrings(call.arguments, { slug: 96, excerpt: 300 }) ? "__blog_excerpt__" : null;
    case UPDATE_BLOG_SEO_TOOL:
      return validateStrictStrings(call.arguments, { slug: 96, seoTitle: 70, seoDescription: 170 }) ? "__blog_seo__" : null;
    case UPDATE_BLOG_CONTENT_TOOL: {
      const args = call.arguments;
      return Object.keys(args).length === 2 &&
        typeof args.slug === "string" &&
        args.slug.trim().length > 0 &&
        args.slug.length <= 96 &&
        validateBlogSections(args.content)
        ? "__blog_content__"
        : null;
    }
    default:
      return null;
  }
}

function validateStrictStrings(
  value: unknown,
  fields: Record<string, number>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expectedKeys = Object.keys(fields);
  return keys.length === expectedKeys.length &&
    expectedKeys.every(
      (key) =>
        typeof record[key] === "string" &&
        Boolean((record[key] as string).trim()) &&
        (record[key] as string).length <= fields[key],
    );
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

async function fetchHomeContent(): Promise<HomeContentResult> {
  if (!projectId) throw new Error("Sanity read client is not configured.");

  const readClient = createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
  });
  const content = await readClient.fetch<HomeContentResult | null>(
      `*[_type == "homePage" && !(_id in path("drafts.**"))][0]{
        heroTitle,
        heroDescription,
        heroButtonText,
        "heroImage": {
          "configured": defined(heroImage.asset),
          "filename": heroImage.asset->originalFilename,
          "mimeType": heroImage.asset->mimeType,
          "url": heroImage.asset->url
        }
      }`,
      {},
      { cache: "no-store", perspective: "published" },
  );

  if (!content) throw new Error("Published homePage was not found.");
  return content;
}

async function getHomeContent(
  call: FunctionCallStep,
): Promise<ToolExecutionResult> {
  if (Object.keys(call.arguments).length !== 0) {
    return {
      callId: call.id,
      name: GET_HOME_CONTENT_TOOL,
      success: false,
      reason: "validation",
    };
  }

  try {
    const content = await fetchHomeContent();

    return {
      callId: call.id,
      name: GET_HOME_CONTENT_TOOL,
      success: true,
      data: content,
    };
  } catch (error) {
    logTechnicalError("No se pudo consultar la Home en Sanity:", error);
    return {
      callId: call.id,
      name: GET_HOME_CONTENT_TOOL,
      success: false,
      reason: "sanity",
    };
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      content: await fetchHomeContent(),
      provider: "gemini",
      configured: Boolean(process.env.GEMINI_API_KEY),
      contentToolsConfigured: Boolean(process.env.SANITY_API_WRITE_TOKEN),
    });
  } catch (error) {
    logTechnicalError("No se pudo cargar el contenido para el panel:", error);
    return NextResponse.json(
      { error: "No se pudo cargar el contenido actual de la Home." },
      { status: 502 },
    );
  }
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

async function executeBlogTool(call: FunctionCallStep): Promise<ToolExecutionResult> {
  const name = call.name as ToolName;
  try {
    switch (name) {
      case GET_BLOG_POSTS_TOOL:
        return { callId: call.id, name, success: true, data: await listBlogPosts() };
      case GET_BLOG_POST_TOOL: {
        const post = await getBlogPost(String(call.arguments.slug));
        return post
          ? { callId: call.id, name, success: true, data: post }
          : { callId: call.id, name, success: false, reason: "sanity" };
      }
      case CREATE_BLOG_DRAFT_TOOL: {
        const created = await createBlogDraft(call.arguments);
        return { callId: call.id, name, success: true, value: created.title, data: created };
      }
      case UPDATE_BLOG_TITLE_TOOL: {
        const post = await updateBlogDraft(String(call.arguments.slug), {
          title: String(call.arguments.title),
        });
        return { callId: call.id, name, success: true, value: post?.title, data: post };
      }
      case UPDATE_BLOG_EXCERPT_TOOL: {
        const post = await updateBlogDraft(String(call.arguments.slug), {
          excerpt: String(call.arguments.excerpt),
        });
        return { callId: call.id, name, success: true, data: post };
      }
      case UPDATE_BLOG_SEO_TOOL: {
        const post = await updateBlogDraft(String(call.arguments.slug), {
          seoTitle: String(call.arguments.seoTitle),
          seoDescription: String(call.arguments.seoDescription),
        });
        return { callId: call.id, name, success: true, data: post };
      }
      case UPDATE_BLOG_CONTENT_TOOL: {
        const content = validateBlogSections(call.arguments.content);
        if (!content) return { callId: call.id, name, success: false, reason: "validation" };
        const post = await updateBlogDraft(String(call.arguments.slug), { content });
        return { callId: call.id, name, success: true, data: post };
      }
      default:
        return { callId: call.id, name, success: false, reason: "validation" };
    }
  } catch (error) {
    logTechnicalError(`No se pudo ejecutar ${name}:`, error);
    return { callId: call.id, name, success: false, reason: "sanity" };
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
    case GET_HOME_CONTENT_TOOL:
      return "el contenido de la Home";
    case GET_BLOG_POSTS_TOOL:
      return "las entradas del Blog";
    case GET_BLOG_POST_TOOL:
      return "el borrador del Blog";
    case CREATE_BLOG_DRAFT_TOOL:
      return "el borrador del Blog";
    case UPDATE_BLOG_TITLE_TOOL:
      return "el título del Blog";
    case UPDATE_BLOG_EXCERPT_TOOL:
      return "el extracto del Blog";
    case UPDATE_BLOG_SEO_TOOL:
      return "el SEO del Blog";
    case UPDATE_BLOG_CONTENT_TOOL:
      return "el contenido del Blog";
  }
}

function isWriteToolName(name: ToolName) {
  return name !== GET_HOME_CONTENT_TOOL &&
    name !== GET_BLOG_POSTS_TOOL &&
    name !== GET_BLOG_POST_TOOL;
}

function isBlogToolName(name: ToolName) {
  return name === GET_BLOG_POSTS_TOOL ||
    name === GET_BLOG_POST_TOOL ||
    name === CREATE_BLOG_DRAFT_TOOL ||
    name === UPDATE_BLOG_TITLE_TOOL ||
    name === UPDATE_BLOG_EXCERPT_TOOL ||
    name === UPDATE_BLOG_SEO_TOOL ||
    name === UPDATE_BLOG_CONTENT_TOOL;
}

function isHomeWriteToolName(name: ToolName) {
  return name === UPDATE_HERO_TITLE_TOOL ||
    name === UPDATE_HERO_DESCRIPTION_TOOL ||
    name === UPDATE_HERO_BUTTON_TEXT_TOOL ||
    name === UPDATE_HERO_IMAGE_TOOL;
}

function joinLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? "el contenido";
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

function summarizeToolResults(results: ToolExecutionResult[]) {
  const writeResults = results.filter((result) => isWriteToolName(result.name));
  const successful = writeResults.filter((result) => result.success);
  const failed = writeResults.filter((result) => !result.success);

  if (successful.length === 0) {
    if (
      failed.length === 1 &&
      failed[0].name === CREATE_BLOG_DRAFT_TOOL &&
      failed[0].reason === "sanity"
    ) {
      return "Generé el contenido, pero no pude guardar el borrador.";
    }

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
    if (result.name === CREATE_BLOG_DRAFT_TOOL) {
      return `Listo. Creé el borrador “${result.value}”. Puedes revisarlo en Blog; la publicación todavía requiere revisión humana.`;
    }
    if (result.name === UPDATE_BLOG_TITLE_TOOL) {
      return `Listo. El título del borrador ahora es “${result.value}”.`;
    }
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
            ? { success: true, value: result.value, content: result.data }
            : { success: false, reason: result.reason },
        ),
      },
    ],
  };
}

function revalidateHome() {
  revalidateTag(HOME_PAGE_CACHE_TAG, { expire: 0 });
  revalidatePath("/", "page");
}

function createManualToolCalls(
  changes: unknown,
  hasImage: boolean,
): FunctionCallStep[] | null {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return hasImage
      ? [{ type: "function_call", id: "manual-image", name: UPDATE_HERO_IMAGE_TOOL, arguments: {} }]
      : null;
  }

  const values = changes as Record<string, unknown>;
  const allowedKeys = new Set([
    "heroTitle",
    "heroDescription",
    "heroButtonText",
  ]);
  if (Object.keys(values).some((key) => !allowedKeys.has(key))) return null;

  const calls: FunctionCallStep[] = [];
  if ("heroTitle" in values) {
    calls.push({
      type: "function_call",
      id: "manual-title",
      name: UPDATE_HERO_TITLE_TOOL,
      arguments: { title: values.heroTitle },
    });
  }
  if ("heroDescription" in values) {
    calls.push({
      type: "function_call",
      id: "manual-description",
      name: UPDATE_HERO_DESCRIPTION_TOOL,
      arguments: { description: values.heroDescription },
    });
  }
  if ("heroButtonText" in values) {
    calls.push({
      type: "function_call",
      id: "manual-button",
      name: UPDATE_HERO_BUTTON_TEXT_TOOL,
      arguments: { buttonText: values.heroButtonText },
    });
  }
  if (hasImage) {
    calls.push({
      type: "function_call",
      id: "manual-image",
      name: UPDATE_HERO_IMAGE_TOOL,
      arguments: {},
    });
  }

  return calls.length > 0 ? calls : null;
}

async function handleManualUpdate(
  changes: unknown,
  image: ImageAttachment | null,
) {
  const calls = createManualToolCalls(changes, Boolean(image));
  if (!calls || calls.some((call) => !validateToolArguments(call))) {
    return NextResponse.json(
      { error: "Los cambios enviados no son válidos." },
      { status: 400 },
    );
  }

  let context: WriteContext;
  try {
    context = await createWriteContext();
  } catch (error) {
    logTechnicalError("No se pudo preparar la escritura manual:", error);
    return NextResponse.json(
      { error: "No se pudo guardar el contenido en este momento." },
      { status: 503 },
    );
  }

  const results: ToolExecutionResult[] = [];
  for (const call of calls) {
    results.push(await executeToolCall(call, context, image));
  }

  if (results.some((result) => !result.success)) {
    return NextResponse.json(
      { error: "Algunos cambios no pudieron guardarse." },
      { status: 502 },
    );
  }

  try {
    revalidateHome();
    return NextResponse.json({
      message: "Cambios guardados",
      content: await fetchHomeContent(),
    });
  } catch (error) {
    logTechnicalError("Los cambios se guardaron, pero no pudieron sincronizarse:", error);
    return NextResponse.json(
      { error: "Los cambios se guardaron, pero no pudieron sincronizarse." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let parsedRequest: ParsedRequest;

  try {
    parsedRequest = await parseRequest(request);
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  let imageAttachment: ImageAttachment | null = null;
  if (parsedRequest.image) {
    imageAttachment = await validateImageFile(parsedRequest.image);
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

  if (parsedRequest.mode === "manual") {
    return handleManualUpdate(parsedRequest.changes, imageAttachment);
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "JARVIS todavía no tiene configurada la API de Gemini." },
      { status: 503 },
    );
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
      system_instruction: FULL_SYSTEM_INSTRUCTION,
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
      if (executionResults.some((result) => isWriteToolName(result.name))) {
        return NextResponse.json({
          reply: summarizeToolResults(executionResults),
          contentChanged: executionResults.some(
            (result) => result.success && isWriteToolName(result.name),
          ),
        });
      }

      const reply = interaction.output_text?.trim();
      if (!reply) {
        return NextResponse.json(
          { error: "No pude interpretar la solicitud en este momento." },
          { status: 502 },
        );
      }

      return NextResponse.json({ reply, contentChanged: false });
    }

    if (
      functionCalls.some((call) => !isToolName(call.name)) ||
      executionResults.length + functionCalls.length > MAX_TOOL_CALLS
    ) {
      console.error("Gemini solicitó una herramienta no permitida o demasiadas llamadas.");
      return NextResponse.json(
        executionResults.some((result) => isWriteToolName(result.name))
          ? {
              reply: summarizeToolResults(executionResults),
              contentChanged: executionResults.some(
                (result) => result.success && isWriteToolName(result.name),
              ),
            }
          : { error: "No pude interpretar la solicitud en este momento." },
        {
          status: executionResults.some((result) => isWriteToolName(result.name))
            ? 200
            : 502,
        },
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

      if (name === GET_HOME_CONTENT_TOOL) {
        roundResults.push(await getHomeContent(call));
        continue;
      }

      if (isBlogToolName(name)) {
        roundResults.push(await executeBlogTool(call));
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

    if (
      roundResults.some(
        (result) => result.success && isHomeWriteToolName(result.name),
      )
    ) {
      try {
        revalidateHome();
      } catch (error) {
        logTechnicalError("No se pudo revalidar la Home:", error);
      }
    }

    history.push(...interaction.steps);
    history.push(...roundResults.map(toFunctionResult));

    try {
      interaction = await ai.interactions.create({
        model: GEMINI_MODEL,
        system_instruction: FULL_SYSTEM_INSTRUCTION,
        input: history,
        tools: jarvisTools,
        store: false,
      });
    } catch (error) {
      logTechnicalError("Gemini no pudo continuar después de las herramientas:", error);
      const hasWriteResult = executionResults.some((result) =>
        isWriteToolName(result.name),
      );
      return NextResponse.json(
        hasWriteResult
          ? {
              reply: summarizeToolResults(executionResults),
              contentChanged: executionResults.some(
                (result) => result.success && isWriteToolName(result.name),
              ),
            }
          : { error: "No pude interpretar la solicitud en este momento." },
        { status: hasWriteResult ? 200 : 502 },
      );
    }
  }

  return NextResponse.json({
    reply:
      executionResults.some((result) => isWriteToolName(result.name))
        ? summarizeToolResults(executionResults)
        : "No pude interpretar la solicitud en este momento.",
    contentChanged: executionResults.some(
      (result) => result.success && isWriteToolName(result.name),
    ),
  });
}
