"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./jarvis.module.css";

type BlogSection = { style: "normal" | "h2" | "h3"; text: string };
type BlogSummary = { title: string; slug: string; status: "draft" | "published"; publishedAt?: string };
type BlogPost = {
  title: string;
  slug: string;
  excerpt: string;
  content: BlogSection[];
  seoTitle: string;
  seoDescription: string;
  status: "draft" | "published";
  publishedAt?: string;
  mainImage: { configured: boolean; filename?: string; url?: string };
};

type Props = {
  isJarvisLoading: boolean;
  refreshSignal: number;
  onAskJarvis: (prompt: string) => void;
};

const emptyPost: BlogPost = {
  title: "",
  slug: "",
  excerpt: "",
  content: [{ style: "normal", text: "" }],
  seoTitle: "",
  seoDescription: "",
  status: "draft",
  mainImage: { configured: false },
};

function contentToText(content: BlogSection[]) {
  return content
    .map((section) => `${section.style === "h2" ? "## " : section.style === "h3" ? "### " : ""}${section.text}`)
    .join("\n\n");
}

function textToContent(value: string): BlogSection[] {
  return value
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) =>
      text.startsWith("### ")
        ? { style: "h3" as const, text: text.slice(4).trim() }
        : text.startsWith("## ")
          ? { style: "h2" as const, text: text.slice(3).trim() }
          : { style: "normal" as const, text },
    );
}

async function parseResponse<T>(response: Response) {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la solicitud.");
  return data;
}

