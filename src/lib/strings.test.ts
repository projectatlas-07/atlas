import assert from "node:assert/strict";
import test from "node:test";

import {
  ATLAS_UI_STRINGS,
  type AtlasSharedStrings,
} from "./strings.ts";

function collectLeaves(value: unknown, path = ""): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [[path, value]];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectLeaves(child, path ? `${path}.${key}` : key));
}

test("shared strings expose stable namespaced wording", () => {
  assert.deepEqual(ATLAS_UI_STRINGS, {
    actions: {
      add: "Add",
      archive: "Archive",
      cancel: "Cancel",
      clear: "Clear",
      close: "Close",
      confirm: "Confirm",
      create: "Create",
      delete: "Delete",
      edit: "Edit",
      filter: "Filter",
      open: "Open",
      restore: "Restore",
      retry: "Retry",
      save: "Save",
      search: "Search",
      update: "Update",
    },
    fields: {
      amount: "Amount",
      date: "Date",
      fromDate: "From date",
      name: "Name",
      note: "Note",
      noteOptional: "Note (optional)",
      status: "Status",
      toDate: "To date",
    },
    payment: {
      amount: "Payment amount",
      date: "Payment date",
      mode: "Payment mode",
      selectMode: "Select mode",
      history: "Payment history",
      outstanding: "Outstanding",
      due: "Due",
      loadingHistory: "Loading payment history...",
      historyLoadError: "Could not load payment history.",
      noHistory: "No payments recorded yet.",
    },
    feedback: {
      loading: "Loading...",
      saving: "Saving...",
      unavailable: "Unavailable",
    },
  });
});

test("every shared string leaf is non-empty plain text", () => {
  for (const [path, value] of collectLeaves(ATLAS_UI_STRINGS)) {
    assert.equal(typeof value, "string", `${path} must be a string`);
    assert.equal(value, (value as string).trim(), `${path} must be trimmed`);
    assert.ok((value as string).length > 0, `${path} must not be empty`);
    assert.doesNotMatch(
      value as string,
      /(?:className|bg-|text-|border-|#[0-9a-f]{3,8})/i,
      `${path} must contain wording only`,
    );
  }
});

test("status labels remain owned by the status presentation module", () => {
  const keys = collectLeaves(ATLAS_UI_STRINGS).map(([path]) =>
    path.split(".").at(-1));

  for (const statusKey of [
    "active",
    "void",
    "paid",
    "unpaid",
    "partiallyPaid",
    "locked",
    "inactive",
  ]) {
    assert.ok(!keys.includes(statusKey), `${statusKey} must not be duplicated`);
  }
});

test("the exported type can describe a future language dictionary", () => {
  const alternateDictionary: AtlasSharedStrings = {
    ...ATLAS_UI_STRINGS,
    actions: {
      ...ATLAS_UI_STRINGS.actions,
      save: "Alternate save wording",
    },
  };

  assert.equal(alternateDictionary.actions.save, "Alternate save wording");
  assert.deepEqual(
    Object.keys(alternateDictionary),
    Object.keys(ATLAS_UI_STRINGS),
  );
});
