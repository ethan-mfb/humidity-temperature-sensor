import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEdgeTimeline,
  createLibgpiodSession,
  parseHelperOutput,
} from "../src/index.mjs";

test("parseHelperOutput reads one edge per line", () => {
  assert.deepEqual(parseHelperOutput("1 0\n0 24792\n1 73075\n"), [
    { level: 1, timestampNs: 0 },
    { level: 0, timestampNs: 24792 },
    { level: 1, timestampNs: 73075 },
  ]);
});

test("parseHelperOutput drops blank and unparseable lines", () => {
  assert.deepEqual(parseHelperOutput("\n  \n1 500\nnot an edge\n"), [
    { level: 1, timestampNs: 500 },
  ]);
});

test("createEdgeTimeline makes the session's first edge the origin", () => {
  const timeline = createEdgeTimeline();

  assert.deepEqual(
    timeline.place([
      { level: 1, timestampNs: 9_000_000_000 },
      { level: 0, timestampNs: 9_000_024_792 },
    ]),
    [
      { level: 1, tickUs: 0, tickNs: 0 },
      { level: 0, tickUs: 25, tickNs: 24792 },
    ],
  );
});

test("createEdgeTimeline keeps the idle gap between separate reads", () => {
  // The helper runs once per read and the monotonic clock keeps going, so a
  // session spanning several runs must stay one continuous timeline.
  const timeline = createEdgeTimeline();
  timeline.place([{ level: 1, timestampNs: 1_000_000_000 }]);

  const [edge] = timeline.place([{ level: 1, timestampNs: 3_000_000_000 }]);

  assert.equal(edge.tickNs, 2_000_000_000);
  assert.equal(edge.tickUs, 2_000_000);
});

test("readFrame reports a helper that is missing instead of throwing", async () => {
  const session = createLibgpiodSession({
    bcmPin: 2,
    helperPath: "/nonexistent/gpiod-capture",
  });

  const result = await session.readFrame();

  assert.deepEqual(result.edges, []);
  assert.equal(result.resolvedChip, null);
  assert.ok(result.error.message.length > 0);
});
