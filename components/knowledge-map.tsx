"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { GraphCanvasRenderer } from "@/components/graph-canvas";
import {
  DEFAULT_RENDER_SETTINGS,
  formatMessage,
  type GraphRenderSettings,
  type KnowledgeMapResponse,
  type KnowledgeScope,
  type KnowledgeSectionResponse,
} from "@/src/core";
import {
  ALL_SCOPES,
  SCOPE_COLORS,
  countVisible,
  findSections,
  formatCitation,
  layoutKnowledgeMap,
  nodePathText,
  sectionUrl,
  toggleScope,
} from "@/components/knowledge-map-model";

const MAP_SETTINGS: GraphRenderSettings = {
  ...DEFAULT_RENDER_SETTINGS,
  clusterLabels: false,
  // Tier-0 labels (documents and the top two section levels) show at the
  // fitted zoom; each deeper level needs ~2x more zoom (labelTier).
  labelZoom: 1.2,
  arrowLength: 1.5,
};

/** Resolve a CSS color (oklch in this app) to #rrggbb via a 1px canvas. */
function tokenHex(cssVar: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    if (!value) return "#888888";
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return "#888888";
    ctx.canvas.width = 1;
    ctx.canvas.height = 1;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#888888";
  }
}

type SectionState =
  | { status: "loading" }
  | { status: "ok"; section: KnowledgeSectionResponse }
  | { status: "not_found" }
  | { status: "error" };

