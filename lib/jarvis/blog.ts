import { randomUUID } from "node:crypto";
import { createClient } from "next-sanity";
import { revalidatePath, revalidateTag } from "next/cache";
import { apiVersion, dataset, projectId } from "../../sanity/env";

export const BLOG_CACHE_TAG = "sanity:blogPosts";

export type BlogSection = {
  style: "normal" | "h2" | "h3";
  text: string;
};

export type BlogDraftInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: BlogSection[];
  seoTitle: string;
  seoDescription: string;
};

export type BlogSummary = {
  title: string;
  slug: string;
  status: "draft" | "published";
  publishedAt?: string;
  updatedAt?: string;
};

export type BlogPostContent = BlogDraftInput & {
  status: "draft" | "published";
  publishedAt?: string;
  mainImage: {
    configured: boolean;
    filename?: string;
    mimeType?: string;
    url?: string;
  };
};

type PortableBlock = {
  _key: string;
  _type: "block";
  style: BlogSection["style"];
  markDefs: [];
  children: Array<{
    _key: string;
    _type: "span";
    marks: [];
    text: string;
  }>;
};

export type PublicPortableBlock = {
  _key: string;
  _type: "block";
  style?: string;
  listItem?: "bullet" | "number";
  level?: number;
  markDefs?: Array<{ _key: string; _type: string; href?: string }>;
  children?: Array<{
    _key: string;
    _type: "span";
    marks?: string[];
    text: string;
  }>;
};

export type PublishedBlogPost = {
  title: string;
  slug: string;
  excerpt: string;
  content: PublicPortableBlock[];
  seoTitle?: string;
  seoDescription?: string;
  publishedAt?: string;
  mainImage?: { url?: string; alt?: string };
};

function getBlogClient() {
  const token = process.env.SANITY_API_WRITE_TOKEN;
  if (!token || !projectId) throw new Error("Blog client is not configured.");
  return createClient({ projectId, dataset, apiVersion, useCdn: false, token });
}

function getPublicBlogClient() {
  if (!projectId) throw new Error("Public Blog client is not configured.");
  return createClient({ projectId, dataset, apiVersion, useCdn: false });
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function normalizeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function validateBlogSections(value: unknown): BlogSection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) return null;
  const sections: BlogSection[] = [];
  let totalLength = 0;

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const section = item as Record<string, unknown>;
    if (
      Object.keys(section).some((key) => key !== "style" && key !== "text") ||
      (section.style !== "normal" && section.style !== "h2" && section.style !== "h3")
    ) {
      return null;
    }
    const text = normalizeText(section.text, 4000);
    if (!text) return null;
    totalLength += text.length;
    if (totalLength > 30000) return null;
    sections.push({ style: section.style, text });
  }

  return sections;
}

export function validateBlogDraftInput(value: unknown): BlogDraftInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "title",
    "slug",
    "excerpt",
    "content",
    "seoTitle",
    "seoDescription",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;

  const title = normalizeText(input.title, 150);
  const rawSlug = normalizeText(input.slug, 120);
  const excerpt = normalizeText(input.excerpt, 300);
  const content = validateBlogSections(input.content);
  const seoTitle = normalizeText(input.seoTitle, 70);
  const seoDescription = normalizeText(input.seoDescription, 170);
  const slug = rawSlug ? normalizeSlug(rawSlug) : title ? normalizeSlug(title) : "";

  return title && slug && excerpt && content && seoTitle && seoDescription
    ? { title, slug, excerpt, content, seoTitle, seoDescription }
    : null;
}

function toPortableText(sections: BlogSection[]): PortableBlock[] {
  return sections.map((section) => ({
    _key: randomUUID().replaceAll("-", "").slice(0, 12),
    _type: "block",
    style: section.style,
    markDefs: [],
    children: [
      {
        _key: randomUUID().replaceAll("-", "").slice(0, 12),
        _type: "span",
        marks: [],
        text: section.text,
      },
    ],
  }));
}

function revalidateBlog() {
  revalidateTag(BLOG_CACHE_TAG, { expire: 0 });
  revalidatePath("/jarvis", "page");
  revalidatePath("/blog", "page");
}

