"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { GraphEdge, GraphNode, GraphNodeKind } from "@/lib/graph/build";

interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: GraphNodeKind;
  label: string;
  weight: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { relation: GraphEdge["relation"] };

const KIND_COLOR: Record<GraphNodeKind, string> = {
  entity: "--accent",
  case: "--cyan",
  court: "--violet",
  judge: "--amber",
  attorney: "--emerald",
  firm: "--emerald",
  party: "--fg-muted",
};

function radius(n: SimNode) {
  if (n.kind === "entity") return 14;
  if (n.kind === "case") return 5 + Math.min(4, n.weight);
  return 4 + Math.min(6, n.weight * 1.2);
}

export function GraphCanvas({ nodes, edges, selectedId, onSelect, height = 520 }: { nodes: GraphNode[]; edges: GraphEdge[]; selectedId: string | null; onSelect: (id: string | null) => void; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<string | null>(null);
  const colors = useRef<Record<string, string>>({});
  const [, force] = useState(0);
  const drawRef = useRef<() => void>(() => {});

  const readColors = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (v: string) => cs.getPropertyValue(v).trim() || "#888";
    colors.current = { "--accent": get("--accent"), "--cyan": get("--cyan"), "--violet": get("--violet"), "--amber": get("--amber"), "--emerald": get("--emerald"), "--fg-muted": get("--fg-muted"), "--fg": get("--fg"), "--border": get("--border-strong"), "--bg": get("--bg-elev") };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const c = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { x, y, k } = view.current;
    ctx.translate(w / 2 + x, h / 2 + y);
    ctx.scale(k, k);

    const focus = selectedId ?? hover.current;
    const neighbors = new Set<string>();
    if (focus) {
      neighbors.add(focus);
      for (const l of linksRef.current) {
        const s = (l.source as SimNode).id;
        const t = (l.target as SimNode).id;
        if (s === focus) neighbors.add(t);
        if (t === focus) neighbors.add(s);
      }
    }

    for (const l of linksRef.current) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      const lit = focus ? neighbors.has(s.id) && neighbors.has(t.id) && (s.id === focus || t.id === focus) : false;
      ctx.globalAlpha = focus ? (lit ? 0.9 : 0.06) : 0.28;
      ctx.strokeStyle = lit ? c["--accent"] : c["--border"];
      ctx.lineWidth = (lit ? 1.6 : 1) / Math.sqrt(k);
      if (l.relation === "adverse_in_caption") ctx.setLineDash([4 / k, 3 / k]);
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const n of nodesRef.current) {
      const r = radius(n);
      const dim = focus && !neighbors.has(n.id);
      ctx.globalAlpha = dim ? 0.18 : 1;
      const col = c[KIND_COLOR[n.kind]];
      if (n.kind === "entity" || n.id === selectedId) {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = dim ? 0.05 : 0.18;
        ctx.fill();
        ctx.globalAlpha = dim ? 0.18 : 1;
      }
      ctx.beginPath();
      if (n.kind === "case") ctx.rect(n.x! - r, n.y! - r, r * 2, r * 2);
      else ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      ctx.fillStyle = n.kind === "firm" ? c["--bg"] : col;
      ctx.fill();
      if (n.kind === "firm") {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 / Math.sqrt(k);
        ctx.stroke();
      }
      const showLabel = n.kind === "entity" || n.id === focus || (focus && neighbors.has(n.id)) || (!focus && n.weight >= 2 && n.kind !== "case" && k > 0.7);
      if (showLabel) {
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.font = `${n.kind === "entity" ? 600 : 500} ${Math.max(10, 12 / Math.sqrt(k))}px ui-sans-serif, system-ui`;
        ctx.fillStyle = c["--fg"];
        ctx.textAlign = "center";
        const label = n.label.length > 34 ? n.label.slice(0, 32) + "…" : n.label;
        ctx.fillText(label, n.x!, n.y! + r + 13 / Math.sqrt(k));
      }
    }
    ctx.globalAlpha = 1;
  }, [selectedId]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    readColors();
    const obs = new MutationObserver(() => {
      readColors();
      drawRef.current();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [readColors]);

  useEffect(() => {
    const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, weight: n.caseKeys.length }));
    const ids = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, relation: e.relation }));
    nodesRef.current = simNodes;
    linksRef.current = simLinks;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sim = forceSimulation<SimNode>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance((l) => ((l.source as SimNode).kind === "entity" || (l.target as SimNode).kind === "entity" ? 90 : 55)).strength(0.6))
      .force("charge", forceManyBody<SimNode>().strength((n) => (n.kind === "entity" ? -600 : n.kind === "case" ? -140 : -90)))
      .force("collide", forceCollide<SimNode>().radius((n) => radius(n) + 6))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.03))
      .force("y", forceY(0).strength(0.04));
    if (reduce) {
      sim.stop();
      sim.tick(300);
      drawRef.current();
    } else {
      sim.on("tick", () => drawRef.current());
    }
    simRef.current = sim;
    view.current = { x: 0, y: 0, k: simNodes.length > 80 ? 0.6 : simNodes.length > 40 ? 0.8 : 1 };
    force((n) => n + 1);
    return () => {
      sim.stop();
    };
  }, [nodes, edges]);

  useEffect(() => {
    const ro = new ResizeObserver(() => drawRef.current());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // --- interaction
  const toWorld = (px: number, py: number) => {
    const canvas = canvasRef.current!;
    const { x, y, k } = view.current;
    return { x: (px - canvas.clientWidth / 2 - x) / k, y: (py - canvas.clientHeight / 2 - y) / k };
  };
  const hit = (px: number, py: number) => {
    const p = toWorld(px, py);
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d < radius(n) + 6 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const drag = useRef<{ mode: "pan" | "node" | null; node?: SimNode; sx: number; sy: number; vx: number; vy: number; moved: boolean }>({ mode: null, sx: 0, sy: 0, vx: 0, vy: 0, moved: false });

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const n = hit(px, py);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: n ? "node" : "pan", node: n ?? undefined, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
      simRef.current?.alphaTarget(0.2).restart();
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = drag.current;
    if (d.mode) {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.mode === "pan") {
        view.current.x = d.vx + dx;
        view.current.y = d.vy + dy;
      } else if (d.node) {
        const p = toWorld(e.clientX - rect.left, e.clientY - rect.top);
        d.node.fx = p.x;
        d.node.fy = p.y;
      }
      drawRef.current();
      return;
    }
    const n = hit(e.clientX - rect.left, e.clientY - rect.top);
    if ((n?.id ?? null) !== hover.current) {
      hover.current = n?.id ?? null;
      e.currentTarget.style.cursor = n ? "pointer" : "grab";
      drawRef.current();
    }
  }
  function onPointerUp() {
    const d = drag.current;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      simRef.current?.alphaTarget(0);
      if (!d.moved) onSelect(d.node.id === selectedId ? null : d.node.id);
    } else if (d.mode === "pan" && !d.moved) {
      onSelect(null);
    }
    drag.current = { mode: null, sx: 0, sy: 0, vx: 0, vy: 0, moved: false };
  }
  function zoom(f: number) {
    view.current.k = Math.min(3, Math.max(0.25, view.current.k * f));
    drawRef.current();
  }
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 40) return;
    zoom(e.deltaY < 0 ? 1.12 : 0.89);
  }

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-2xl border border-line bg-inset bg-grid" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hover.current = null;
          drawRef.current();
        }}
        onWheel={onWheel}
        role="img"
        aria-label={`Litigation graph with ${nodes.length} nodes and ${edges.length} relationships. Use the relationship list for an accessible view.`}
      />
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        {[
          { icon: ZoomIn, f: () => zoom(1.25), label: "Zoom in" },
          { icon: ZoomOut, f: () => zoom(0.8), label: "Zoom out" },
          {
            icon: Maximize2,
            f: () => {
              view.current = { x: 0, y: 0, k: nodesRef.current.length > 80 ? 0.6 : 1 };
              drawRef.current();
            },
            label: "Reset view",
          },
        ].map(({ icon: I, f, label }) => (
          <button key={label} onClick={f} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-elev/90 text-muted backdrop-blur hover:text-fg" aria-label={label}>
            <I className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
