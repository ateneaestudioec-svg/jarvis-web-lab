import { NextResponse } from "next/server";
import {
  addHomeSection,
  deleteHomeSection,
  listHomeSections,
  moveHomeSection,
  setHomeSectionVisibility,
} from "../../../../lib/jarvis/sections";

export async function GET() {
  try {
    return NextResponse.json({ sections: await listHomeSections() });
  } catch (error) {
    console.error("No se pudieron consultar las secciones:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "No se pudieron cargar las secciones." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const input = body as Record<string, unknown>;

  try {
    if (input.action === "add") await addHomeSection(input.section);
    else if (input.action === "move" && typeof input.sectionKey === "string" && typeof input.position === "number") await moveHomeSection(input.sectionKey, input.position);
    else if (input.action === "visibility" && typeof input.sectionKey === "string" && typeof input.isVisible === "boolean") await setHomeSectionVisibility(input.sectionKey, input.isVisible);
    else if (input.action === "delete" && typeof input.sectionKey === "string" && input.confirmation === `delete:${input.sectionKey}`) await deleteHomeSection(input.sectionKey);
    else return NextResponse.json({ error: "Acción no permitida." }, { status: 400 });
    return NextResponse.json({ sections: await listHomeSections() });
  } catch (error) {
    console.error("No se pudo modificar una sección:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "No se pudo actualizar la sección." }, { status: 502 });
  }
}