export default function BlogManager({ isJarvisLoading, refreshSignal, onAskJarvis }: Props) {
  const [posts, setPosts] = useState<BlogSummary[]>([]);
  const [original, setOriginal] = useState<BlogPost | null>(null);
  const [draft, setDraft] = useState<BlogPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectedSlugRef = useRef<string | null>(null);
  const isNewRef = useRef(false);

  const loadPosts = useCallback(async () => {
    const response = await fetch("/api/jarvis/blog", { cache: "no-store" });
    const data = await parseResponse<{ posts: BlogSummary[] }>(response);
    setPosts(data.posts);
    return data.posts;
  }, []);

  const openPost = useCallback(async (slug: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/jarvis/blog?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = await parseResponse<{ post: BlogPost }>(response);
      setOriginal(data.post);
      setDraft(data.post);
      setIsNew(false);
      selectedSlugRef.current = data.post.slug;
      isNewRef.current = false;
      setNotice(null);
      setImage(null);
      setPreview(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la entrada.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPosts()
        .then((loaded) => {
          if (selectedSlugRef.current && !isNewRef.current) {
            return openPost(selectedSlugRef.current);
          }
          if (!selectedSlugRef.current && loaded[0]) return openPost(loaded[0].slug);
        })
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el Blog."))
        .finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshSignal, loadPosts, openPost]);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function update<K extends keyof BlogPost>(key: K, value: BlogPost[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice(null);
    setError(null);
  }

  function selectImage(file: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    previewRef.current = url;
    setPreview(url);
    setImage(file);
    setNotice(null);
  }

  function startNew() {
    setOriginal(null);
    setDraft(emptyPost);
    setIsNew(true);
    selectedSlugRef.current = null;
    isNewRef.current = true;
    setImage(null);
    setPreview(null);
    setNotice(null);
    setError(null);
  }

  const hasChanges = Boolean(draft && (isNew || image || JSON.stringify(draft) !== JSON.stringify(original)));

  async function save() {
    if (!draft || !hasChanges || isSaving) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      if (isNew) {
        formData.set("mode", "create");
        formData.set(
          "post",
          JSON.stringify({
            title: draft.title,
            slug: draft.slug,
            excerpt: draft.excerpt,
            content: draft.content,
            seoTitle: draft.seoTitle,
            seoDescription: draft.seoDescription,
          }),
        );
      } else if (original) {
        const changes: Record<string, unknown> = {};
        for (const key of ["title", "slug", "excerpt", "content", "seoTitle", "seoDescription"] as const) {
          if (JSON.stringify(draft[key]) !== JSON.stringify(original[key])) changes[key] = draft[key];
        }
        formData.set("mode", "update");
        formData.set("slug", original.slug);
        formData.set("changes", JSON.stringify(changes));
        if (image) formData.set("image", image);
      }

      const response = await fetch("/api/jarvis/blog", { method: "POST", body: formData });
      const data = await parseResponse<{
        created?: { slug: string };
        post?: BlogPost;
        posts: BlogSummary[];
      }>(response);
      setPosts(data.posts);
      const savedSlug = data.created?.slug ?? data.post?.slug;
      if (savedSlug) await openPost(savedSlug);
      setNotice("✓ Borrador guardado");
      selectImage(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el borrador.");
    } finally {
      setIsSaving(false);
    }
  }

  const previewUrl = preview ?? draft?.mainImage.url;

  return (
    <div className={styles.blogManager}>
      <div className={styles.blogToolbar}>
        <div><p>Blog</p><h1>Entradas</h1></div>
        <div>
          <button type="button" onClick={startNew}>+ Nueva entrada</button>
          <button type="button" onClick={() => onAskJarvis("Quiero crear una nueva entrada de Blog con tu ayuda. Pregúntame solo los detalles imprescindibles antes de crear el borrador.")} disabled={isJarvisLoading}>✨ Crear con Jarvis</button>
        </div>
      </div>

      <div className={styles.blogLayout}>
        <aside className={styles.postList} aria-label="Entradas de Blog">
          {posts.length === 0 && <p>Aún no hay entradas.</p>}
          {posts.map((post) => (
            <button type="button" key={`${post.status}-${post.slug}`} className={draft?.slug === post.slug && !isNew ? styles.activePost : ""} onClick={() => void openPost(post.slug)}>
              <strong>{post.title}</strong>
              <span>{post.status === "draft" ? "Borrador" : "Publicado"}{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString("es")}` : ""}</span>
            </button>
          ))}
        </aside>

        <div className={styles.blogEditor}>
          {isLoading && !draft ? <p className={styles.loading}>Cargando entradas...</p> : draft ? (
            <>
              <div className={styles.blogEditorHeader}>
                <span>{isNew ? "Nuevo borrador" : "Editando borrador"}</span>
                <span>{hasChanges ? "Cambios sin guardar" : notice ?? "Sin cambios"}</span>
              </div>

              <div className={styles.field}>
                <div className={styles.fieldHeader}><label htmlFor="blog-title">Título</label><button type="button" disabled={isJarvisLoading || isNew} onClick={() => onAskJarvis(`Consulta el borrador con slug “${draft.slug}” y propónme tres títulos mejores. No cambies nada todavía.`)}>✨ Mejorar título</button></div>
                <input id="blog-title" value={draft.title} maxLength={150} onChange={(event) => update("title", event.target.value)} />
              </div>
              <div className={styles.field}><label htmlFor="blog-slug">Slug</label><input id="blog-slug" value={draft.slug} maxLength={96} onChange={(event) => update("slug", event.target.value)} /></div>
              <div className={styles.field}>
                <div className={styles.fieldHeader}><label htmlFor="blog-excerpt">Extracto</label><button type="button" disabled={isJarvisLoading || isNew} onClick={() => onAskJarvis(`Consulta el borrador “${draft.slug}” y propónme tres extractos mejores. No cambies nada todavía.`)}>✨ Mejorar extracto</button></div>
                <textarea id="blog-excerpt" rows={3} value={draft.excerpt} maxLength={300} onChange={(event) => update("excerpt", event.target.value)} />
              </div>
              <div className={styles.field}>
                <div className={styles.fieldHeader}><label htmlFor="blog-content">Contenido</label><button type="button" disabled={isJarvisLoading || isNew} onClick={() => onAskJarvis(`Consulta el borrador “${draft.slug}” y revisa su contenido. Propón mejoras concretas sin modificarlo todavía.`)}>✨ Mejorar contenido</button></div>
                <textarea id="blog-content" rows={14} value={contentToText(draft.content)} onChange={(event) => update("content", textToContent(event.target.value))} />
                <small>Usa ## para subtítulos y ### para subtítulos secundarios.</small>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldHeader}><label htmlFor="blog-seo-title">SEO title</label><button type="button" disabled={isJarvisLoading || isNew} onClick={() => onAskJarvis(`Consulta el borrador “${draft.slug}” y revisa su SEO title y meta description. Propón mejoras sin cambiar nada todavía.`)}>✨ Revisar SEO</button></div>
                <input id="blog-seo-title" value={draft.seoTitle} maxLength={70} onChange={(event) => update("seoTitle", event.target.value)} />
              </div>
              <div className={styles.field}><label htmlFor="blog-seo-description">SEO description</label><textarea id="blog-seo-description" rows={3} value={draft.seoDescription} maxLength={170} onChange={(event) => update("seoDescription", event.target.value)} /></div>
              {!isNew && <div className={styles.field}><label>Imagen principal</label><div className={styles.imagePreview}>{previewUrl ? <Image src={previewUrl} alt="Vista previa de la entrada" fill sizes="480px" unoptimized={Boolean(preview)} /> : <span>Sin imagen</span>}</div><div className={styles.imageActions}><label htmlFor="blog-image">Cambiar imagen</label><input ref={imageInputRef} id="blog-image" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0] ?? null)} /><span>{image?.name ?? draft.mainImage.filename ?? "JPG, PNG o WEBP"}</span></div></div>}
              {error && <p className={styles.formError}>{error}</p>}
              <button className={styles.saveButton} type="button" disabled={!hasChanges || isSaving} onClick={() => void save()}>{isSaving ? "Guardando..." : isNew ? "Crear borrador" : "Guardar cambios"}</button>
            </>
          ) : <p className={styles.loading}>Selecciona una entrada o crea un borrador.</p>}
        </div>
      </div>
    </div>
  );
}
