"use client";

import { useCallback, useEffect, useState } from "react";
import type { HomeSection, SectionType } from "../../lib/jarvis/sections";
import styles from "./jarvis.module.css";

const labels: Record<SectionType, string> = { featureGrid3: "Tres tarjetas", imageText: "Imagen + texto", cta: "CTA" };

function starterSection(type: SectionType) {
  if (type === "featureGrid3") return { type, position: "end", content: { heading: "Todo lo que necesitas", description: "Tres beneficios que hacen la diferencia.", items: [{ title: "Rapidez", text: "Avanza sin fricción." }, { title: "Seguridad", text: "Trabaja con confianza." }, { title: "Soporte", text: "Acompañamiento cuando lo necesitas." }] } };
  if (type === "imageText") return { type, position: "end", content: { heading: "Una historia que merece contarse", text: "Explica aquí el valor, la historia o el proceso de tu proyecto.", imagePosition: "left" } };
  return { type, position: "end", content: { heading: "¿Listo para empezar?", text: "Da el siguiente paso con JARVIS LAB.", buttonText: "Contáctanos", buttonUrl: "#inicio" } };
}

export default function SectionsManager({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/jarvis/sections", { cache: "no-store" });
    const data = await response.json() as { sections?: HomeSection[]; error?: string };
    if (!response.ok || !data.sections) throw new Error(data.error ?? "No se pudieron cargar las secciones.");
    setSections(data.sections);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudieron cargar las secciones."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshSignal]);

  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/jarvis/sections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { sections?: HomeSection[]; error?: string };
      if (!response.ok || !data.sections) throw new Error(data.error ?? "No se pudo actualizar la sección.");
      setSections(data.sections); setShowOptions(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar la sección."); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.sectionsManager}>
      <div className={styles.sectionsHeader}>
        <div><span>02</span><h2>Secciones</h2></div>
        <button type="button" disabled={busy} onClick={() => setShowOptions((value) => !value)}>+ Agregar sección</button>
      </div>
      {showOptions && <div className={styles.sectionOptions}>{(["featureGrid3", "imageText", "cta"] as SectionType[]).map((type) => <button key={type} type="button" disabled={busy} onClick={() => void mutate({ action: "add", section: starterSection(type) })}>{labels[type]}</button>)}</div>}
      {sections.length === 0 ? <p className={styles.emptySections}>Todavía no hay secciones dinámicas.</p> : <ol className={styles.sectionList}>
        {sections.map((section, index) => <li key={section._key}>
          <div><span>{String(index + 2).padStart(2, "0")}</span><div><strong>{labels[section._type]}</strong><p>{section.heading}</p></div></div>
          <span className={section.isVisible === false ? styles.hiddenSection : styles.visibleSection}>{section.isVisible === false ? "OCULTA" : "VISIBLE"}</span>
          <div className={styles.sectionActions}>
            <button type="button" disabled={busy || index === 0} onClick={() => void mutate({ action: "move", sectionKey: section._key, position: index - 1 })}>↑</button>
            <button type="button" disabled={busy || index === sections.length - 1} onClick={() => void mutate({ action: "move", sectionKey: section._key, position: index + 1 })}>↓</button>
            <button type="button" disabled={busy} onClick={() => void mutate({ action: "visibility", sectionKey: section._key, isVisible: section.isVisible === false })}>{section.isVisible === false ? "Mostrar" : "Ocultar"}</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar la sección “${section.heading}”? Esta acción quitará el bloque de la Home.`)) void mutate({ action: "delete", sectionKey: section._key, confirmation: `delete:${section._key}` }); }}>Eliminar</button>
          </div>
        </li>)}
      </ol>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </div>
  );
}
