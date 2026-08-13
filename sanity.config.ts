"use client";

import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { dataset, projectId } from "./sanity/env";
import { schemaTypes } from "./sanity/schemaTypes";

export default defineConfig({
  name: "jarvisWebLab",
  title: "JARVIS WEB LAB",
  basePath: "/studio",
  projectId: projectId ?? "missing-project-id",
  dataset,
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Contenido")
          .items([
            S.listItem()
              .title("Home Page")
              .child(
                S.document().schemaType("homePage").documentId("homePage"),
              ),
          ]),
    }),
  ],
  schema: { types: schemaTypes },
});
