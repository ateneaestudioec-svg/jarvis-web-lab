import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { BLOG_CACHE_TAG, listPublishedBlogPosts } from "../../lib/jarvis/blog";
import styles from "./blog.module.css";

export const dynamic = "force-dynamic";

const getPosts = unstable_cache(listPublishedBlogPosts, ["published-blog-posts"], {
  revalidate: 60,
  tags: [BLOG_CACHE_TAG],
});

export default async function BlogPage() {
  const posts = await getPosts();
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.logo} href="/">JARVIS LAB</Link><nav><Link href="/">Home</Link><Link href="/jarvis">JARVIS</Link></nav></header>
    <section className={styles.intro}><p className={styles.eyebrow}>Ideas · tecnología · experimentos</p><h1>Blog</h1><p>Contenido sobre inteligencia artificial, diseño y nuevas formas de construir para la web.</p></section>
    {posts.length ? <section className={styles.grid}>{posts.map((post) => <article className={styles.card} key={post.slug}>
      {post.mainImage?.url && <div className={styles.cardImage}><Image src={post.mainImage.url} alt={post.mainImage.alt ?? post.title} fill sizes="(max-width: 700px) 100vw, 50vw" /></div>}
      <div className={styles.cardBody}>{post.publishedAt && <time className={styles.date} dateTime={post.publishedAt}>{new Intl.DateTimeFormat("es-EC", { dateStyle: "long" }).format(new Date(post.publishedAt))}</time>}<h2>{post.title}</h2><p>{post.excerpt}</p><Link className={styles.readMore} href={`/blog/${post.slug}`}>Leer artículo →</Link></div>
    </article>)}</section> : <p className={styles.empty}>Todavía no hay artículos publicados.</p>}
  </main>;
}
