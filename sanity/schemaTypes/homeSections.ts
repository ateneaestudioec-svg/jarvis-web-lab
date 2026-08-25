import { defineArrayMember, defineField, defineType } from "sanity";

const visibilityField = defineField({
  name: "isVisible",
  title: "Visible",
  type: "boolean",
  initialValue: true,
});

export const featureGrid3 = defineType({
  name: "featureGrid3",
  title: "Tres tarjetas",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Título", type: "string", validation: (rule) => rule.required().max(150) }),
    defineField({ name: "description", title: "Descripción", type: "text", rows: 3, validation: (rule) => rule.max(500) }),
    defineField({
      name: "items",
      title: "Tarjetas",
      type: "array",
      of: [defineArrayMember({
        name: "featureItem",
        type: "object",
        fields: [
          defineField({ name: "title", title: "Título", type: "string", validation: (rule) => rule.required().max(80) }),
          defineField({ name: "text", title: "Texto", type: "text", rows: 3, validation: (rule) => rule.required().max(300) }),
        ],
      })],
      validation: (rule) => rule.required().length(3),
    }),
    visibilityField,
  ],
  preview: { select: { title: "heading", visible: "isVisible" }, prepare: ({ title, visible }) => ({ title, subtitle: `Tres tarjetas · ${visible === false ? "Oculta" : "Visible"}` }) },
});

export const imageText = defineType({
  name: "imageText",
  title: "Imagen + texto",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Título", type: "string", validation: (rule) => rule.required().max(150) }),
    defineField({ name: "text", title: "Texto", type: "text", rows: 5, validation: (rule) => rule.required().max(1000) }),
    defineField({ name: "image", title: "Imagen", type: "image", options: { hotspot: true } }),
    defineField({ name: "imagePosition", title: "Posición de imagen", type: "string", options: { list: [{ title: "Izquierda", value: "left" }, { title: "Derecha", value: "right" }], layout: "radio" }, validation: (rule) => rule.required() }),
    visibilityField,
  ],
  preview: { select: { title: "heading", visible: "isVisible" }, prepare: ({ title, visible }) => ({ title, subtitle: `Imagen + texto · ${visible === false ? "Oculta" : "Visible"}` }) },
});

export const callToAction = defineType({
  name: "cta",
  title: "CTA",
  type: "object",
  fields: [
    defineField({ name: "heading", title: "Título", type: "string", validation: (rule) => rule.required().max(150) }),
    defineField({ name: "text", title: "Texto", type: "text", rows: 3, validation: (rule) => rule.required().max(500) }),
    defineField({ name: "buttonText", title: "Texto del botón", type: "string", validation: (rule) => rule.required().max(60) }),
    defineField({ name: "buttonUrl", title: "URL del botón", type: "string", validation: (rule) => rule.required().max(500) }),
    visibilityField,
  ],
  preview: { select: { title: "heading", visible: "isVisible" }, prepare: ({ title, visible }) => ({ title, subtitle: `CTA · ${visible === false ? "Oculta" : "Visible"}` }) },
});