export function KnowledgeMap({ revision }: { revision: number }) {
  const copy = useI18n().knowledge;
  const [data, setData] = useState<KnowledgeMapResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [scopes, setScopes] = useState(ALL_SCOPES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [themeTick, setThemeTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphCanvasRenderer | null>(null);

  // Fetch on mount (the page mounts this on first open) and whenever the
  // page's document lists change (revision).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/knowledge/map");
        if (!response.ok) throw new Error("map_failed");
        const result = (await response.json()) as KnowledgeMapResponse;
        if (cancelled) return;
        setData({ nodes: Array.isArray(result.nodes) ? result.nodes : [], edges: Array.isArray(result.edges) ? result.edges : [] });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [revision]);

  const layout = useMemo(() => (data ? layoutKnowledgeMap(data, scopes) : null), [data, scopes]);
  const visibleNodes = useMemo(() => layout?.nodes.map((l) => l.node) ?? [], [layout]);
  const counts = countVisible(visibleNodes);
  const results = findSections(visibleNodes, query);
  const hasNodes = (data?.nodes.length ?? 0) > 0;
  const selected = selectedId ? visibleNodes.find((n) => n.id === selectedId) ?? null : null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  // Re-resolve theme colors when the app theme flips.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setThemeTick((t) => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  // Renderer lifecycle (canvas exists only when there is something to draw).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!hasNodes || !canvas) return;
    let renderer: GraphCanvasRenderer;
    try {
      renderer = new GraphCanvasRenderer(
        canvas,
        {
          onSelect: (id) => setSelectedId(id),
          onContext: () => {},
          onStageClick: () => {},
          onCameraMove: () => {},
          onCommit: () => {},
        },
        null,
        { lockLayout: true },
      );
      renderer.setSettings(MAP_SETTINGS);
    } catch {
      return; // no 2D canvas (non-browser environment)
    }
    rendererRef.current = renderer;
    // Re-frame whenever the canvas is resized (tab open, side panel,
    // window) until the user pans/zooms themselves — the first size the
    // renderer sees is often pre-layout, which left the map off-frame.
    let userMoved = false;
    const markMoved = () => { userMoved = true; };
    canvas.addEventListener("wheel", markMoved, { passive: true });
    canvas.addEventListener("pointerdown", markMoved);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => { if (!userMoved) requestAnimationFrame(() => renderer.fit()); });
    observer?.observe(canvas);
    return () => {
      observer?.disconnect();
      canvas.removeEventListener("wheel", markMoved);
      canvas.removeEventListener("pointerdown", markMoved);
      rendererRef.current = null;
      renderer.destroy();
    };
  }, [hasNodes]);

  // Data feed: positions are computed here (layoutKnowledgeMap), never in the renderer.
  const lastScopes = useRef(scopes);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !layout) return;
    renderer.setData({
      nodes: layout.nodes.map((l) => ({
        id: l.node.id,
        x: l.x,
        y: l.y,
        label: l.node.label,
        color: SCOPE_COLORS[l.node.scope],
        radius: l.radius,
        labelTier: Math.max(0, l.node.path.length - 2),
      })),
      edges: layout.edges.map((e) => ({ from: e.from, to: e.to })),
      clusters: [],
      colors: {
        node: tokenHex("--primary"),
        edge: tokenHex("--ring"),
        label: tokenHex("--muted-foreground"),
        hoverText: tokenHex("--foreground"),
      },
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    // A filter change reflows the grid: reframe the camera.
    if (lastScopes.current !== scopes) {
      lastScopes.current = scopes;
      renderer.fit();
    }
  }, [layout, themeTick, hasNodes, scopes]);

  useEffect(() => {
    rendererRef.current?.setSelected(selected?.id ?? null);
  }, [selected, layout]);

  // Section text for the side panel.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setSection({ status: "loading" });
    (async () => {
      try {
        const response = await fetch(sectionUrl(selected));
        if (cancelled) return;
        if (response.status === 404) { setSection({ status: "not_found" }); return; }
        if (!response.ok) throw new Error("section_failed");
        const result = (await response.json()) as KnowledgeSectionResponse;
        if (!cancelled) setSection({ status: "ok", section: result });
      } catch {
        if (!cancelled) setSection({ status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  function pick(id: string) {
    setSelectedId(id);
    setQuery("");
    rendererRef.current?.centerOn(id);
  }

  const chips: { scope: KnowledgeScope; label: string }[] = [
    { scope: "shared", label: copy.filterShared },
    { scope: "personal", label: copy.filterPersonal },
  ];

  if (failed && !data) return <div role="alert" className="m-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{copy.mapLoadFailed}</div>;
  if (!data) return <div className="p-6 text-sm text-muted-foreground">{copy.sectionLoading}</div>;
  if (!hasNodes) return <div className="m-6 rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">{copy.mapEmpty}</div>;

  const citationSource = section.status === "ok" && section.section.citation ? section.section.citation : selected?.citation;
  const citationText = citationSource ? formatCitation(citationSource, copy) : "";

  return <div className="relative flex min-h-[480px] min-w-0 flex-1 flex-col">
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Filter chips double as the legend */}
      <div role="group" aria-label={copy.tabMap} className="absolute left-4 top-4 flex gap-2">
        {chips.map(({ scope, label }) => <button
          key={scope}
          type="button"
          aria-pressed={scopes[scope]}
          onClick={() => setScopes((current) => toggleScope(current, scope))}
          className={`inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm transition-colors ${scopes[scope] ? "bg-accent font-medium text-accent-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[scope], opacity: scopes[scope] ? 1 : 0.4 }} />
          {label}
        </button>)}
      </div>

      {selected && <aside aria-label={selected.label} className="absolute bottom-0 right-0 top-0 w-64 overflow-y-auto border-l border-border bg-card p-4 text-sm shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SCOPE_COLORS[selected.scope] }} />
            {selected.scope === "shared" ? copy.filterShared : copy.filterPersonal}
          </span>
          <button type="button" aria-label={copy.closePanel} onClick={() => setSelectedId(null)} className="rounded-md px-2 text-muted-foreground hover:text-foreground">×</button>
        </div>
        <h3 className="mt-2 break-words font-semibold">{selected.label}</h3>
        {selected.kind === "section" && <p className="mt-1 break-words text-xs text-muted-foreground">{nodePathText(selected)}</p>}
        <p className="mt-1 break-words text-xs text-muted-foreground">{selected.fileName}{citationText ? ` · ${citationText}` : ""}</p>
        <div className="mt-3 border-t border-border pt-3">
          {section.status === "loading" && <p className="text-muted-foreground">{copy.sectionLoading}</p>}
          {section.status === "not_found" && <p className="text-muted-foreground">{copy.sectionNotFound}</p>}
          {section.status === "error" && <p className="text-red-500">{copy.mapLoadFailed}</p>}
          {section.status === "ok" && <>
            <p className="whitespace-pre-wrap break-words">{section.section.text}</p>
            {section.section.truncated && <p className="mt-2 text-xs text-muted-foreground">{copy.sectionTruncated}</p>}
          </>}
        </div>
      </aside>}
    </div>

    {/* Bottom bar: find + counts */}
    <div className="relative flex items-center gap-4 border-t border-border px-4 py-2 text-sm">
      <div className="relative w-64 max-w-full">
        <input
          type="search"
          value={query}
          placeholder={copy.findSection}
          aria-label={copy.findSection}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 outline-none focus:ring-1 focus:ring-ring"
        />
        {results.length > 0 && <ul className="absolute bottom-full left-0 z-10 mb-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {results.map((node) => <li key={node.id}>
            <button type="button" onClick={() => pick(node.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent">
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SCOPE_COLORS[node.scope] }} />
              <span className="min-w-0 truncate">{node.label}</span>
            </button>
          </li>)}
        </ul>}
      </div>
      <span className="ml-auto text-muted-foreground">{formatMessage(copy.mapCounts, { documents: counts.documents, sections: counts.sections })}</span>
    </div>
  </div>;
}
