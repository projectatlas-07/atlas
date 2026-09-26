import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveManagerWorkflowFromHash } from "./manager-workflow-navigation.ts";

const screenSource = readFileSync(
  new URL("./components/manager-entry-screen.tsx", import.meta.url),
  "utf8",
);

test("Office recording links resolve to the three existing site workflows", () => {
  assert.equal(resolveManagerWorkflowFromHash("#brick-production"), "production");
  assert.equal(resolveManagerWorkflowFromHash("#chamber-transport"), "transport");
  assert.equal(resolveManagerWorkflowFromHash("#soil"), "soil");
  assert.equal(resolveManagerWorkflowFromHash(""), "production");
});

test("legacy workflow hashes remain safe and unknown hashes use Brick Production", () => {
  assert.equal(resolveManagerWorkflowFromHash("#production"), "production");
  assert.equal(resolveManagerWorkflowFromHash("#transport"), "transport");
  assert.equal(resolveManagerWorkflowFromHash("#unknown"), "production");
});

test("hash navigation selects existing screens without duplicating a workflow", () => {
  assert.match(screenSource, /resolveManagerWorkflowFromHash\(window\.location\.hash\)/);
  assert.match(screenSource, /window\.addEventListener\("hashchange", syncWorkflowFromHash\)/);
  assert.equal((screenSource.match(/<ProductionEntryScreen\b/g) ?? []).length, 1);
  assert.equal((screenSource.match(/<SoilDailyEntryScreen\b/g) ?? []).length, 1);
  assert.equal((screenSource.match(/<TransportDailyEntryScreen\b/g) ?? []).length, 1);
});
