import Image from "next/image";
import type { HomeSection } from "../../lib/jarvis/sections";
import { urlForImage } from "../../sanity/lib/image";

function FeatureGrid3({ section }: { section: HomeSection }) {
  if (!section.items || section.items.length !== 3) return null;
  return (
    <section className="dynamic-section feature-grid-section">
      <div className="dynamic-section-heading">
        <p className="eyebrow">Tres beneficios</p>
        <h2>{section.heading}</h2>
        {section.description && <p>{section.description}</p>}
      </div>
      <div className="feature-grid">
        {section.items.map((item, index) => (
          <article key={item._key ?? `${section._key}-${index}`}>
            <span>0{index + 1}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ImageText({ section }: { section: HomeSection }) {
  const imageUrl = section.image ? urlForImage(section.image) : undefined;
  return (
    <section className={`dynamic-section image-text-section image-${section.imagePosition === "right" ? "right" : "left"}`}>
      {imageUrl ? (
        <div className="section-image">
          <Image src={imageUrl} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" />
        </div>
      ) : (
        <div className="section-image section-image-empty" aria-hidden="true"><span>JARVIS LAB</span></div>
      )}
      <div className="image-text-copy">
        <p className="eyebrow">Historia</p>
        <h2>{section.heading}</h2>
        <p>{section.text}</p>
      </div>
    </section>
  );
}

function CTA({ section }: { section: HomeSection }) {
  if (!section.buttonText || !section.buttonUrl) return null;
  return (
    <section className="dynamic-section cta-section">
      <div>
        <p className="eyebrow">Siguiente paso</p>
        <h2>{section.heading}</h2>
        <p>{section.text}</p>
      </div>
      <a className="primary-button" href={section.buttonUrl}>{section.buttonText}</a>
    </section>
  );
}

export default function HomeSections({ sections }: { sections?: HomeSection[] }) {
  if (!Array.isArray(sections)) return null;
  return sections.map((section) => {
    if (!section || section.isVisible === false || !section._key) return null;
    switch (section._type) {
      case "featureGrid3": return <FeatureGrid3 key={section._key} section={section} />;
      case "imageText": return <ImageText key={section._key} section={section} />;
      case "cta": return <CTA key={section._key} section={section} />;
      default: return null;
    }
  });
}
