import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmptyState,
  FEEDBACK_TONES,
  Feedback,
  type FeedbackTone,
} from "./feedback.ts";

const EXPECTED_TONE_CLASSES = {
  neutral: [
    "border-atlas-border",
    "bg-atlas-surface-muted",
    "text-atlas-text-muted",
  ],
  info: [
    "border-atlas-info-border",
    "bg-atlas-info-surface",
    "text-atlas-info-text",
  ],
  success: [
    "border-atlas-success-border",
    "bg-atlas-success-surface",
    "text-atlas-success-text",
  ],
  warning: [
    "border-atlas-warning-border",
    "bg-atlas-warning-surface",
    "text-atlas-warning-text",
  ],
  danger: [
    "border-atlas-danger-border",
    "bg-atlas-danger-surface",
    "text-atlas-danger-text",
  ],
} as const satisfies Record<FeedbackTone, readonly string[]>;

function classNamesFromMarkup(markup: string) {
  const classAttribute = /class="([^"]+)"/.exec(markup)?.[1];
  assert.ok(classAttribute, "rendered primitive must have a class attribute");
  return new Set(classAttribute.split(/\s+/));
}

test("every Feedback tone renders its restrained semantic token classes", () => {
  for (const tone of FEEDBACK_TONES) {
    const html = renderToStaticMarkup(
      createElement(Feedback, { tone }, `${tone} feedback`),
    );
    const classNames = classNamesFromMarkup(html);

    assert.match(html, /^<div class="[^"]+">[^<]+<\/div>$/);
    for (const className of EXPECTED_TONE_CLASSES[tone]) {
      assert.ok(classNames.has(className), `${tone} must use ${className}`);
    }
    for (const className of [
      "rounded-atlas-control",
      "border",
      "p-atlas-3",
      "text-atlas-sm",
      "font-atlas-medium",
    ]) {
      assert.ok(classNames.has(className), `Feedback must use ${className}`);
    }
  }
});

test("callers explicitly choose accessible alert or status semantics", () => {
  const errorHtml = renderToStaticMarkup(
    createElement(
      Feedback,
      { tone: "danger", role: "alert", id: "save-error" },
      "Could not save changes.",
    ),
  );
  const successHtml = renderToStaticMarkup(
    createElement(
      Feedback,
      { tone: "success", role: "status", "aria-live": "polite" },
      "Changes saved.",
    ),
  );
  const passiveHtml = renderToStaticMarkup(
    createElement(Feedback, { tone: "warning" }, "Review this value."),
  );

  assert.match(errorHtml, / role="alert"/);
  assert.match(errorHtml, / id="save-error"/);
  assert.match(successHtml, / role="status"/);
  assert.match(successHtml, / aria-live="polite"/);
  assert.doesNotMatch(passiveHtml, / role=/);
});

test("EmptyState renders its caller-provided title and description", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, {
      title: "No records yet",
      description: "Records will appear here after they are created.",
      id: "records-empty",
      "aria-label": "Empty records",
    }),
  );

  assert.match(html, /^<div [^>]+>/);
  assert.match(html, / id="records-empty"/);
  assert.match(html, / aria-label="Empty records"/);
  assert.match(
    html,
    /<p class="text-atlas-base font-atlas-semibold text-atlas-text">No records yet<\/p>/,
  );
  assert.match(
    html,
    /<p class="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Records will appear here after they are created.<\/p>/,
  );
});

test("EmptyState supports optional action content without inventing behavior", () => {
  const html = renderToStaticMarkup(
    createElement(
      EmptyState,
      { title: "Nothing here" },
      createElement("button", { type: "button" }, "Create record"),
    ),
  );
  const withoutAction = renderToStaticMarkup(
    createElement(EmptyState, { title: "Nothing here" }),
  );

  assert.match(
    html,
    /<div class="mt-atlas-4 flex items-center justify-center"><button type="button">Create record<\/button><\/div>/,
  );
  assert.doesNotMatch(withoutAction, /mt-atlas-4/);
  assert.doesNotMatch(withoutAction, /<button/);
});

test("EmptyState uses a compact token-based layout without decoration", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, { title: "No results" }),
  );
  const classNames = classNamesFromMarkup(html);

  for (const className of [
    "flex",
    "flex-col",
    "items-center",
    "justify-center",
    "px-atlas-4",
    "py-atlas-8",
    "text-center",
  ]) {
    assert.ok(classNames.has(className), `EmptyState must use ${className}`);
  }
  assert.doesNotMatch(html, /<(?:img|svg)\b/);
});

test("the primitives contain no domain, status, loading, or data logic", () => {
  const source = readFileSync(new URL("./feedback.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
  );
  assert.doesNotMatch(
    source,
    /(?:challan|wage|payment|customer|coal|fuel|maintenance|locked|archived|not.recorded|not.calculated)/i,
  );
  assert.doesNotMatch(source, /StatusPill|@\/lib\/(?:formatting|statuses|strings)/);
  assert.doesNotMatch(source, /(?:animate-pulse|skeleton|fetch\(|useQuery)/i);
});
