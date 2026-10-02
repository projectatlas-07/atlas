import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import type { DashboardContainerProps } from "./components/dashboard-container.tsx";

type TestElement = ReactElement<Record<string, unknown>>;

const source = readFileSync(new URL("./components/dashboard-feature.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mountFeature() {
  const ranges = {
    today: { dateFrom: "2026-09-23", dateTo: "2026-09-23" },
    thisWeek: { dateFrom: "2026-09-21", dateTo: "2026-09-23" },
  };
  let dateCalls = 0;
  const Container = () => null;
  const Link = () => null;
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: Link },
    "../../../lib/formatting": { formatDateOnly: () => "23/09/2026" },
    "../dashboard-date-model": {
      getOwnerDashboardDateRanges: () => {
        dateCalls += 1;
        return ranges;
      },
    },
    "./dashboard-container": { DashboardContainer: Container },
  };
  const moduleExports: Record<string, unknown> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected shell dependency: ${name}`);
    return dependencies[name];
  }, moduleExports);
  const Feature = moduleExports.DashboardFeature as typeof import("./components/dashboard-feature.tsx").DashboardFeature;
  const tree = Feature({ factoryId: "factory-a" }) as ReactElement;
  return { tree, Container, Link, dateCalls };
}

function collectElements(node: ReactNode, target: TestElement[] = []): TestElement[] {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return target;
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, target));
    return target;
  }
  const element = node as TestElement;
  target.push(element);
  collectElements(element.props.children as ReactNode, target);
  return target;
}

test("derives one consistent Today/week range and gives it to the sole data container", () => {
  const { tree, Container, dateCalls } = mountFeature();
  const containers = collectElements(tree).filter((element) => element.type === Container);
  assert.equal(dateCalls, 1);
  assert.equal(containers.length, 1);
  assert.deepEqual(containers[0]?.props as unknown as DashboardContainerProps, {
    factoryId: "factory-a",
    businessDate: "2026-09-23",
    weekStart: "2026-09-21",
  });
});

test("header exposes exactly the two approved touch-friendly shortcuts", () => {
  const { tree, Link } = mountFeature();
  const shortcutNav = collectElements(tree).find((element) => element.type === "nav" && element.props["aria-label"] === "Dashboard shortcuts");
  assert.ok(shortcutNav);
  const links = collectElements(shortcutNav).filter((element) => element.type === "a" || element.type === Link);
  assert.deepEqual(links.map((link) => ({ href: link.props.href, label: link.props.children })), [
    { href: "/office#brick-production", label: "Record Production" },
    { href: "#new-challan", label: "New Challan" },
  ]);
  for (const link of links) assert.match(String(link.props.className), /min-h-atlas-12/);
});

test("feature shell contains no direct data access, state machine, or legacy date controls", () => {
  assert.doesNotMatch(source, /getDashboardSnapshot|dashboard-query|\/services\/|compensation|supabase|fetch\(|refetch|invalidateQueries|useEffect|useState|setInterval|setTimeout|addEventListener|new Date|getLocalDate|Intl\.|DashboardDateControls|type="date"/i);
  assert.match(source, /export interface DashboardFeatureProps\s*\{\s*factoryId: string;\s*\}/);
  assert.doesNotMatch(source, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});
