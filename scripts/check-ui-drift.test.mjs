import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareUiDrift,
  createUiDriftBaseline,
  scanUiDrift,
} from "./check-ui-drift.mjs";

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "atlas-ui-drift-"));
  for (const [relativePath, content] of Object.entries({
    "src/lib/strings.ts": `
      const ENGLISH_SHARED_STRINGS = {
        actions: { save: "Save", retry: "Retry" },
        feedback: { loading: "Loading..." },
      } as const;
    `,
    ...files,
  })) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function rules(findings) {
  return new Set(findings.map((finding) => finding.rule));
}

test("valid V2 code using shared contracts passes an empty baseline", () => {
  const root = fixture({
    "src/valid.tsx": `
      import { Button } from "./components/ui/button";
      import { Input } from "./components/ui/form-controls";
      import { Feedback } from "./components/ui/feedback";
      import { formatIndianCurrency } from "./lib/formatting";
      import { ATLAS_UI_STRINGS } from "./lib/strings";

      export function Valid() {
        return <Feedback tone="info" role="status">
          <Input inputMode="decimal" aria-label="Amount" />
          <span>{formatIndianCurrency(1234)}</span>
          <Button>{ATLAS_UI_STRINGS.actions.save}</Button>
        </Feedback>;
      }
    `,
  });

  const findings = scanUiDrift(root);
  const baseline = createUiDriftBaseline([]);
  assert.deepEqual(compareUiDrift(findings, baseline), []);
});

test("representative raw styles and presentation bypasses are detected", () => {
  const root = fixture({
    "src/broken.tsx": `
      export function Broken({ status }) {
        return <div style={{ color: "#123456" }} className="mt-[13px]">
          <button className="rounded-[13px] bg-[#abcdef] px-4 shadow-[0_2px_8px_#000]">Save</button>
          <input className="h-10 rounded-lg border border-slate-300" />
          <select className="h-10 rounded-lg border border-slate-300"><option>One</option></select>
          <table className="w-full"><tbody><tr><td className="px-4">Value</td></tr></tbody></table>
          <section className="rounded-xl border border-slate-200 bg-white p-4">Grouped content</section>
          <p className="bg-red-50 p-4 text-red-800">Problem</p>
          <div className="py-8 text-center text-slate-500">Nothing here</div>
          <span className="rounded-full bg-emerald-100 px-2 text-emerald-800">Active</span>
          <span>{(123456).toLocaleString("en-IN")}</span>
          <span>{status === "void" ? "Void" : "Active"}</span>
        </div>;
      }
    `,
  });

  const detected = rules(scanUiDrift(root));
  for (const rule of [
    "raw-color",
    "arbitrary-color",
    "arbitrary-spacing",
    "arbitrary-radius",
    "arbitrary-shadow",
    "duplicate-button-style",
    "duplicate-input-style",
    "duplicate-select-style",
    "duplicate-table-style",
    "duplicate-card-surface",
    "duplicate-feedback-style",
    "duplicate-empty-state-style",
    "status-presentation-bypass",
    "formatting-bypass",
    "shared-string-bypass",
  ]) {
    assert.ok(detected.has(rule), `expected ${rule}`);
  }
});

test("grandfathered legacy occurrences remain allowed", () => {
  const root = fixture({
    "src/features/office/components/soil-office-section.tsx": `
      export function Legacy() {
        return <button className="rounded-lg bg-slate-950 px-4">Save</button>;
      }
    `,
  });
  const findings = scanUiDrift(root);
  const baseline = createUiDriftBaseline(findings);

  assert.ok(findings.length > 0);
  assert.deepEqual(compareUiDrift(scanUiDrift(root), baseline), []);
});

test("a new violation in a grandfathered file still fails", () => {
  const root = fixture({
    "src/features/office/components/soil-office-section.tsx": `
      export function Legacy() {
        return <button className="rounded-lg bg-slate-950 px-4">Save</button>;
      }
    `,
  });
  const baseline = createUiDriftBaseline(scanUiDrift(root));

  writeFileSync(
    path.join(root, "src/features/office/components/soil-office-section.tsx"),
    `
      export function Legacy() {
        return <div>
          <button className="rounded-lg bg-slate-950 px-4">Save</button>
          <button className="rounded-lg bg-slate-950 px-4">Save</button>
        </div>;
      }
    `,
  );

  const violations = compareUiDrift(scanUiDrift(root), baseline);
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "duplicate-button-style"
        && violation.count === 2
        && violation.baselineCount === 1,
    ),
  );
});

test("a narrow ui-exception covers one line and requires a reason", () => {
  const root = fixture({
    "src/exception.tsx": `
      // ui-exception: fixed third-party brand colour required by contract
      const approved = "#123456";
      const stillInvalid = "#abcdef";
      // ui-exception:
      const missingReason = "#fedcba";
      const fakeException = "ui-exception: strings cannot disable checks";
      const alsoInvalid = "#101010";
      export function ExceptionExample() { return <p>{approved}{stillInvalid}{missingReason}{fakeException}{alsoInvalid}</p>; }
    `,
  });

  const findings = scanUiDrift(root);
  const rawColors = findings.filter((finding) => finding.rule === "raw-color");

  assert.equal(rawColors.length, 3);
  assert.ok(findings.some((finding) => finding.rule === "invalid-ui-exception"));
});
