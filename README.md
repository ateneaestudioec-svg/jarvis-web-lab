# JARVIS WEB LAB

Base del experimento JARVIS WEB LAB construida con Next.js, App Router y
TypeScript.

## Requisitos

- Node.js 20.9 o superior
- pnpm (recomendado) o npm

## Ejecutar en local

Instala las dependencias:

```bash
pnpm install
```

Inicia el servidor de desarrollo:

```bash
pnpm dev
```

Abre [http://localhost:3100](http://localhost:3100) en el navegador.

Si prefieres npm, puedes usar `npm install` y `npm run dev`.

## Comprobar el proyecto

```bash
pnpm lint
pnpm build
```

## Alcance actual

La landing obtiene el contenido del Hero desde Sanity CMS y mantiene textos de
respaldo mientras Sanity no esté configurado. No incorpora IA, autenticación ni
base de datos adicional.

## Configurar Sanity

1. Crea un proyecto en [sanity.io/manage](https://sanity.io/manage) con el
   dataset público `production`.
2. Copia `.env.example` como `.env.local`.
3. Sustituye `your_project_id` por el Project ID que aparece en Sanity Manage.
4. Ejecuta `pnpm dev` y abre [http://localhost:3100/studio](http://localhost:3100/studio).
5. Inicia sesión, abre **Home Page**, completa la imagen y pulsa **Publish**.

El archivo local debe quedar así:

```env
NEXT_PUBLIC_SANITY_PROJECT_ID=tu_project_id
NEXT_PUBLIC_SANITY_DATASET=production
NEXT_PUBLIC_SANITY_API_VERSION=2026-08-13
```

El Project ID y el dataset son identificadores públicos. Este MVP lee contenido
publicado y no necesita tokens privados.

## Configurar Vercel

En **Project Settings → Environment Variables**, agrega las mismas tres
variables anteriores para Production, Preview y Development. Después realiza
un redeploy.

En Sanity Manage, dentro de **API → CORS origins**, agrega:

- `http://localhost:3100`
- La URL de producción de Vercel, por ejemplo `https://jarvis-web-lab.vercel.app`

Activa **Allow credentials** para poder iniciar sesión en el Studio integrado.

## Configurar JARVIS con Gemini

La conversación usa el SDK oficial `@google/genai`, la Interactions API y el
modelo estable `gemini-3.5-flash` desde el endpoint servidor `/api/jarvis`. La
clave nunca se envía al navegador.

Agrega estas variables únicamente en `.env.local` y en las variables de entorno
de Vercel:

```env
GEMINI_API_KEY=tu_clave_de_gemini
```

No uses el prefijo `NEXT_PUBLIC_` para `GEMINI_API_KEY`. Después de configurar
la clave, reinicia el servidor local o realiza un nuevo deployment en Vercel.
