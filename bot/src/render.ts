// Contract SVG (32×32 pixel art) → 1024×1024 PNG with hard pixel edges.

import { Resvg } from "@resvg/resvg-js";

export const PNG_SIZE = 1024;
const MAX_SVG_BYTES = 64 * 1024;
/** resvg-js `shapeRendering`: 1 = crispEdges (no anti-aliasing). */
const CRISP_EDGES = 1;
/**
 * The contract only emits rect/path/g. Anything able to pull in outside content (images, links,
 * entities, scripts, text with fonts) is refused, so a hostile RPC cannot make the bot render
 * local files into a public post.
 */
const FORBIDDEN_SVG = /<!DOCTYPE|<!ENTITY|<image|<use|<script|<foreignObject|<text|href|url\(/i;

export class RenderError extends Error {
  override name = "RenderError";
}

export function assertSafeSvg(svg: string): void {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) throw new RenderError("SVG too large");
  if (!svg.trimStart().startsWith("<svg")) throw new RenderError("not an SVG document");
  if (FORBIDDEN_SVG.test(svg)) throw new RenderError("SVG contains a forbidden construct");
}

export function renderPng(svg: string): Buffer {
  assertSafeSvg(svg);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: PNG_SIZE },
    shapeRendering: CRISP_EDGES,
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
