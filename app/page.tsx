export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="logo" href="#inicio" aria-label="JARVIS LAB, volver al inicio">
          JARVIS LAB
        </a>
      </header>

      <section className="hero" id="inicio">
        <p className="eyebrow">Experimento web · Fase 1</p>
        <h1>Una web preparada para evolucionar contigo.</h1>
        <p className="hero-description">
          Esta es la base de JARVIS WEB LAB: una experiencia sencilla, rápida y
          lista para incorporar nuevas capacidades paso a paso.
        </p>
        <a className="primary-button" href="#proyecto">
          Conocer el proyecto
        </a>
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
