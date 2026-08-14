import { NextStudio } from "next-sanity/studio";
import config from "../../../sanity.config";
import { hasSanityConfig } from "../../../sanity/env";

export const dynamic = "force-static";
export { metadata, viewport } from "next-sanity/studio";

export default function StudioPage() {
  if (!hasSanityConfig) {
    return (
      <main className="studio-setup">
        <h1>Falta conectar Sanity</h1>
        <p>
          Copia <code>.env.example</code> como <code>.env.local</code> y añade
          el ID de tu proyecto de Sanity.
        </p>
      </main>
    );
  }

  return <NextStudio config={config} />;
}
