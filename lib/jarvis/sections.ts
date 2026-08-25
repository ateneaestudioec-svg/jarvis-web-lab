import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "../../sanity/env";
import { HOME_PAGE_CACHE_TAG } from "../../sanity/lib/client";

export type SectionPosition = "afterHero" | "beforeFooter" | "end";
export type SectionType = "featureGrid3" | "imageText" | "cta";
export type FeatureItem = { _key?: string; title: string; text: string };

export type HomeSection = {
  _key: string;
  _type: SectionType;
  heading: string;
  isVisible: boolean;
  description?: string;
  items?: FeatureItem[];
  text?: string;
  image?: object;
  imagePosition?: "left" | "right";
  buttonText?: string;
  buttonUrl?: string;
};

function text(value: unknown, max: number, optional = false) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!normalized && !optional) || normalized.length > max) return null;
  return normalized;
}

function isSafeUrl(value: string) {
  if (value.startsWith("/") || value.startsWith("#")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function exactKeys(record: Record<string, unknown>, allowed: string[]) {
  return Object.keys(record).every((key) => allowed.includes(key));
}

export function validateSectionContent(type: SectionType, value: unknown): Omit<HomeSection, "_key" | "_type" | "isVisible"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const heading = text(input.heading, 150);
  if (!heading) return null;

  if (type === "featureGrid3") {
    if (!exactKeys(input, ["heading", "description", "items"]) || !Array.isArray(input.items) || input.items.length !== 3) return null;
    const description = text(input.description, 500, true);
    const items = input.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      if (!exactKeys(record, ["title", "text"])) return null;
      const title = text(record.title, 80);
      const body = text(record.text, 300);
      return title && body ? { _key: randomUUID(), title, text: body } : null;
    });
    if (description === null || items.some((item) => !item)) return null;
    return { heading, ...(description ? { description } : {}), items: items as FeatureItem[] };
  }

  if (type === "imageText") {
    if (!exactKeys(input, ["heading", "text", "imagePosition"])) return null;
    const body = text(input.text, 1000);
    if (!body || (input.imagePosition !== "left" && input.imagePosition !== "right")) return null;
    return { heading, text: body, imagePosition: input.imagePosition };
  }

  if (!exactKeys(input, ["heading", "text", "buttonText", "buttonUrl"])) return null;
  const body = text(input.text, 500);
  const buttonText = text(input.buttonText, 60);
  const buttonUrl = text(input.buttonUrl, 500);
  if (!body || !buttonText || !buttonUrl || !isSafeUrl(buttonUrl)) return null;
  return { heading, text: body, buttonText, buttonUrl };
}

export function validateAddSectionArguments(value: unknown): {
  type: SectionType;
  position: SectionPosition;
  content: Omit<HomeSection, "_key" | "_type" | "isVisible">;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, ["type", "position", "content"])) return null;
  if (input.type !== "featureGrid3" && input.type !== "imageText" && input.type !== "cta") return null;
  if (input.position !== "afterHero" && input.position !== "beforeFooter" && input.position !== "end") return null;
  const content = validateSectionContent(input.type, input.content);
  return content ? { type: input.type, position: input.position, content } : null;
}

function getWriteClient() {
  const token = process.env.SANITY_API_WRITE_TOKEN;
  if (!token || !projectId) throw new Error("Sanity write client is not configured.");
  return createClient({ projectId, dataset, apiVersion, useCdn: false, token });
}

async function getHomeState() {
  const client = getWriteClient();
  const home = await client.fetch<{ _id: string; sections?: HomeSection[] } | null>(
    `*[_type == "homePage" && !(_id in path("drafts.**"))][0]{_id, sections}`,
    {},
    { cache: "no-store", perspective: "published" },
  );
  if (!home) throw new Error("Published homePage was not found.");
  return { client, documentId: home._id, sections: Array.isArray(home.sections) ? home.sections : [] };
}

function revalidateHome() {
  revalidateTag(HOME_PAGE_CACHE_TAG, { expire: 0 });
  revalidatePath("/", "page");
}

export async function listHomeSections() {
  const { sections } = await getHomeState();
  return sections.filter((section) => ["featureGrid3", "imageText", "cta"].includes(section._type));
}

export async function addHomeSection(value: unknown) {
  const input = validateAddSectionArguments(value);
  if (!input) throw new Error("Invalid section.");
  const { client, documentId, sections } = await getHomeState();
  const section: HomeSection = { _key: randomUUID(), _type: input.type, isVisible: true, ...input.content };
  const next = input.position === "afterHero" ? [section, ...sections] : [...sections, section];
  await client.patch(documentId).set({ sections: next }).commit({ visibility: "sync" });
  revalidateHome();
  return section;
}

export async function updateHomeSection(sectionKey: string, expectedType: SectionType, content: unknown) {
  const safeKey = text(sectionKey, 80);
  const validated = validateSectionContent(expectedType, content);
  if (!safeKey || !validated) throw new Error("Invalid section update.");
  const { client, documentId, sections } = await getHomeState();
  const index = sections.findIndex((section) => section._key === safeKey && section._type === expectedType);
  if (index < 0) throw new Error("Section was not found.");
  const next = [...sections];
  next[index] = { ...next[index], ...validated };
  await client.patch(documentId).set({ sections: next }).commit({ visibility: "sync" });
  revalidateHome();
  return next[index];
}

export async function moveHomeSection(sectionKey: string, position: number) {
  const safeKey = text(sectionKey, 80);
  if (!safeKey || !Number.isInteger(position)) throw new Error("Invalid section position.");
  const { client, documentId, sections } = await getHomeState();
  const current = sections.findIndex((section) => section._key === safeKey);
  if (current < 0 || position < 0 || position >= sections.length) throw new Error("Section was not found.");
  const next = [...sections];
  const [section] = next.splice(current, 1);
  next.splice(position, 0, section);
  await client.patch(documentId).set({ sections: next }).commit({ visibility: "sync" });
  revalidateHome();
  return section;
}

export async function setHomeSectionVisibility(sectionKey: string, isVisible: boolean) {
  const safeKey = text(sectionKey, 80);
  if (!safeKey || typeof isVisible !== "boolean") throw new Error("Invalid visibility.");
  const { client, documentId, sections } = await getHomeState();
  const index = sections.findIndex((section) => section._key === safeKey);
  if (index < 0) throw new Error("Section was not found.");
  const next = [...sections];
  next[index] = { ...next[index], isVisible };
  await client.patch(documentId).set({ sections: next }).commit({ visibility: "sync" });
  revalidateHome();
  return next[index];
}

export async function deleteHomeSection(sectionKey: string) {
  const safeKey = text(sectionKey, 80);
  if (!safeKey) throw new Error("Invalid section key.");
  const { client, documentId, sections } = await getHomeState();
  const section = sections.find((item) => item._key === safeKey);
  if (!section) throw new Error("Section was not found.");
  await client.patch(documentId).set({ sections: sections.filter((item) => item._key !== safeKey) }).commit({ visibility: "sync" });
  revalidateHome();
  return section;
}
