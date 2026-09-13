"use client";

import { isValidElement, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-config";
import { transformWikilinkImages } from "@/lib/markdown-utils";
import { MermaidDiagram } from "./mermaid-diagram";
import { ProxiedImage } from "./proxied-image";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // Obsidian image embeds (![[file.png]]) aren't standard Markdown — rewrite
  // them to proxied standard images before parsing (code-safe, idempotent).
  const transformed = useMemo(() => transformWikilinkImages(content), [content]);

  const components: Components = {
    // Custom code block rendering
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1];

      // Mermaid diagrams
      if (language === "mermaid") {
        return <MermaidDiagram chart={String(children).trim()} />;
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children, ...props }) {
      if (isValidElement(children) && children.type === MermaidDiagram) {
        return children;
      }
      return <pre {...props}>{children}</pre>;
    },
    // Attachment images need header auth → fetched as blobs by the component
    img: ProxiedImage,
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
