"use client";

import { isValidElement } from "react";
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
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