function revalidateBlogPost(slug: string) {
  revalidateBlog();
  revalidatePath(`/blog/${slug}`, "page");
}

async function uniqueSlug(baseSlug: string, excludedId?: string) {
  const client = getBlogClient();
  let candidate = baseSlug;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const exists = await client.fetch<boolean>(
      `count(*[_type == "blogPost" && slug.current == $slug && (!defined($excludedId) || _id != $excludedId)]) > 0`,
      { slug: candidate, excludedId: excludedId ?? null },
      { cache: "no-store", perspective: "raw" },
    );
    if (!exists) return candidate;
    candidate = `${baseSlug.slice(0, 90)}-${suffix}`;
  }
  throw new Error("Could not generate a unique slug.");
}

export async function listBlogPosts(): Promise<BlogSummary[]> {
  return getBlogClient().fetch<BlogSummary[]>(
    `*[_type == "blogPost"] | order(_updatedAt desc){
      title,
      "slug": slug.current,
      "status": select(_id in path("drafts.**") => "draft", status),
      publishedAt,
      "updatedAt": _updatedAt
    }`,
    {},
    { cache: "no-store", perspective: "raw" },
  );
}

export async function listPublishedBlogPosts(): Promise<PublishedBlogPost[]> {
  return getPublicBlogClient().fetch<PublishedBlogPost[]>(
    `*[
      _type == "blogPost" &&
      !(_id in path("drafts.**")) &&
      status == "published" &&
      defined(slug.current) &&
      defined(title) &&
      defined(content)
    ] | order(publishedAt desc){
      title,
      "slug": slug.current,
      excerpt,
      publishedAt,
      "mainImage": { "url": mainImage.asset->url, "alt": coalesce(mainImage.alt, title) }
    }`,
    {},
    { cache: "no-store", perspective: "published" },
  );
}

export async function getPublishedBlogPost(slug: string): Promise<PublishedBlogPost | null> {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug || safeSlug !== slug) return null;
  return getPublicBlogClient().fetch<PublishedBlogPost | null>(
    `*[
      _type == "blogPost" &&
      !(_id in path("drafts.**")) &&
      status == "published" &&
      slug.current == $slug &&
      defined(title) &&
      defined(content)
    ][0]{
      title,
      "slug": slug.current,
      excerpt,
      content,
      seoTitle,
      seoDescription,
      publishedAt,
      "mainImage": { "url": mainImage.asset->url, "alt": coalesce(mainImage.alt, title) }
    }`,
    { slug: safeSlug },
    { cache: "no-store", perspective: "published" },
  );
}

export async function getBlogPost(slug: string): Promise<BlogPostContent | null> {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;
  return getBlogClient().fetch<BlogPostContent | null>(
    `*[_type == "blogPost" && slug.current == $slug][0]{
      title,
      "slug": slug.current,
      excerpt,
      seoTitle,
      seoDescription,
      "content": content[]{ style, "text": pt::text(@) },
      "status": select(_id in path("drafts.**") => "draft", status),
      publishedAt,
      "mainImage": {
        "configured": defined(mainImage.asset),
        "filename": mainImage.asset->originalFilename,
        "mimeType": mainImage.asset->mimeType,
        "url": mainImage.asset->url
      }
    }`,
    { slug: safeSlug },
    { cache: "no-store", perspective: "raw" },
  );
}

export async function createBlogDraft(value: unknown) {
  const input = validateBlogDraftInput(value);
  if (!input) throw new Error("Invalid blog draft.");
  const client = getBlogClient();
  const slug = await uniqueSlug(input.slug);
  const document = await client.create({
    _id: `drafts.blogPost-${randomUUID()}`,
    _type: "blogPost",
    title: input.title,
    slug: { _type: "slug", current: slug },
    excerpt: input.excerpt,
    content: toPortableText(input.content),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    status: "draft",
  });
  revalidateBlog();
  return { title: document.title as string, slug, status: "draft" as const };
}

async function getEditableId(slug: string) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) throw new Error("Invalid slug.");
  const id = await getBlogClient().fetch<string | null>(
    `*[_type == "blogPost" && slug.current == $slug][0]._id`,
    { slug: safeSlug },
    { cache: "no-store", perspective: "raw" },
  );
  if (!id) throw new Error("Blog post was not found.");
  return { id, slug: safeSlug };
}

