import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import type { DashboardContainerProps } from "./components/dashboard-container.tsx";
import type { DashboardDateControlsProps } from "./components/dashboard-date-controls.tsx";

const source = readFileSync(new URL("./components/dashboard-feature.tsx", import.meta.url), "utf8");
// Node's strip-types runner does not load TSX. Compile only this shell in memory,
// then isolate its state and children; no child, query, or date implementation runs.
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mountFeature() {
  const todayRange = { dateFrom: "2026-09-03", dateTo: "2026-09-03" };
  let todayCalls = 0;
  const state: unknown[] = [];
  let hookIndex = 0;
  const DateControls = () => null;
  const Container = () => null;
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState<T>(initial: T | (() => T)) {
        const index = hookIndex++;
        if (!(index in state)) state[index] = typeof initial === "function" ? (initial as () => T)() : initial;
        return [state[index], (next: T | ((previous: T) => T)) => {
          state[index] = typeof next === "function" ? (next as (previous: T) => T)(state[index] as T) : next;
        }];
      },
    },
    "../dashboard-date-model": {
      getTodayDashboardRange: () => {
        todayCalls += 1;
        return todayRange;
      },
    },
    "./dashboard-date-controls": { DashboardDateControls: DateControls },
    "./dashboard-container": { DashboardContainer: Container },
  };
  const moduleExports: Record<string, unknown> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected shell dependency: ${name}`);
    return dependencies[name];
  }, moduleExports);
  const Feature = moduleExports.DashboardFeature as typeof import("./components/dashboard-feature.tsx").DashboardFeature;

  return {
    todayRange,
    todayCalls: () => todayCalls,
    render(factoryId = "factory-a") {
      hookIndex = 0;
      const tree = Feature({ factoryId }) as ReactElement<{
        children: [ReactElement<DashboardDateControlsProps>, ReactElement<DashboardContainerProps>];
      }>;
      const [controls, container] = tree.props.children;
      assert.equal(controls.type, DateControls);
      assert.equal(container.type, Container);
      return { controls: controls.props, container: container.props };
    },
  };
}

test("initializes Today lazily from D3.4 and forwards the same selection to both children", () => {
  const feature = mountFeature();
  const { controls, container } = feature.render();
  assert.equal(controls.mode, "today");
  assert.strictEqual(controls.range, feature.todayRange);
  assert.deepEqual(container, { factoryId: "factory-a", ...feature.todayRange });
  feature.render();
  assert.equal(feature.todayCalls(), 1);
});

test("a valid Single Date emission updates controls and container without fetching", () => {
  const feature = mountFeature();
  const range = { dateFrom: "2026-08-15", dateTo: "2026-08-15" };
  feature.render().controls.onChange("single-date", range);
  const next = feature.render();
  assert.equal(next.controls.mode, "single-date");
  assert.strictEqual(next.controls.range, range);
  assert.deepEqual(next.container, { factoryId: "factory-a", ...range });
});

test("a valid custom range emission updates the container with unchanged endpoints", () => {
  const feature = mountFeature();
  const range = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };
  feature.render().controls.onChange("range", range);
  const next = feature.render();
  assert.equal(next.controls.mode, "range");
  assert.strictEqual(next.controls.range, range);
  assert.deepEqual(next.container, { factoryId: "factory-a", ...range });
});

test("switching back to Today uses the range emitted by the approved controls", () => {
  const feature = mountFeature();
  feature.render().controls.onChange("single-date", { dateFrom: "2026-08-15", dateTo: "2026-08-15" });
  const emittedToday = { dateFrom: "2026-09-04", dateTo: "2026-09-04" };
  feature.render().controls.onChange("today", emittedToday);
  const next = feature.render();
  assert.equal(next.controls.mode, "today");
  assert.strictEqual(next.controls.range, emittedToday);
  assert.deepEqual(next.container, { factoryId: "factory-a", ...emittedToday });
  assert.equal(feature.todayCalls(), 1);
});

test("a factory change reaches the container while preserving the selected mode and range", () => {
  const feature = mountFeature();
  const range = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };
  feature.render().controls.onChange("range", range);
  const next = feature.render("factory-b");
  assert.equal(next.controls.mode, "range");
  assert.strictEqual(next.controls.range, range);
  assert.deepEqual(next.container, { factoryId: "factory-b", ...range });
  assert.equal(feature.todayCalls(), 1);
});

test("shell contains no direct loading, timezone logic, input drafts, or background work", () => {
  assert.doesNotMatch(source, /getDashboardSnapshot|dashboard-query|\/services\/|compensation|supabase|fetch\(|refetch|invalidateQueries|useEffect|setInterval|setTimeout|addEventListener|new Date|getLocalDate|Intl\.|draft|createContext|type="date"/i);
  assert.match(source, /export interface DashboardFeatureProps\s*\{\s*factoryId: string;\s*\}/);
});
