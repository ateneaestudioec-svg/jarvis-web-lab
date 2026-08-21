"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./jarvis.module.css";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type HomeContent = {
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

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Hola. Soy JARVIS, el administrador inteligente de este sitio. Puedo ayudarte a revisar, mejorar y actualizar el contenido de la Home.",
  },
];

const quickSuggestions = [
  "¿Qué puedo editar?",
  "Revisa mi Hero",
  "Mejora el título",
  "Cambiar imagen",
];

async function readJsonResponse<T>(response: Response): Promise<T> {
  const rawResponse = await response.text();
  try {
    return JSON.parse(rawResponse) as T;
  } catch {
    console.error("Respuesta no JSON de /api/jarvis:", {
      status: response.status,
      contentType: response.headers.get("content-type"),
      preview: rawResponse.slice(0, 300),
    });
    throw new Error("El servidor de JARVIS no devolvió una respuesta válida.");
  }
}

export default function JarvisPage() {
  const [messages, setMessages] = useState(initialMessages);
  const [instruction, setInstruction] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatImage, setChatImage] = useState<File | null>(null);
  const [content, setContent] = useState<HomeContent | null>(null);
  const [draft, setDraft] = useState<HomeContent | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manualImage, setManualImage] = useState<File | null>(null);
  const [manualPreview, setManualPreview] = useState<string | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);
  const manualPreviewRef = useRef<string | null>(null);
  const nextMessageId = useRef(2);

  const refreshContent = useCallback(async () => {
    const response = await fetch("/api/jarvis", { cache: "no-store" });
    const data = await readJsonResponse<{ content?: HomeContent; error?: string }>(
      response,
    );
    if (!response.ok || !data.content) {
      throw new Error(data.error ?? "No se pudo cargar la Home.");
    }
    setContent(data.content);
    setDraft(data.content);
    return data.content;
  }, []);

  useEffect(() => {
    let active = true;
    const loadTimer = window.setTimeout(() => {
      void refreshContent()
        .catch((error) => {
          if (active) {
            console.error("No se pudo cargar el panel de contenido:", error);
            setSaveError("No se pudo cargar el contenido actual de la Home.");
          }
        })
        .finally(() => {
          if (active) setIsContentLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      if (manualPreviewRef.current) URL.revokeObjectURL(manualPreviewRef.current);
    };
  }, [refreshContent]);

  const hasTextChanges = Boolean(
    content &&
      draft &&
      (content.heroTitle !== draft.heroTitle ||
        content.heroDescription !== draft.heroDescription ||
        content.heroButtonText !== draft.heroButtonText),
  );
  const hasChanges = hasTextChanges || Boolean(manualImage);

  function updateDraft(field: keyof Pick<HomeContent, "heroTitle" | "heroDescription" | "heroButtonText">, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setSaveState("idle");
    setSaveError(null);
  }

  function selectManualImage(file: File | null) {
    if (manualPreviewRef.current) URL.revokeObjectURL(manualPreviewRef.current);
    const preview = file ? URL.createObjectURL(file) : null;
    manualPreviewRef.current = preview;
    setManualPreview(preview);
    setManualImage(file);
    setSaveState("idle");
    setSaveError(null);
  }

  async function saveChanges() {
    if (!content || !draft || !hasChanges || isSaving) return;
    setIsSaving(true);
    setSaveState("idle");
    setSaveError(null);

    const changes: Record<string, string> = {};
    if (draft.heroTitle !== content.heroTitle) changes.heroTitle = draft.heroTitle;
    if (draft.heroDescription !== content.heroDescription) {
      changes.heroDescription = draft.heroDescription;
    }
    if (draft.heroButtonText !== content.heroButtonText) {
      changes.heroButtonText = draft.heroButtonText;
    }

    const formData = new FormData();
    formData.set("mode", "manual");
    formData.set("changes", JSON.stringify(changes));
    if (manualImage) formData.set("image", manualImage);

    try {
      const response = await fetch("/api/jarvis", { method: "POST", body: formData });
      const data = await readJsonResponse<{ content?: HomeContent; error?: string }>(
        response,
      );
      if (!response.ok || !data.content) {
        throw new Error(data.error ?? "No se pudieron guardar los cambios.");
      }
      setContent(data.content);
      setDraft(data.content);
      selectManualImage(null);
      if (manualFileInputRef.current) manualFileInputRef.current.value = "";
      setSaveState("saved");
    } catch (error) {
      console.error("Error técnico al guardar el contenido:", error);
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "No se pudieron guardar los cambios.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function sendInstruction(rawInstruction: string) {
    const messageContent = rawInstruction.trim();
    if (!messageContent || isLoading) return;

    const conversation = [
      ...messages,
      { id: nextMessageId.current++, role: "user" as const, content: messageContent },
    ];
    setMessages(conversation);
    setInstruction("");
    setChatError(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set(
        "messages",
        JSON.stringify(conversation.map(({ role, content: text }) => ({ role, content: text }))),
      );
      if (chatImage) formData.set("image", chatImage);

      const response = await fetch("/api/jarvis", { method: "POST", body: formData });
      const data = await readJsonResponse<{
        reply?: string;
        error?: string;
        contentChanged?: boolean;
      }>(response);
      if (!response.ok || !data.reply) throw new Error(data.error ?? "JARVIS no pudo responder.");

      setMessages((current) => [
        ...current,
        { id: nextMessageId.current++, role: "assistant", content: data.reply! },
      ]);
      setChatImage(null);
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";

      if (data.contentChanged) {
        try {
          await refreshContent();
          setSaveState("idle");
          selectManualImage(null);
        } catch (syncError) {
          console.error("No se pudo sincronizar el panel después de JARVIS:", syncError);
        }
      }
    } catch (error) {
      console.error("Error técnico al conversar con JARVIS:", error);
      setChatError(error instanceof Error ? error.message : "JARVIS no pudo responder.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendInstruction(instruction);
  }

  const statusText = isSaving
    ? "Guardando..."
    : hasChanges
      ? "Cambios sin guardar"
      : saveState === "saved"
        ? "✓ Cambios guardados"
        : "Sin cambios";
  const previewUrl = manualPreview ?? content?.heroImage.url;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/">JARVIS LAB</Link>
        <span>CMS visual + copiloto IA</span>
      </header>

      <div className={styles.workspace}>
        <section className={styles.contentPanel} aria-labelledby="content-title">
          <div className={styles.panelHeading}>
            <div>
              <p>Contenido</p>
              <h1 id="content-title">Home</h1>
            </div>
            <span className={hasChanges ? styles.unsaved : styles.saved}>{statusText}</span>
          </div>

          {isContentLoading || !draft ? (
            <p className={styles.loading}>Cargando contenido actual...</p>
          ) : (
            <div className={styles.editorCard}>
              <div className={styles.sectionHeading}>
                <span>01</span>
                <h2>Hero</h2>
              </div>

              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label htmlFor="hero-title">Título del Hero</label>
                  <button
                    type="button"
                    onClick={() => void sendInstruction("Quiero mejorar el título actual del Hero. Consulta la Home, analízalo y propónme tres alternativas, pero no cambies nada todavía.")}
                    disabled={isLoading}
                  >
                    ✨ Mejorar con Jarvis
                  </button>
                </div>
                <input
                  id="hero-title"
                  value={draft.heroTitle}
                  maxLength={150}
                  onChange={(event) => updateDraft("heroTitle", event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label htmlFor="hero-description">Descripción del Hero</label>
                  <button
                    type="button"
                    onClick={() => void sendInstruction("Quiero mejorar la descripción actual del Hero. Consulta la Home, analízala y propónme tres alternativas, pero no cambies nada todavía.")}
                    disabled={isLoading}
                  >
                    ✨ Mejorar con Jarvis
                  </button>
                </div>
                <textarea
                  id="hero-description"
                  value={draft.heroDescription}
                  maxLength={500}
                  rows={5}
                  onChange={(event) => updateDraft("heroDescription", event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="hero-button">Texto del botón</label>
                <input
                  id="hero-button"
                  value={draft.heroButtonText}
                  maxLength={60}
                  onChange={(event) => updateDraft("heroButtonText", event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label>Imagen del Hero</label>
                <div className={styles.imagePreview}>
                  {previewUrl ? (
                    <Image
                      src={previewUrl}
                      alt="Vista previa de la imagen del Hero"
                      fill
                      sizes="(max-width: 900px) 100vw, 45vw"
                      unoptimized={Boolean(manualPreview)}
                    />
                  ) : (
                    <span>Sin imagen configurada</span>
                  )}
                </div>
                <div className={styles.imageActions}>
                  <label htmlFor="manual-hero-image">Cambiar imagen</label>
                  <input
                    ref={manualFileInputRef}
                    id="manual-hero-image"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    onChange={(event) => selectManualImage(event.target.files?.[0] ?? null)}
                  />
                  <span>{manualImage?.name ?? content?.heroImage.filename ?? "JPG, PNG o WEBP"}</span>
                </div>
              </div>

              {saveError && <p className={styles.formError} role="alert">{saveError}</p>}
              <button
                className={styles.saveButton}
                type="button"
                disabled={!hasChanges || isSaving}
                onClick={() => void saveChanges()}
              >
                {isSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          )}
        </section>

        <section className={styles.jarvisPanel} aria-labelledby="jarvis-title">
          <div className={styles.jarvisHeading}>
            <div>
              <p>Copiloto de contenido</p>
              <h2 id="jarvis-title">JARVIS</h2>
            </div>
            <span><i aria-hidden="true" /> En línea</span>
          </div>

          <div className={styles.conversation} aria-live="polite">
            {messages.map((message) => (
              <article
                className={`${styles.message} ${message.role === "user" ? styles.userMessage : ""}`}
                key={message.id}
              >
                <p className={styles.author}>{message.role === "user" ? "Usuario" : "Jarvis"}</p>
                <p className={styles.messageText}>{message.content}</p>
              </article>
            ))}
            {isLoading && <p className={styles.thinking}>Jarvis está trabajando...</p>}
            {chatError && <p className={styles.formError} role="alert">{chatError}</p>}
          </div>

          <form className={styles.composer} onSubmit={handleSubmit}>
            <div className={styles.suggestions} aria-label="Sugerencias rápidas">
              {quickSuggestions.map((suggestion) => (
                <button type="button" key={suggestion} disabled={isLoading} onClick={() => void sendInstruction(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
            <div className={styles.chatAttachment}>
              <label htmlFor="jarvis-image">Adjuntar imagen</label>
              <input
                ref={chatFileInputRef}
                id="jarvis-image"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                disabled={isLoading}
                onChange={(event) => setChatImage(event.target.files?.[0] ?? null)}
              />
              {chatImage && <span>{chatImage.name}</span>}
            </div>
            <div className={styles.messageInput}>
              <label className={styles.srOnly} htmlFor="jarvis-instruction">Escribe una instrucción para Jarvis</label>
              <input
                id="jarvis-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Pregunta o pide un cambio..."
                maxLength={4000}
                disabled={isLoading}
              />
              <button type="submit" disabled={!instruction.trim() || isLoading}>Enviar</button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
