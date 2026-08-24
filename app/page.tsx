import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { client, HOME_PAGE_CACHE_TAG } from "../sanity/lib/client";
import { urlForImage } from "../sanity/lib/image";

export const dynamic = "force-dynamic";

type HomePageContent = {
  heroTitle: string;
  heroDescription: string;
  heroButtonText: string;
  heroImage?: object;
};

const fallbackContent: HomePageContent = {
  heroTitle: "Una web preparada para evolucionar contigo.",
  heroDescription:
    "Esta es la base de JARVIS WEB LAB: una experiencia sencilla, rápida y lista para incorporar nuevas capacidades paso a paso.",
  heroButtonText: "Conocer el proyecto",
};

const homePageQuery = `*[_type == "homePage" && _id == "homePage"][0]{
  heroTitle,
  heroDescription,
  heroButtonText,
  heroImage
}`;

const getCachedHomePageContent = unstable_cache(
  async () => {
    if (!client) {
      throw new Error("El cliente de Sanity no está configurado.");
    }

    const content = await client.fetch<HomePageContent | null>(
      homePageQuery,
      {},
      {
        cache: "no-store",
        perspective: "published",
      },
    );

    if (!content) {
      throw new Error("No se encontró el documento publicado homePage.");
    }

    return content;
  },
  ["sanity-home-page"],
  {
    revalidate: 60,
    tags: [HOME_PAGE_CACHE_TAG],
  },
);

async function getHomePageContent() {
  if (!client) return fallbackContent;

  try {
    return await getCachedHomePageContent();
  } catch (error) {
    console.error("No se pudo cargar el contenido de Sanity:", error);
    throw error;
  }
}

export default async function Home() {
  const content = await getHomePageContent();
  const heroImageUrl = content.heroImage
    ? urlForImage(content.heroImage)
    : undefined;

  return (
    <main>
      <header className="site-header">
        <a className="logo" href="#inicio" aria-label="JARVIS LAB, volver al inicio">
          JARVIS LAB
        </a>
        <Link className="header-link" href="/blog">Blog</Link>
      </header>

      <section className="hero" id="inicio">
        {heroImageUrl && (
          <div className="hero-image" aria-hidden="true">
            <Image
              src={heroImageUrl}
              alt=""
              fill
              priority
              sizes="(max-width: 720px) 100vw, 45vw"
            />
          </div>
        )}
        <div className="hero-content">
          <p className="eyebrow">Experimento web · Fase 3</p>
          <h1>{content.heroTitle}</h1>
          <p className="hero-description">{content.heroDescription}</p>
          <a className="primary-button" href="#proyecto">
            {content.heroButtonText}
          </a>
        </div>
      </section>

      <section className="project-section" id="proyecto">
        <div>
          <p className="section-number">01</p>
          <h2>Primero, una base sólida.</h2>
        </div>
        <p>
          Empezamos con una landing limpia y funcional. En las próximas fases,
          esta base podrá responder a instrucciones en lenguaje natural.
        </p>
      </section>
    </main>
  );
}
