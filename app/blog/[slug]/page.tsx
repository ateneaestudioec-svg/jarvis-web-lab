import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { BLOG_CACHE_TAG, getPublishedBlogPost } from "../../../lib/jarvis/blog";
import { PortableText } from "../PortableText";
import styles from "../blog.module.css";

export const dynamic = "force-dynamic";

async function getPost(slug: string) {
  return unstable_cache(
    () => getPublishedBlogPost(slug),
    ["published-blog-post", slug],
    { revalidate: 60, tags: [BLOG_CACHE_TAG] },
  )();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      images: post.mainImage?.url ? [{ url: post.mainImage.url }] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.logo} href="/">JARVIS LAB</Link><nav><Link href="/blog">Blog</Link><Link href="/jarvis">JARVIS</Link></nav></header>
    <article>
      <div className={styles.article}><p className={styles.eyebrow}>Blog de JARVIS LAB</p>{post.publishedAt && <time className={styles.date} dateTime={post.publishedAt}>{new Intl.DateTimeFormat("es-EC", { dateStyle: "long" }).format(new Date(post.publishedAt))}</time>}<h1>{post.title}</h1><p className={styles.excerpt}>{post.excerpt}</p></div>
      {post.mainImage?.url && <div className={styles.heroImage}><Image src={post.mainImage.url} alt={post.mainImage.alt ?? post.title} fill priority sizes="100vw" /></div>}
      <div className={styles.content}><PortableText value={post.content} /><Link className={styles.back} href="/blog">← Volver al Blog</Link></div>
    </article>
  </main>;
}
