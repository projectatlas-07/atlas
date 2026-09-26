import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Input, Select } from "./form-controls.ts";
import { FormField, type FormFieldProps } from "./form-field.ts";

test("FormField renders an explicit accessible label with the shared V2 rhythm", () => {
  const props: FormFieldProps = {
    label: "Amount",
    htmlFor: "payment-amount",
    children: createElement(Input, {
      id: "payment-amount",
      inputMode: "decimal",
    }),
  };
  const html = renderToStaticMarkup(
    createElement(FormField, props),
  );

  assert.match(html, /^<label /);
  assert.match(html, /for="payment-amount"/);
  assert.match(
    html,
    /class="block text-atlas-sm font-atlas-medium text-atlas-text-muted"/,
  );
  assert.match(html, /<span class="mb-atlas-1 block">Amount<\/span>/);
  assert.match(html, /id="payment-amount"/);
  assert.match(html, /inputMode="decimal"|inputmode="decimal"/);
});

test("FormField also supports implicit labels and caller-owned control behavior", () => {
  const props: FormFieldProps = {
    label: "Customer",
    "aria-label": "Customer field",
    children: createElement(
      Select,
      { name: "customer", disabled: true },
      createElement("option", { value: "" }, "Select customer"),
    ),
  };
  const html = renderToStaticMarkup(
    createElement(FormField, props),
  );

  assert.doesNotMatch(html, /for=/);
  assert.match(html, /aria-label="Customer field"/);
  assert.match(html, /<select[^>]*name="customer"[^>]*disabled=""/);
  assert.match(html, />Select customer<\/option>/);
});

test("FormField stays presentation-only and uses the Atlas token vocabulary", () => {
  const source = readFileSync(new URL("./form-field.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /(?:Soil|Challan|payment|wage|customer)/i);
  assert.doesNotMatch(source, /(?:slate|stone|amber|red|cyan)-\d+|#[0-9a-f]{3,8}/i);
  assert.match(source, /text-atlas-sm/);
  assert.match(source, /font-atlas-medium/);
  assert.match(source, /text-atlas-text-muted/);
  assert.match(source, /mb-atlas-1/);
});
