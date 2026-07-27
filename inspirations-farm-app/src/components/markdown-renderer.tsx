"use client";

import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown-config";
import { MermaidDiagram } from "./mermaid-diagram";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const components: Components = {
    // Custom code block rendering
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1];

      // Check if it's inline code (no language class usually means inline)
      const isInline = !className;

      // Mermaid diagrams
      if (language === "mermaid") {
        return <MermaidDiagram chart={String(children).trim()} />;
      }

      // Code blocks (with highlighting)
      if (!isInline && className) {
        return (
          <pre className={className}>
            <code {...props}>{children}</code>
          </pre>
        );
      }

      // Inline code
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins as any}
        rehypePlugins={rehypePlugins as any}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
