import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeSvg, PNG_SIZE, renderPng } from "../src/render.js";

const PNG_WIDTH_OFFSET = 16;

test("renders a 32x32 pixel SVG to a 1024x1024 PNG", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="#0b1d36"/><path stroke="#f00" d="M1 1.5h2"/></svg>';
  const png = renderPng(svg);
  assert.equal(png.readUInt32BE(PNG_WIDTH_OFFSET), PNG_SIZE);
  assert.equal(png.readUInt32BE(PNG_WIDTH_OFFSET + 4), PNG_SIZE);
});

test("refuses SVGs that could pull outside content", () => {
  for (const bad of [
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><use xlink:href="#a"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
    '<svg><rect fill="url(#g)"/></svg>',
    "not svg",
  ]) {
    assert.throws(() => assertSafeSvg(bad));
  }
});
