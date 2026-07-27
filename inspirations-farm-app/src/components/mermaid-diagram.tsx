"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if dark mode is enabled
    const isDark = document.documentElement.classList.contains("dark");

    // Initialize Mermaid
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "neutral",
      securityLevel: "strict",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    });

    // Render chart
    const render = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
        setError(null);
      } catch (err) {
        console.error("Mermaid render error:", err);
        setError("图表渲染失败");
      }
    };

    render();
  }, [chart]);

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
        ⚠️ {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 flex items-center justify-center rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
        <div className="text-xs text-slate-400">加载图表...</div>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram my-3 overflow-x-auto rounded-lg border border-[var(--farm-line)] bg-white p-4 dark:bg-slate-900"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
