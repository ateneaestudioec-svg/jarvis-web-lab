"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import styles from "./jarvis.module.css";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

const initialMessages: Message[] = [
  { id: 1, role: "user", content: "Cambia el título principal." },
  {
    id: 2,
    role: "assistant",
    content: "Aún no tengo permisos para hacerlo.",
  },
];

export default function JarvisPage() {
  const [messages, setMessages] = useState(initialMessages);
  const [instruction, setInstruction] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = instruction.trim();
    if (!content || isLoading) return;

    const conversation = [
      ...messages,
      { id: Date.now(), role: "user" as const, content },
    ];
    setMessages(conversation);
    setInstruction("");
    setError(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set(
        "messages",
        JSON.stringify(
          conversation.map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        ),
      );
      if (image) formData.set("image", image);

      const response = await fetch("/api/jarvis", {
        method: "POST",
        body: formData,
      });
      const rawResponse = await response.text();
      let data: { reply?: string; error?: string };

      try {
        data = JSON.parse(rawResponse) as {
          reply?: string;
          error?: string;
        };
      } catch {
        console.error("Respuesta no JSON de /api/jarvis:", {
          status: response.status,
          contentType: response.headers.get("content-type"),
          preview: rawResponse.slice(0, 300),
        });
        throw new Error(
          "El servidor de JARVIS no devolvió una respuesta válida.",
        );
      }

      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? "JARVIS no pudo responder.");
      }

      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: "assistant", content: data.reply! },
      ]);
      setImage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (requestError) {
      console.error("Error técnico al conversar con JARVIS:", requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "JARVIS no pudo responder.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.assistant} aria-labelledby="jarvis-title">
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            JARVIS LAB
          </Link>
          <div className={styles.status}>
            <span aria-hidden="true" />
            Asistente conectado
          </div>
        </header>

        <div className={styles.intro}>
          <p>Asistente experimental</p>
          <h1 id="jarvis-title">JARVIS</h1>
          <h2>¿Qué quieres cambiar hoy?</h2>
        </div>

        <div className={styles.conversation} aria-live="polite">
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <article
                className={`${styles.message} ${
                  isUser ? styles.userMessage : ""
                }`}
                key={message.id}
              >
                <p className={styles.author}>{isUser ? "Usuario" : "Jarvis"}</p>
                <p className={styles.messageText}>{message.content}</p>
              </article>
            );
          })}
          {isLoading && (
            <p className={styles.thinking} role="status">
              Jarvis está pensando…
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <form className={styles.composer} onSubmit={handleSubmit}>
          <div className={styles.attachmentRow}>
            <label className={styles.attachmentButton} htmlFor="jarvis-image">
              Adjuntar imagen
            </label>
            <input
              ref={fileInputRef}
              className={styles.fileInput}
              id="jarvis-image"
              name="image"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              disabled={isLoading}
              onChange={(event) => setImage(event.target.files?.[0] ?? null)}
            />
            {image && (
              <span className={styles.attachmentName} title={image.name}>
                Imagen adjunta: {image.name}
              </span>
            )}
          </div>
          <label className={styles.srOnly} htmlFor="jarvis-instruction">
            Escribe una instrucción para Jarvis
          </label>
          <input
            id="jarvis-instruction"
            name="instruction"
            type="text"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Escribe una instrucción..."
            autoComplete="off"
            maxLength={4000}
            disabled={isLoading}
          />
          <button type="submit" disabled={!instruction.trim() || isLoading}>
            {isLoading ? "Enviando…" : "Enviar"}
          </button>
        </form>
      </section>
    </main>
  );
}
