import { defineField, defineType } from "sanity";

export const homePage = defineType({
  name: "homePage",
  title: "Home Page",
  type: "document",
  initialValue: {
    heroTitle: "Una web preparada para evolucionar contigo.",
    heroDescription:
      "Esta es la base de JARVIS WEB LAB: una experiencia sencilla, rápida y lista para incorporar nuevas capacidades paso a paso.",
    heroButtonText: "Conocer el proyecto",
  },
  fields: [
    defineField({
      name: "heroTitle",
      title: "Título del Hero",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "heroDescription",
      title: "Descripción del Hero",
      type: "text",
      rows: 4,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "heroButtonText",
      title: "Texto del botón",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "heroImage",
      title: "Imagen del Hero",
      type: "image",
      options: { hotspot: true },
    }),
  ],
});
