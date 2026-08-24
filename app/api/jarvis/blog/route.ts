import { NextResponse } from "next/server";
import {
  createBlogDraft,
  getBlogPost,
  listBlogPosts,
  publishBlogPost,
  updateBlogDraft,
  updateBlogMainImage,
  type BlogUpdate,
} from "../../../../lib/jarvis/blog";
import { validateImageFile } from "../../../../lib/jarvis/image";

function safeError(context: string, error: unknown) {
  console.error(context, {
    name: error && typeof error === "object" && "name" in error ? String(error.name) : "Error",
    message: error && typeof error === "object" && "message" in error ? String(error.message) : "Unknown error",
  });
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  try {
    if (slug) {
      const post = await getBlogPost(slug);
      return post
        ? NextResponse.json({ post })
        : NextResponse.json({ error: "No se encontró el borrador." }, { status: 404 });
    }
    return NextResponse.json({ posts: await listBlogPosts() });
  } catch (error) {
    safeError("No se pudo consultar el Blog:", error);
    return NextResponse.json(
      { error: "No se pudo cargar el Blog en este momento." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const mode = formData.get("mode");
  const rawPost = formData.get("post");
  const rawChanges = formData.get("changes");
  const slug = formData.get("slug");
  const file = formData.get("image");
  const confirmation = formData.get("confirmation");

  try {
    if (mode === "create" && typeof rawPost === "string") {
      const created = await createBlogDraft(JSON.parse(rawPost) as unknown);
      return NextResponse.json({ created, posts: await listBlogPosts() });
    }

    if (
      mode === "publish" &&
      typeof slug === "string" &&
      slug.trim() &&
      confirmation === `publish:${slug.trim()}`
    ) {
      const published = await publishBlogPost(slug.trim());
      return NextResponse.json({
        published,
        post: await getBlogPost(published.slug),
        posts: await listBlogPosts(),
      });
    }

    if (mode === "publish") {
      return NextResponse.json(
        { error: "La publicación requiere confirmación explícita." },
        { status: 400 },
      );
    }

    if (mode !== "update" || typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    }

    let post = null;
    if (typeof rawChanges === "string") {
      const changes = JSON.parse(rawChanges) as unknown;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        return NextResponse.json({ error: "Los cambios no son válidos." }, { status: 400 });
      }
      const allowed = new Set([
        "title",
        "slug",
        "excerpt",
        "content",
        "seoTitle",
        "seoDescription",
      ]);
      if (Object.keys(changes).some((key) => !allowed.has(key))) {
        return NextResponse.json({ error: "Los cambios no son válidos." }, { status: 400 });
      }
      if (Object.keys(changes).length > 0) {
        post = await updateBlogDraft(slug, changes as BlogUpdate);
      }
    }

    if (file instanceof File && file.size > 0) {
      const image = await validateImageFile(file);
      if (!image) {
        return NextResponse.json(
          { error: "La imagen no es válida. Usa JPG, PNG o WEBP de hasta 5 MB." },
          { status: 400 },
        );
      }
      post = await updateBlogMainImage(post?.slug ?? slug, image);
    }

    if (!post) {
      return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });
    }
    return NextResponse.json({ post, posts: await listBlogPosts() });
  } catch (error) {
    safeError("No se pudo guardar el borrador del Blog:", error);
    return NextResponse.json(
      {
        error:
          mode === "publish"
            ? "No se pudo publicar el artículo en este momento."
            : "No se pudo guardar el borrador en este momento.",
      },
      { status: 502 },
    );
  }
}