export type BlogUpdate = Partial<BlogDraftInput>;

export async function updateBlogDraft(slug: string, changes: BlogUpdate) {
  const { id } = await getEditableId(slug);
  const patch: Record<string, unknown> = {};

  if (changes.title !== undefined) {
    const title = normalizeText(changes.title, 150);
    if (!title) throw new Error("Invalid title.");
    patch.title = title;
  }
  if (changes.slug !== undefined) {
    const normalized = normalizeSlug(changes.slug);
    if (!normalized) throw new Error("Invalid slug.");
    patch.slug = { _type: "slug", current: await uniqueSlug(normalized, id) };
  }
  if (changes.excerpt !== undefined) {
    const excerpt = normalizeText(changes.excerpt, 300);
    if (!excerpt) throw new Error("Invalid excerpt.");
    patch.excerpt = excerpt;
  }
  if (changes.seoTitle !== undefined) {
    const seoTitle = normalizeText(changes.seoTitle, 70);
    if (!seoTitle) throw new Error("Invalid SEO title.");
    patch.seoTitle = seoTitle;
  }
  if (changes.seoDescription !== undefined) {
    const seoDescription = normalizeText(changes.seoDescription, 170);
    if (!seoDescription) throw new Error("Invalid SEO description.");
    patch.seoDescription = seoDescription;
  }
  if (changes.content !== undefined) {
    const content = validateBlogSections(changes.content);
    if (!content) throw new Error("Invalid content.");
    patch.content = toPortableText(content);
  }
  if (Object.keys(patch).length === 0) throw new Error("No valid changes.");

  await getBlogClient().patch(id).set(patch).commit();
  const finalSlug = (patch.slug as { current?: string } | undefined)?.current ?? slug;
  revalidateBlogPost(finalSlug);
  if (finalSlug !== slug) revalidatePath(`/blog/${slug}`, "page");
  return getBlogPost(finalSlug);
}

export async function updateBlogMainImage(
  slug: string,
  image: { buffer: Buffer; filename: string; contentType: string },
) {
  const { id } = await getEditableId(slug);
  const client = getBlogClient();
  const asset = await client.assets.upload("image", image.buffer, {
    filename: image.filename,
    contentType: image.contentType,
  });
  await client
    .patch(id)
    .set({
      mainImage: {
        _type: "image",
        asset: { _type: "reference", _ref: asset._id },
      },
    })
    .commit();
  revalidateBlogPost(slug);
  return getBlogPost(slug);
}

export async function publishBlogPost(slug: string) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug || safeSlug !== slug) throw new Error("Invalid slug.");
  const client = getBlogClient();
  const draft = await client.fetch<Record<string, unknown> | null>(
    `*[_type == "blogPost" && _id in path("drafts.**") && slug.current == $slug][0]`,
    { slug: safeSlug },
    { cache: "no-store", perspective: "raw" },
  );
  if (!draft) throw new Error("Draft was not found or is already published.");

  const title = normalizeText(draft.title, 150);
  const content = Array.isArray(draft.content) ? draft.content : null;
  if (!title || !content || content.length === 0) throw new Error("Draft is incomplete.");

  const publishedId = String(draft._id).replace(/^drafts\./, "");
  const conflict = await client.fetch<boolean>(
    `count(*[
      _type == "blogPost" &&
      !(_id in path("drafts.**")) &&
      status == "published" &&
      slug.current == $slug &&
      _id != $publishedId
    ]) > 0`,
    { slug: safeSlug, publishedId },
    { cache: "no-store", perspective: "raw" },
  );
  if (conflict) throw new Error("Another published article already uses this slug.");

  const publishedAt =
    typeof draft.publishedAt === "string" ? draft.publishedAt : new Date().toISOString();
  const updatedDraft = await client
    .patch(String(draft._id))
    .set({ status: "published", publishedAt })
    .commit();
  await client.action({
    actionType: "sanity.action.document.publish",
    draftId: String(draft._id),
    publishedId,
    ifDraftRevisionId: updatedDraft._rev,
  });
  revalidateBlogPost(safeSlug);
  return { title, slug: safeSlug, status: "published" as const, publishedAt };
}
