import type { ReactNode } from "react";
import type { PublicPortableBlock } from "../../lib/jarvis/blog";

function renderSpan(
  span: NonNullable<PublicPortableBlock["children"]>[number],
  block: PublicPortableBlock,
) {
  let content: ReactNode = span.text;
  for (const mark of span.marks ?? []) {
    if (mark === "strong") content = <strong>{content}</strong>;
    else if (mark === "em") content = <em>{content}</em>;
    else {
      const definition = block.markDefs?.find((item) => item._key === mark);
      const href = definition?.href;
      const safeHref = href && (/^https?:\/\//i.test(href) || href.startsWith("/") || href.startsWith("mailto:"));
      if (safeHref) {
        content = <a href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{content}</a>;
      }
    }
  }
  return <span key={span._key}>{content}</span>;
}

function blockContent(block: PublicPortableBlock) {
  return block.children?.map((span) => renderSpan(span, block));
}

export function PortableText({ value }: { value: PublicPortableBlock[] }) {
  const output: ReactNode[] = [];
  let index = 0;

  while (index < value.length) {
    const block = value[index];
    if (block.listItem) {
      const listType = block.listItem;
      const items: ReactNode[] = [];
      while (index < value.length && value[index].listItem === listType) {
        items.push(<li key={value[index]._key}>{blockContent(value[index])}</li>);
        index += 1;
      }
      output.push(
        listType === "number"
          ? <ol key={`list-${block._key}`}>{items}</ol>
          : <ul key={`list-${block._key}`}>{items}</ul>,
      );
      continue;
    }

    const children = blockContent(block);
    if (block.style === "h2") output.push(<h2 key={block._key}>{children}</h2>);
    else if (block.style === "h3") output.push(<h3 key={block._key}>{children}</h3>);
    else output.push(<p key={block._key}>{children}</p>);
    index += 1;
  }

  return <>{output}</>;
}
