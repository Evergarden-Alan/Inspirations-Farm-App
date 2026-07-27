"use client";

import { useEffect, useId, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  chart: string;
}

function getThemeVariables() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();

  return {
    background: token("--farm-paper-deep"),
    primaryColor: token("--farm-paper-raised"),
    primaryTextColor: token("--farm-ink"),
    primaryBorderColor: token("--farm-green"),
    secondaryColor: token("--farm-green-soft"),
    secondaryTextColor: token("--farm-ink"),
    secondaryBorderColor: token("--farm-line-strong"),
    tertiaryColor: token("--farm-input-bg"),
    tertiaryTextColor: token("--farm-text"),
    tertiaryBorderColor: token("--farm-line"),
    lineColor: token("--farm-muted"),
    textColor: token("--farm-ink"),
    mainBkg: token("--farm-paper-raised"),
    nodeBorder: token("--farm-green"),
    clusterBkg: token("--farm-paper-deep"),
    clusterBorder: token("--farm-line-strong"),
    edgeLabelBackground: token("--farm-paper"),
    noteBkgColor: token("--farm-warning-bg"),
    noteTextColor: token("--farm-ink"),
    noteBorderColor: token("--farm-warning-line"),
  };
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeVersion((version) => version + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "strict",
          fontFamily: "var(--font-geist-sans), sans-serif",
          themeVariables: getThemeVariables(),
        });

        const id = `mermaid-${reactId}-${themeVersion}`;
        const result = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (renderError) {
        console.error("Mermaid render error:", renderError);
        if (!cancelled) setError("图表渲染失败，请检查 Mermaid 语法");
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart, reactId, themeVersion]);

  if (error) {
    return (
      <div className="farm-alert-error my-2 flex items-center gap-2 p-3 text-xs" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 flex items-center justify-center gap-2 rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper-deep)] p-4 text-xs text-[var(--farm-muted)]">
        <LoaderCircle className="size-4 animate-spin" />
        正在绘制图表...
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
