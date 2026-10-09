import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import ts from "typescript";
import { onlineManager, QueryClient, QueryObserver, type QueryObserverOptions } from "@tanstack/react-query";
import {
  emptyCustomerPaymentForm,
  getCustomerPaymentFormStatus,
  isCustomerPaymentReadCurrent,
  refreshCustomerFinancialQueries,
  refreshSalesRegisterQueries,
  refreshCashBookQueries,
  refreshCustomerPaymentQueries,
  refreshChallanLockQueries,
  saveCustomerPaymentAndRefresh,
} from "../../office/customer-payment-office-model.ts";
import { isCashBookInitializationRequired } from "../../office/cash-book-office-model.ts";
import { summarizeSalesRegister, type SalesRegisterEntry } from "../sales-register-model.ts";
import { ChallanNotFoundError, ChallanUnknownOutcomeError, NEW_CUSTOMER_PAYMENT_MODES } from "../types.ts";
import {
  challanDetailLoadMessage,
  getChallanEligibility,
  getLiveChallanActionEligibility,
  submitChallanCreation,
  buildChallanReceivedPayment,
  emptyChallanReceivedPaymentForm,
  type ChallanCreationLatch,
} from "../../office/sales-office-model.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let rpcResponse: { data: Row | null; error: DatabaseError | null; status?: number } = {
  data: null,
  error: null,
};
let rpcFailure: "throw" | "reject" | null = null;
let rpcPending: Promise<typeof rpcResponse> | null = null;
let itemListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let flexibleLineListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let singleResponse: { data: Row | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          in(column: string, values: string[]) {
            calls.push(["in", column, values]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            return Promise.resolve(
              table === "challan_flexible_lines"
                ? flexibleLineListResponse
                : itemListResponse,
            );
          },
          maybeSingle() {
            calls.push(["maybeSingle"]);
            return Promise.resolve(singleResponse);
          },
        };
      },
    };
  },
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    if (rpcFailure === "throw") throw new TypeError("Failed to fetch");
    if (rpcFailure === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    return rpcPending ?? Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const { createCustomer, updateCustomer } = await import("./customer-service.ts");
const { createCustomerPaymentWithMethods } = await import("./customer-payment-service.ts");
const { initializeCashBook } = await import("../../cash-book/services/cash-book-service.ts");
const {
  ChallanServiceError,
  createChallan,
  createChallanWithReceivedPayment,
  getChallan,
  getFactoryPrintableProfile,
  updateFactoryPrintableProfile,
  updateChallan,
  voidChallan,
} = await import("./challan-service.ts");

// Creation now returns a header; assertions about saved lines use the canonical read.
async function createAndReadChallan(input: Parameters<typeof createChallan>[0]) {
  const before = calls.length;
  const header = await createChallan(input);
  assert.equal("items" in header, false);
  assert.equal("flexibleLines" in header, false);
  assert.equal(calls.slice(before).filter(([method]) => method === "from").length, 0);
  singleResponse.data = rpcResponse.data;
  return getChallan(input.factoryId, header.id);
}

const customerRow = {
  id: "customer-a",
  factory_id: "factory-a",
  name: "Anand Traders",
  address: "Address A",
  mobile: "9111111111",
  created_at: "2026-08-26T10:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
};

const factoryRow = {
  id: "factory-a",
  name: "Atlas Bricks",
  business_description: "Brick manufacturer",
  village: "Rampur",
  post_office: "Rampur Head",
  police_station: "Kotwali",
  district: "Jaipur",
  state: "Rajasthan",
  address: "Factory Road",
  mobile: "9000000000",
  gstin: "19ABCDE1234F1Z5",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
};

const challanRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  factory_id: "factory-a",
  challan_number: "42",
  challan_date: "2026-08-26",
  customer_id: "customer-a",
  customer_name_snapshot: "Anand Traders",
  customer_address_snapshot: "Address A",
  customer_mobile_snapshot: "9111111111",
  company_name_snapshot: "Atlas Bricks",
  company_business_description_snapshot: "Brick manufacturer",
  company_address_snapshot: "Factory Road",
  company_mobile_snapshot: "9000000000",
  company_village_snapshot: "Rampur",
  company_post_office_snapshot: "Rampur Head",
  company_police_station_snapshot: "Kotwali",
  company_district_snapshot: "Jaipur",
  company_state_snapshot: "Rajasthan",
  company_gstin_snapshot: "19ABCDE1234F1Z5",
  vehicle_id: "vehicle-a",
  vehicle_number_snapshot: "RJ14AB1234",
  delivery_wage_applicable_snapshot: true,
  trip_labour_wage: "450.50",
  vehicle_number: "RJ14AB1234",
  tractor_labour_rate_snapshot: "450.50",
  challan_total: "3500.00",
  status: "active",
  is_locked: false,
  voided_at: null,
  created_at: "2026-08-26T10:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
};

const itemRows = [
  {
    id: "item-a",
    factory_id: "factory-a",
    challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brick_type_id: "brick-a",
    brick_particulars_snapshot: "Class One",
    quantity: "1500",
    pricing_mode: "RATE",
    rate_per_1000_bricks: "2000",
    pricing_unit: "PER_1000_BRICKS",
    line_amount: "3000",
    line_position: 1,
    created_at: "2026-08-26T10:00:00Z",
  },
  {
    id: "item-b",
    factory_id: "factory-a",
    challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brick_type_id: "brick-b",
    brick_particulars_snapshot: "Class Two",
    quantity: "500",
    pricing_mode: "RATE",
    rate_per_1000_bricks: "1000",
    pricing_unit: "PER_1000_BRICKS",
    line_amount: "500",
    line_position: 2,
    created_at: "2026-08-26T10:00:00Z",
  },
];

const flexibleLineRows = [
  {
    id: "flex-note",
    factory_id: "factory-a",
    challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    line_type: "NOTE",
    line_category: "NON_FINANCIAL",
    order_index: 0,
    particulars: "Deliver before noon",
    quantity: null,
    rate: null,
    amount: "0.00",
    created_at: "2026-08-26T10:00:00Z",
  },
  {
    id: "flex-charge",
    factory_id: "factory-a",
    challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    line_type: "EXTRA_CHARGE",
    line_category: "OTHER_REVENUE",
    order_index: 1,
    particulars: "Loading charge",
    quantity: "2.5",
    rate: "400",
    amount: "1000",
    created_at: "2026-08-26T10:00:00Z",
  },
  {
    id: "flex-direct-charge",
    factory_id: "factory-a",
    challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    line_type: "EXTRA_CHARGE",
    line_category: "OTHER_REVENUE",
    order_index: 2,
    particulars: "Transport charge",
    quantity: null,
    rate: null,
    amount: "2000",
    created_at: "2026-08-26T10:00:00Z",
  },
];

function reset(): void {
  calls.length = 0;
  rpcFailure = null;
  rpcPending = null;
  rpcResponse = { data: null, error: null };
  itemListResponse = { data: [], error: null };
  flexibleLineListResponse = { data: [], error: null };
  singleResponse = { data: null, error: null };
}

const creationInput = {
  factoryId: "factory-a",
  challanDate: "2026-08-26",
  customerId: "customer-a",
  vehicleId: null,
  tripLabourWage: null,
  items: [{ brickTypeId: "brick-a", quantity: 1000, ratePer1000Bricks: 2000 }],
};
const creationPaths = [
  { name: "normal", rpc: "create_challan", create: () => createChallan(creationInput) },
  { name: "Received Now", rpc: "create_challan_with_received_payment", create: () => createChallanWithReceivedPayment({
    ...creationInput,
    receivedPayment: { paymentDate: "2026-08-26", amount: 1250.75, paymentMode: "upi" },
  }) },
];
const readFailure = { code: "XX000", message: "Private database failure", details: null, hint: null };

function deferredRead<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flushFinancialReads = () => new Promise<void>((resolve) => setImmediate(resolve));

// Execute the production handler body, not a handwritten copy of its decision.
// This supplies closure dependencies but does not mount React or simulate a browser.
const actionSource = ts.createSourceFile("sales-office-section.tsx", readFileSync(
  new URL("../../office/components/sales-office-section.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function capturedChallanHandler(name: "submitChallan" | "confirmVoid" | "openEdit" | "openVoid", context: Record<string, unknown>) {
  const matches: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    if ((name === "openEdit" || name === "openVoid") && ts.isJsxAttribute(node) && node.name.getText(actionSource) === "onClick"
      && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression
      && ts.isArrowFunction(node.initializer.expression)) {
      const text = node.initializer.expression.getText(actionSource);
      if (text.includes(name === "openEdit" ? 'setMode("edit")' : "setIsConfirmingVoid(true)")) matches.push(node.initializer.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(actionSource); assert.equal(matches.length, 1, `exactly one production ${name} handler`);
  const source = name === "openEdit" || name === "openVoid"
    ? `const handler = ${matches[0].getText(actionSource)};` : matches[0].getText(actionSource);
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${compiled}\nreturn ${name.startsWith("open") ? "handler" : name};`)(...Object.values(context)) as (...args: unknown[]) => Promise<void> | void;
}

function challanActionContext(client: QueryClient, challan: Awaited<ReturnType<typeof getChallan>>) {
  const state = { form: { typed: "unsaved correction" }, dialogOpen: true, mode: "detail", error: "" };
  const context: Record<string, unknown> = {
    queryClient: client, factoryId: challan.factoryId, selectedChallanId: challan.id, challan,
    lockStateCurrent: true, selectedChallanCurrent: true, isVoiding: false, isSaving: false,
    submittingRef: { current: false }, creationLatch: { current: { phase: "ready" } },
    form: state.form, getChallanEligibility, getLiveChallanActionEligibility, getChallanFormError: () => null,
    buildUpdateChallanInput: () => ({ ...creationInput, challanId: challan.id }), updateChallan, voidChallan,
    setIsSaving: () => {}, setIsVoiding: () => {}, setSuccess: () => {},
    setActionError: (error: string) => { state.error = error; }, setError: (error: string) => { state.error = error; },
    setIsConfirmingVoid: (open: boolean) => { state.dialogOpen = open; },
    setMode: (mode: string) => { state.mode = mode; },
    onSaved: () => {}, cacheSavedChallan: () => {},
    formatChallanLabel: () => "Challan", salesOfficeErrorMessage: () => "Action unavailable",
    ATLAS_UI_STRINGS,
  };
  return { context, state };
}

for (const name of ["submitChallan", "confirmVoid"] as const) {
  test(`C13A fail-first: captured ${name} blocks an invalidated held detail without rerender`, async (t) => {
    reset(); singleResponse.data = challanRow; rpcResponse.data = challanRow;
    const challan = await getChallan("factory-a", challanRow.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["office-sales-challan", "factory-a", challan.id];
    await client.fetchQuery({ queryKey: key, queryFn: async () => challan });
    const held = deferredRead<typeof challan>();
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => held.promise });
    const stop = observer.subscribe(() => {});
    const { context, state } = challanActionContext(client, challan);
    const callback = capturedChallanHandler(name, context); // Capture CURRENT=true once; never rerender.
    await client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    const read = observer.refetch();
    try {
      assert.equal(client.getQueryState(key)?.isInvalidated, true);
      assert.equal(client.getQueryState(key)?.fetchStatus, "fetching");
      await callback(name === "submitChallan" ? { preventDefault() {} } : challan);
      const writes = calls.filter(([method]) => method === "rpc");
      t.diagnostic(`invalidated=${client.getQueryState(key)?.isInvalidated}, fetchStatus=${client.getQueryState(key)?.fetchStatus}, financial RPCs=${writes.length}`);
      assert.equal(writes.length, 0, `${name} must not invoke a financial RPC using captured CURRENT state`);
      assert.equal(state.form.typed, "unsaved correction"); assert.equal(state.dialogOpen, true);
    } finally { held.resolve(challan); await read; stop(); client.clear(); }
  });
}

for (const name of ["openEdit", "submitChallan", "openVoid", "confirmVoid"] as const) {
  test(`C13A actual ${name}: retained callback blocks stale/locked data and allows read-only unlocked recovery`, async () => {
    reset(); singleResponse.data = challanRow; rpcResponse.data = challanRow;
    const challan = await getChallan("factory-a", challanRow.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["office-sales-challan", "factory-a", challan.id];
    await client.fetchQuery({ queryKey: key, queryFn: async () => challan });
    const held = deferredRead<typeof challan>(); let recover = false; let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => {
      reads++; return recover ? Promise.resolve({ ...challan, updatedAt: "2026-09-02T12:00:00Z" }) : held.promise;
    } });
    const stop = observer.subscribe(() => {});
    const { context, state } = challanActionContext(client, challan);
    if (name === "openVoid") state.dialogOpen = false;
    const callback = capturedChallanHandler(name, context);
    const attempt = () => callback(name === "submitChallan" ? { preventDefault() {}, key: "Enter" } : challan);
    const writes = () => calls.filter(([method]) => method === "rpc");
    assert.equal(getLiveChallanActionEligibility(client, "factory-a", challan.id).canEdit, true);
    await client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    const read = observer.refetch();
    try {
      await attempt(); assert.equal(writes().length, 0);
      assert.equal(state.error, ATLAS_UI_STRINGS.challan.locksOutdated);
      assert.equal(state.form.typed, "unsaved correction");
      assert.equal(state.dialogOpen, name !== "openVoid"); assert.equal(state.mode, "detail");
      held.resolve({ ...challan, isLocked: true }); await read;
      assert.equal(client.getQueryState(key)?.isInvalidated, false);
      assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
      await attempt(); assert.equal(writes().length, 0, "fresh locked cache wins over captured unlocked detail");
      recover = true;
      await refreshChallanLockQueries(client, "factory-a", [challan.id]);
      assert.equal(reads, 2); assert.equal(writes().length, 0, "Refresh only reads");
      await attempt(); // Invoke the SAME callback again; no rerender or new snapshot.
      if (name === "openEdit") assert.equal(state.mode, "edit");
      else if (name === "openVoid") assert.equal(state.dialogOpen, true);
      else {
        assert.equal(writes().length, 1);
        assert.equal(writes()[0][1], name === "submitChallan" ? "update_challan" : "void_challan");
      }
      assert.equal(state.form.typed, "unsaved correction");
    } finally { held.resolve(challan); await read; stop(); client.clear(); }
  });
}

for (const offline of [false, true]) for (const name of ["submitChallan", "confirmVoid"] as const) {
  test(`C13A ${name}: ${offline ? "offline/paused" : "failed"} replacement keeps work open and never writes during recovery`, async () => {
    reset(); singleResponse.data = challanRow; rpcResponse.data = challanRow;
    const challan = await getChallan("factory-a", challanRow.id);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["office-sales-challan", "factory-a", challan.id];
    await client.fetchQuery({ queryKey: key, queryFn: async () => challan });
    let unavailable = !offline;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => {
      if (unavailable) throw new Error("read unavailable"); return challan;
    } });
    const stop = observer.subscribe(() => {});
    const { context, state } = challanActionContext(client, challan); const callback = capturedChallanHandler(name, context);
    const attempt = () => callback(name === "submitChallan" ? { preventDefault() {} } : challan);
    try {
      if (offline) onlineManager.setOnline(false);
      await assert.rejects(refreshChallanLockQueries(client, "factory-a", [challan.id]));
      assert.equal(client.getQueryState(key)?.fetchStatus, offline ? "paused" : "idle");
      await attempt(); assert.equal(calls.filter(([method]) => method === "rpc").length, 0);
      assert.equal(state.dialogOpen, true); assert.equal(state.form.typed, "unsaved correction");
      assert.equal(state.error, ATLAS_UI_STRINGS.challan.locksOutdated);
      if (offline) await assert.rejects(refreshChallanLockQueries(client, "factory-a", [challan.id]));
      unavailable = false; onlineManager.setOnline(true);
      await refreshChallanLockQueries(client, "factory-a", [challan.id]);
      assert.equal(calls.filter(([method]) => method === "rpc").length, 0);
      await attempt(); assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    } finally { onlineManager.setOnline(true); stop(); client.clear(); }
  });
}

test("C13A routine non-invalidated background read remains conservatively blocked until complete", async () => {
  reset(); singleResponse.data = challanRow; rpcResponse.data = challanRow;
  const challan = await getChallan("factory-a", challanRow.id);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["office-sales-challan", "factory-a", challan.id];
  await client.fetchQuery({ queryKey: key, queryFn: async () => challan });
  const held = deferredRead<typeof challan>();
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => held.promise });
  const stop = observer.subscribe(() => {}); const { context } = challanActionContext(client, challan);
  const correct = capturedChallanHandler("submitChallan", context);
  const voidAction = capturedChallanHandler("confirmVoid", context);
  const read = observer.refetch(); // No invalidation or known financial write.
  try {
    assert.equal(client.getQueryState(key)?.isInvalidated, false);
    assert.equal(client.getQueryState(key)?.status, "success");
    assert.equal(client.getQueryState(key)?.fetchStatus, "fetching");
    await correct({ preventDefault() {} }); await voidAction(challan);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 0);
    held.resolve(challan); await read;
    await correct({ preventDefault() {} }); await voidAction(challan);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map((call) => call[1]), ["update_challan", "void_challan"]);
  } finally { held.resolve(challan); await read; stop(); client.clear(); }
});

test("C13A current unlocked A stays actionable while a confirmed payment invalidates and locks B", async () => {
  reset(); singleResponse.data = challanRow; rpcResponse.data = c9PaymentRow;
  const a = await getChallan("factory-a", challanRow.id);
  const b = { ...a, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aKey = ["office-sales-challan", "factory-a", a.id]; const bKey = ["office-sales-challan", "factory-a", b.id];
  await client.fetchQuery({ queryKey: aKey, queryFn: async () => a });
  await client.fetchQuery({ queryKey: bKey, queryFn: async () => b });
  const held = deferredRead<typeof b>();
  const observer = new QueryObserver(client, { queryKey: bKey, staleTime: Infinity, queryFn: () => held.promise });
  const stop = observer.subscribe(() => {});
  const aContext = challanActionContext(client, a).context; const bContext = challanActionContext(client, b).context;
  const correctA = capturedChallanHandler("submitChallan", aContext); const voidA = capturedChallanHandler("confirmVoid", aContext);
  const correctB = capturedChallanHandler("submitChallan", bContext); const voidB = capturedChallanHandler("confirmVoid", bContext);
  const input = { ...c9PaymentInput, allocations: [{ challanId: b.id, amount: 100 }] };
  const save = saveCustomerPaymentAndRefresh(input, createCustomerPaymentWithMethods, () => {}, () => {},
    () => refreshCustomerPaymentQueries(client, input.factoryId, input.customerId, [b.id]));
  try {
    await flushFinancialReads();
    assert.equal(client.getQueryState(aKey)?.isInvalidated, false);
    assert.equal(client.getQueryState(aKey)?.fetchStatus, "idle");
    assert.equal(client.getQueryState(bKey)?.isInvalidated, true);
    await correctB({ preventDefault() {} }); await voidB(b);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1, "only the confirmed payment write");
    rpcResponse.data = challanRow;
    await correctA({ preventDefault() {} }); await voidA(a);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map((call) => call[1]), ["create_customer_payment_with_methods", "update_challan", "void_challan"]);
    held.resolve({ ...b, isLocked: true }); await save;
    await correctB({ preventDefault() {} }); await voidB(b);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 3);
  } finally { held.resolve(b); await save; stop(); client.clear(); }
});

test("C13A absent, wrong-identity, incomplete, void and unavailable cache never fabricate action eligibility", async () => {
  reset(); singleResponse.data = challanRow;
  const challan = await getChallan("factory-a", challanRow.id);
  const client = new QueryClient(); const key = ["office-sales-challan", "factory-a", challan.id];
  try {
    assert.equal(getLiveChallanActionEligibility(client, "factory-a", challan.id).canEdit, false);
    for (const data of [
      { ...challan, factoryId: "factory-b" }, { ...challan, id: "other-challan" },
      { ...challan, items: undefined }, { ...challan, flexibleLines: undefined },
      { ...challan, isLocked: undefined }, { ...challan, status: "void" }, { ...challan, isLocked: true },
    ]) {
      client.setQueryData(key, data);
      const eligibility = getLiveChallanActionEligibility(client, "factory-a", challan.id);
      assert.equal(eligibility.canEdit, false); assert.equal(eligibility.canVoid, false);
    }
    client.setQueryData(key, challan, { updatedAt: 0 });
    assert.equal(getLiveChallanActionEligibility(client, "factory-a", challan.id).canEdit, false);
    client.setQueryData(key, challan); const query = client.getQueryCache().find({ queryKey: key, exact: true })!;
    query.setState({ status: "error", error: new Error("read error") });
    assert.equal(getLiveChallanActionEligibility(client, "factory-a", challan.id).canVoid, false);
    assert.equal(getLiveChallanActionEligibility(client, "factory-b", challan.id).canEdit, false);
  } finally { client.clear(); }
});

const cashBookKey = (date: string, factoryId = "factory-a") => ["office-cash-book-day", factoryId, date];
const cashBookPaymentDate = "2026-09-02"; // D2 deliberately differs from D1 (2026-08-26).

const c9PaymentInput = { factoryId: "factory-a", customerId: "customer-a", paymentDate: cashBookPaymentDate,
  amount: 100, methods: [{ mode: "upi" as const, splitAmount: null }],
  allocations: [{ challanId: challanRow.id, amount: 100 }] };
const c9PaymentRow = { id: "11111111-1111-4111-8111-111111111111", factory_id: "factory-a",
  customer_id: "customer-a", customer_name_snapshot: "Customer A", customer_address_snapshot: "Address A",
  customer_mobile_snapshot: "", company_name_snapshot: "Atlas", company_business_description_snapshot: "",
  company_address_snapshot: "", company_mobile_snapshot: "", payment_date: cashBookPaymentDate,
  amount: 100, payment_mode: "upi", note: null, created_at: "2026-09-02T10:00:00Z" };

function cashBookReadCurrent(client: QueryClient, observer: Pick<QueryObserver, "getCurrentResult">, key: readonly string[]) {
  const result = observer.getCurrentResult();
  return !result.isPaused && isCustomerPaymentReadCurrent({ isFetching: result.isFetching,
    error: result.error, dataUpdatedAt: result.dataUpdatedAt, isInvalidated: client.getQueryState(key)?.isInvalidated });
}

test("C9A P1: customer payment cannot reuse the pending Received Now first load", async () => {
  reset(); rpcResponse.data = challanRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate);
  const requests = [deferredRead<string>(), deferredRead<string>(), deferredRead<string>()];
  let starts = 0; let receivedClears = 0; let paymentClears = 0; let paymentCompleted = false;
  // These reads deliberately ignore AbortSignal, as the current services do.
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => requests[starts++].promise });
  const unsubscribe = observer.subscribe(() => {});
  const latch: ChallanCreationLatch = { phase: "ready" };
  const received = submitChallanCreation(latch,
    () => createChallanWithReceivedPayment({ ...creationInput,
      receivedPayment: { paymentDate: cashBookPaymentDate, amount: 1250.75, paymentMode: "upi" } }),
    () => { receivedClears++; }, (header) => refreshCashBookQueries(client,
      { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }));
  let payment: ReturnType<typeof saveCustomerPaymentAndRefresh> | undefined;
  try {
    await flushFinancialReads(); assert.equal(starts, 2); assert.equal(latch.phase, "saved");
    rpcResponse.data = c9PaymentRow;
    payment = saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => { paymentClears++; }, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]))
      .then((saved) => { paymentCompleted = true; return saved; });
    await flushFinancialReads();
    requests[1].resolve("BEFORE SECOND PAYMENT"); await flushFinancialReads();
    assert.equal(cashBookReadCurrent(client, observer, key), false,
      "response started before the second committed payment must not become CURRENT");
    assert.equal(starts, 3, "second payment requires its own replacement read");
    assert.equal(paymentCompleted, false); assert.equal(client.getQueryState(key)?.isInvalidated, true);
    assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
    requests[2].resolve("AFTER BOTH PAYMENTS");
    const [receivedSaved, paymentSaved] = await Promise.all([received, payment]);
    assert.equal(receivedSaved.status, "saved");
    assert.ok(paymentSaved.status === "saved" && paymentSaved.refresh === "current");
    assert.equal(paymentSaved.payment.id, c9PaymentRow.id); assert.equal(latch.savedId, challanRow.id);
    assert.equal(receivedClears, 1); assert.equal(paymentClears, 1);
    assert.equal(cashBookReadCurrent(client, observer, key), true);
    requests[0].resolve("BEFORE EITHER PAYMENT"); await flushFinancialReads();
    assert.equal(client.getQueryData(key), "AFTER BOTH PAYMENTS");
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name),
      ["create_challan_with_received_payment", "create_customer_payment_with_methods"]);
  } finally {
    requests.forEach((request) => request.resolve("CLEANUP")); await Promise.all([received, payment]);
    unsubscribe(); client.clear();
  }
});

test("C9A P2: cancellation must replace a post-initialization read instead of restoring obsolete P3201", async () => {
  reset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate); let initialized = false; let starts = 0;
  const old = deferredRead<string>(); const fresh = deferredRead<string>();
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => {
    starts++; if (!initialized) return Promise.reject(Object.assign(new Error("Initialize first"), { code: "P3201" }));
    return starts === 2 ? old.promise : fresh.promise;
  } });
  const unsubscribe = observer.subscribe(() => {});
  let initializationRead: Promise<void> | undefined;
  let received: ReturnType<typeof submitChallanCreation> | undefined;
  try {
    await flushFinancialReads(); assert.equal(isCashBookInitializationRequired(observer.getCurrentResult().error), true);
    rpcResponse.data = { factory_id: "factory-a", start_date: cashBookPaymentDate, opening_balance: 50,
      created_at: "2026-09-02T00:00:00Z" };
    await initializeCashBook({ factoryId: "factory-a", startDate: cashBookPaymentDate, openingBalance: 50 });
    initialized = true;
    initializationRead = client.invalidateQueries({ queryKey: key, exact: true });
    await flushFinancialReads(); assert.equal(starts, 2); assert.equal(observer.getCurrentResult().error, null);
    assert.equal(observer.getCurrentResult().isFetching, true);
    rpcResponse.data = challanRow;
    received = submitChallanCreation({ phase: "ready" },
      () => createChallanWithReceivedPayment({ ...creationInput,
        receivedPayment: { paymentDate: cashBookPaymentDate, amount: 1250.75, paymentMode: "upi" } }),
      () => {}, (header) => refreshCashBookQueries(client,
        { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }));
    await flushFinancialReads();
    assert.equal(isCashBookInitializationRequired(observer.getCurrentResult().error), false,
      "cancellation-restored P3201 must not make initialized Cash Book return to setup");
    assert.equal(starts, 3); assert.equal(observer.getCurrentResult().isFetching, true);
    assert.equal(cashBookReadCurrent(client, observer, key), false);
    fresh.resolve("INITIALIZED POST-SAVE DAY");
    const saved = await received; assert.ok(saved.status === "saved" && !saved.postSaveFailed);
    old.resolve("BEFORE PAYMENT"); await initializationRead; await flushFinancialReads();
    assert.equal(client.getQueryData(key), "INITIALIZED POST-SAVE DAY");
    assert.equal(client.getQueryState(key)?.status, "success"); assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
    assert.equal(cashBookReadCurrent(client, observer, key), true);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name),
      ["initialize_cash_book", "create_challan_with_received_payment"]);
  } finally {
    old.resolve("CLEANUP"); fresh.resolve("CLEANUP"); await Promise.all([initializationRead, received]);
    unsubscribe(); client.clear();
  }
});

test("C9A combined: both saved paths replace obsolete P3201 and late ignored-signal responses cannot overwrite latest data", async () => {
  reset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate); let initialized = false; let starts = 0;
  const requests = [deferredRead<string>(), deferredRead<string>(), deferredRead<string>()];
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => {
    starts++; if (!initialized) return Promise.reject(Object.assign(new Error("Initialize first"), { code: "P3201" }));
    return requests[starts - 2].promise; // Deliberately ignore the cancelled network signal.
  } });
  const unsubscribe = observer.subscribe(() => {});
  let initializationRead: Promise<void> | undefined;
  let received: ReturnType<typeof submitChallanCreation> | undefined;
  let payment: ReturnType<typeof saveCustomerPaymentAndRefresh> | undefined;
  const latch: ChallanCreationLatch = { phase: "ready" }; let receivedClears = 0; let paymentClears = 0;
  try {
    await flushFinancialReads(); assert.equal(isCashBookInitializationRequired(observer.getCurrentResult().error), true);
    rpcResponse.data = { factory_id: "factory-a", start_date: cashBookPaymentDate, opening_balance: 50,
      created_at: "2026-09-02T00:00:00Z" };
    await initializeCashBook({ factoryId: "factory-a", startDate: cashBookPaymentDate, openingBalance: 50 });
    initialized = true; initializationRead = client.invalidateQueries({ queryKey: key, exact: true });
    await flushFinancialReads(); assert.equal(starts, 2);
    rpcResponse.data = challanRow;
    received = submitChallanCreation(latch,
      () => createChallanWithReceivedPayment({ ...creationInput,
        receivedPayment: { paymentDate: cashBookPaymentDate, amount: 1250.75, paymentMode: "upi" } }),
      () => { receivedClears++; }, (header) => refreshCashBookQueries(client,
        { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }));
    await flushFinancialReads(); assert.equal(starts, 3); assert.equal(observer.getCurrentResult().error, null);
    rpcResponse.data = c9PaymentRow;
    payment = saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => { paymentClears++; }, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    await flushFinancialReads(); assert.equal(starts, 4); assert.equal(observer.getCurrentResult().error, null);
    assert.equal(cashBookReadCurrent(client, observer, key), false);
    assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
    // Complete the newest request BEFORE both obsolete network responses.
    requests[2].resolve("LATEST AFTER BOTH SAVES");
    const [receivedSaved, paymentSaved] = await Promise.all([received, payment]);
    assert.equal(receivedSaved.status, "saved");
    assert.ok(paymentSaved.status === "saved" && paymentSaved.refresh === "current");
    assert.equal(latch.savedId, challanRow.id); assert.equal(paymentSaved.payment.id, c9PaymentRow.id);
    requests[1].resolve("BEFORE ORDINARY PAYMENT"); requests[0].resolve("BEFORE RECEIVED NOW");
    await initializationRead; await flushFinancialReads();
    assert.equal(client.getQueryData(key), "LATEST AFTER BOTH SAVES");
    assert.equal(client.getQueryState(key)?.status, "success"); assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
    assert.equal(client.getQueryState(key)?.dataUpdateCount, 1); assert.equal(client.getQueryState(key)?.isInvalidated, false);
    assert.equal(isCashBookInitializationRequired(observer.getCurrentResult().error), false);
    assert.equal(cashBookReadCurrent(client, observer, key), true);
    assert.equal(receivedClears, 1); assert.equal(paymentClears, 1);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name),
      ["initialize_cash_book", "create_challan_with_received_payment", "create_customer_payment_with_methods"]);
    assert.deepEqual(await submitChallanCreation(latch, creationPaths[1].create, () => {}, () => {}), { status: "blocked" });
  } finally {
    requests.forEach((request) => request.resolve("CLEANUP")); await Promise.all([initializationRead, received, payment]);
    unsubscribe(); client.clear();
  }
});

test("C9A ordinary payment preserves legitimate idle P3201 without a day read or initialization write", async () => {
  reset(); rpcResponse.data = c9PaymentRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate); let starts = 0;
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => {
    starts++; throw Object.assign(new Error("Initialize first"), { code: "P3201" });
  } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await flushFinancialReads(); assert.equal(starts, 1);
    const saved = await saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => {}, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    assert.ok(saved.status === "saved" && saved.refresh === "current");
    assert.equal(starts, 1); assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
    assert.equal(isCashBookInitializationRequired(observer.getCurrentResult().error), true);
    assert.equal(cashBookReadCurrent(client, observer, key), false); assert.equal(client.getQueryData(key), undefined);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), ["create_customer_payment_with_methods"]);
  } finally { unsubscribe(); client.clear(); }
});

test("C9A ordinary payment preserves cached-day scope, disabled rules and unrelated live requests", async () => {
  reset(); rpcResponse.data = c9PaymentRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = cashBookKey(cashBookPaymentDate); const old = deferredRead<string>(); const fresh = deferredRead<string>();
  let starts = 0; let confirmed = false; let inactiveStarts = 0; let disabledStarts = 0;
  const queryFn = () => { starts++; if (starts > 1) assert.equal(confirmed, true); return starts === 1 ? old.promise : fresh.promise; };
  const active = new QueryObserver(client, { queryKey: key, queryFn });
  const hidden = new QueryObserver(client, { queryKey: key, queryFn });
  // Ordinary payments previously invalidated/refetched every registered factory day,
  // including cached inactive days, without narrowing by the new payment's date.
  const inactiveKey = cashBookKey("2026-09-01"); client.setQueryData(inactiveKey, "OLD INACTIVE");
  new QueryObserver(client, { queryKey: inactiveKey, staleTime: Infinity, queryFn: async () => {
    inactiveStarts++; assert.equal(confirmed, true); return "FRESH INACTIVE";
  } });
  const disabledKeys = [cashBookKey("2026-09-03"), cashBookKey("2026-09-04")];
  const disabled = disabledKeys.map((queryKey) => {
    client.setQueryData(queryKey, "DISABLED CACHE");
    return new QueryObserver(client, { queryKey, enabled: false, queryFn: async () => { disabledStarts++; return "INVALID"; } });
  });
  const foreignKey = cashBookKey(cashBookPaymentDate, "factory-b"); const moduleKey = ["office-production", "factory-a"];
  const foreign = deferredRead<string>(); const deferredModuleRead = deferredRead<string>(); let foreignStarts = 0; let moduleStarts = 0;
  const foreignObserver = new QueryObserver(client, { queryKey: foreignKey, queryFn: () => { foreignStarts++; return foreign.promise; } });
  const moduleObserver = new QueryObserver(client, { queryKey: moduleKey, queryFn: () => { moduleStarts++; return deferredModuleRead.promise; } });
  const subscriptions = [active, hidden, disabled[0], foreignObserver, moduleObserver].map((observer) => observer.subscribe(() => {}));
  const size = client.getQueryCache().getAll().length;
  const save = saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
    () => { confirmed = true; }, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
  try {
    await flushFinancialReads(); assert.equal(starts, 2); assert.equal(inactiveStarts, 1); assert.equal(disabledStarts, 0);
    assert.equal(client.getQueryData(inactiveKey), "FRESH INACTIVE");
    disabledKeys.forEach((queryKey) => assert.equal(client.getQueryState(queryKey)?.isInvalidated, true));
    assert.equal(client.getQueryState(foreignKey)?.fetchStatus, "fetching"); assert.equal(foreignStarts, 1);
    assert.equal(client.getQueryState(moduleKey)?.fetchStatus, "fetching"); assert.equal(moduleStarts, 1);
    assert.equal(client.getQueryCache().getAll().length, size);
    fresh.resolve("LATEST"); const saved = await save;
    assert.ok(saved.status === "saved" && saved.refresh === "current");
    old.resolve("OBSOLETE"); foreign.resolve("FOREIGN"); deferredModuleRead.resolve("MODULE"); await flushFinancialReads();
    assert.equal(cashBookReadCurrent(client, active, key), true); assert.equal(hidden.getCurrentResult().data, "LATEST");
    assert.equal(client.getQueryData(foreignKey), "FOREIGN"); assert.equal(client.getQueryData(moduleKey), "MODULE");
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally {
    old.resolve(""); fresh.resolve(""); foreign.resolve(""); deferredModuleRead.resolve(""); await save;
    subscriptions.forEach((unsubscribe) => unsubscribe()); client.clear();
  }
});

test("C9A ordinary payment paused Cash Book refresh preserves saved ID and reconnect recovery is read-only", { timeout: 3000 }, async () => {
  reset(); rpcResponse.data = c9PaymentRow;
  const wasOnline = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.mount();
  const key = cashBookKey(cashBookPaymentDate); client.setQueryData(key, "OLD BALANCE");
  const fresh = deferredRead<string>(); let starts = 0; let draftClears = 0;
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => { starts++; return fresh.promise; } });
  const unsubscribe = observer.subscribe(() => {});
  const refresh = () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]);
  try {
    const saved = await saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => { draftClears++; onlineManager.setOnline(false); }, () => {}, refresh);
    assert.ok(saved.status === "saved" && saved.refresh === "outdated");
    assert.equal(saved.payment.id, c9PaymentRow.id); assert.equal(draftClears, 1);
    assert.equal(observer.getCurrentResult().isPaused, true); assert.equal(cashBookReadCurrent(client, observer, key), false);
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(refresh);
    assert.equal(starts, 0); assert.equal(client.getQueryData(key), "OLD BALANCE");
    onlineManager.setOnline(true); const recovery = refresh();
    await flushFinancialReads(); assert.ok(starts > 0); assert.equal(cashBookReadCurrent(client, observer, key), false);
    fresh.resolve("FRESH BALANCE"); await recovery;
    assert.equal(cashBookReadCurrent(client, observer, key), true); assert.equal(draftClears, 1);
    assert.equal(saved.payment.id, c9PaymentRow.id);
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), ["create_customer_payment_with_methods"]);
  } finally {
    fresh.resolve(""); unsubscribe(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline);
  }
});

for (const path of ["Received Now", "ordinary payment"] as const) {
  test(`C9A ${path}: disabled second observer cannot suppress an enabled Cash Book replacement`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = cashBookKey(cashBookPaymentDate); client.setQueryData(key, "OLD"); let starts = 0;
    const options = { queryKey: key, staleTime: Infinity, queryFn: async () => { starts++; return "FRESH"; } };
    const enabled = new QueryObserver(client, options); const unsubscribe = enabled.subscribe(() => {});
    const disabled = new QueryObserver(client, { ...options, enabled: false }); const stopDisabled = disabled.subscribe(() => {});
    try {
      const query = client.getQueryCache().find({ queryKey: key, exact: true })!;
      assert.equal(query.isActive(), true); assert.equal((query.options as QueryObserverOptions).enabled, false);
      if (path === "Received Now") await refreshCashBookQueries(client, { factoryId: "factory-a", paymentDate: cashBookPaymentDate });
      else await refreshCustomerPaymentQueries(client, "factory-a", "customer-a", []);
      assert.equal(starts, 1); assert.equal(cashBookReadCurrent(client, enabled, key), true);
      assert.equal(enabled.getCurrentResult().data, "FRESH"); assert.equal(disabled.getCurrentResult().data, "FRESH");
    } finally { unsubscribe(); stopDisabled(); client.clear(); }
  });
}

test("Pay Later leaves Cash Book requests and caches untouched after exactly one creation RPC", async () => {
  reset(); rpcResponse.data = challanRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = deferredRead<string>(); let starts = 0;
  const key = cashBookKey(cashBookPaymentDate);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => { starts++; return pending.promise; } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const saved = await submitChallanCreation({ phase: "ready" }, () => createChallan(creationInput), () => {},
      (header) => refreshCashBookQueries(client, { factoryId: header.factoryId, paymentDate: null }));
    assert.ok(saved.status === "saved" && !saved.postSaveFailed);
    assert.equal(starts, 1); assert.equal(client.getQueryState(key)?.isInvalidated, false);
    assert.equal(client.getQueryState(key)?.fetchStatus, "fetching");
    pending.resolve("UNTOUCHED"); await flushFinancialReads();
    assert.equal(client.getQueryData(key), "UNTOUCHED");
    assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), ["create_challan"]);
  } finally { pending.resolve("UNTOUCHED"); unsubscribe(); client.clear(); }
});

for (const paymentMode of NEW_CUSTOMER_PAYMENT_MODES) {
  test(`Received Now ${paymentMode}: immutable D2 targets cached same/later days, not D1/earlier/foreign dates`, async () => {
    reset(); const response = deferredRead<typeof rpcResponse>(); rpcPending = response.promise;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [cashBookKey("2026-08-26"), cashBookKey("2026-09-01"), cashBookKey(cashBookPaymentDate),
      cashBookKey("2026-09-03"), cashBookKey("2026-09-04"), cashBookKey(cashBookPaymentDate, "factory-b"),
      ["office-sales-register", "factory-a", "2026-09-02", "2026-09-02"]];
    const starts = keys.map(() => 0); let confirmed = false;
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, "OLD");
      return new QueryObserver(client, { queryKey, staleTime: Infinity,
        queryFn: async () => { starts[index]++; assert.equal(confirmed, true); return "POST-SAVE"; } });
    });
    const subscriptions = [0, 1, 2, 3, 5, 6].map((index) => observers[index].subscribe(() => {}));
    const cacheSize = client.getQueryCache().getAll().length;
    let form = { ...emptyChallanReceivedPaymentForm(cashBookPaymentDate), choice: "received_now" as const,
      amount: "1250.75", paymentMode };
    const submitted = buildChallanReceivedPayment(form, 3500)!;
    const latch: ChallanCreationLatch = { phase: "ready" }; let draftClears = 0;
    const save = submitChallanCreation(latch,
      () => createChallanWithReceivedPayment({ ...creationInput, receivedPayment: submitted }),
      () => { confirmed = true; draftClears++; },
      (header) => refreshCashBookQueries(client, { factoryId: header.factoryId, paymentDate: submitted.paymentDate }));
    form = { ...form, paymentDate: "2026-09-10" }; // Changed while the RPC is still pending.
    response.resolve({ data: challanRow, error: null });
    try {
      const saved = await save;
      assert.ok(saved.status === "saved" && !saved.postSaveFailed);
      assert.equal(saved.header.id, challanRow.id); assert.equal(latch.savedId, challanRow.id); assert.equal(draftClears, 1);
      assert.equal(submitted.paymentDate, cashBookPaymentDate); assert.equal(form.paymentDate, "2026-09-10");
      assert.deepEqual(starts, [0, 0, 1, 1, 0, 0, 0]);
      keys.forEach((key, index) => assert.equal(client.getQueryState(key)?.isInvalidated, index === 4));
      assert.equal(client.getQueryData(keys[0]), "OLD"); assert.equal(client.getQueryData(keys[1]), "OLD");
      assert.equal(client.getQueryCache().getAll().length, cacheSize, "no unseen day queries manufactured");
      // Inactive affected days read when opened, and cannot be current while that read is pending.
      const fresh = deferredRead<string>();
      const next = new QueryObserver(client, { queryKey: keys[4], staleTime: Infinity, queryFn: () => fresh.promise });
      const unsubscribe = next.subscribe(() => {});
      assert.equal(client.getQueryState(keys[4])?.isInvalidated, true);
      assert.equal(next.getCurrentResult().isFetching, true);
      fresh.resolve("FRESH LATER DAY"); await flushFinancialReads();
      assert.equal(next.getCurrentResult().data, "FRESH LATER DAY"); assert.equal(client.getQueryState(keys[4])?.isInvalidated, false);
      unsubscribe();
      assert.deepEqual(await submitChallanCreation(latch, () => createChallan(creationInput), () => {}, () => {}), { status: "blocked" });
      const writes = calls.filter(([method]) => method === "rpc"); assert.equal(writes.length, 1);
      assert.equal(writes[0][1], "create_challan_with_received_payment");
      assert.equal((writes[0][2] as Row).p_payment_date, cashBookPaymentDate);
      assert.equal((writes[0][2] as Row).p_payment_mode, paymentMode);
    } finally { subscriptions.forEach((unsubscribe) => unsubscribe()); client.clear(); }
  });
}

test("Received Now cancels pre-save first loads for multiple observers without cancelling unrelated requests", async () => {
  reset(); rpcResponse.data = challanRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = deferredRead<string>(); const fresh = deferredRead<string>();
  const otherFactory = deferredRead<string>(); const otherModule = deferredRead<string>();
  let confirmed = false; const starts: boolean[] = []; let foreignStarts = 0; let moduleStarts = 0;
  const key = cashBookKey(cashBookPaymentDate);
  const queryFn = () => { starts.push(confirmed); return starts.length === 1 ? old.promise : fresh.promise; };
  const observer = new QueryObserver(client, { queryKey: key, queryFn });
  const hidden = new QueryObserver(client, { queryKey: key, queryFn });
  const foreignKey = cashBookKey(cashBookPaymentDate, "factory-b");
  const moduleKey = ["office-customer-payment-summary", "factory-a", "customer-a"];
  const foreign = new QueryObserver(client, { queryKey: foreignKey, queryFn: () => { foreignStarts++; return otherFactory.promise; } });
  const moduleObserver = new QueryObserver(client, { queryKey: moduleKey, queryFn: () => { moduleStarts++; return otherModule.promise; } });
  const subscriptions = [observer, hidden, foreign, moduleObserver].map((item) => item.subscribe(() => {}));
  const latch: ChallanCreationLatch = { phase: "ready" }; let completed = false;
  const save = submitChallanCreation(latch, creationPaths[1].create, () => { confirmed = true; },
    (header) => refreshCashBookQueries(client, { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }))
    .then((saved) => { completed = true; return saved; });
  try {
    await flushFinancialReads(); old.resolve("PRE-SAVE"); await flushFinancialReads();
    assert.deepEqual(starts, [false, true]); assert.equal(completed, false);
    assert.equal(client.getQueryData(key), undefined); assert.equal(client.getQueryState(key)?.error, null);
    assert.equal(latch.savedId, challanRow.id);
    assert.equal(client.getQueryState(foreignKey)?.fetchStatus, "fetching"); assert.equal(foreignStarts, 1);
    assert.equal(client.getQueryState(moduleKey)?.fetchStatus, "fetching"); assert.equal(moduleStarts, 1);
    fresh.resolve("POST-SAVE"); const saved = await save;
    assert.ok(saved.status === "saved" && !saved.postSaveFailed);
    assert.equal(hidden.getCurrentResult().data, "POST-SAVE"); assert.equal(observer.getCurrentResult().data, "POST-SAVE");
    otherFactory.resolve("UNCHANGED FACTORY"); otherModule.resolve("UNCHANGED MODULE"); await flushFinancialReads();
    assert.equal(client.getQueryData(foreignKey), "UNCHANGED FACTORY"); assert.equal(client.getQueryData(moduleKey), "UNCHANGED MODULE");
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally { old.resolve(""); fresh.resolve(""); otherFactory.resolve(""); otherModule.resolve(""); await save;
    subscriptions.forEach((unsubscribe) => unsubscribe()); client.clear(); }
});

test("Cash Book skips P3201 and disabled queries, preserves setup and later permits a legitimate initialized read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = cashBookKey(cashBookPaymentDate); let initialized = false; let starts = 0;
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => {
    starts++; if (!initialized) throw Object.assign(new Error("Initialize first"), { code: "P3201" });
    return "REAL INITIALIZED DAY";
  } });
  const unsubscribe = observer.subscribe(() => {});
  const disabledKeys = [cashBookKey("2026-09-03"), cashBookKey("2026-09-04")]; let disabledStarts = 0;
  const disabled = disabledKeys.map((queryKey) => new QueryObserver(client, { queryKey, enabled: false,
    queryFn: async () => { disabledStarts++; return "DISABLED"; } }));
  const stopDisabled = disabled[0].subscribe(() => {});
  try {
    await flushFinancialReads(); assert.equal(starts, 1); assert.equal(client.getQueryState(key)?.data, undefined);
    const size = client.getQueryCache().getAll().length;
    await refreshCashBookQueries(client, { factoryId: "factory-a", paymentDate: cashBookPaymentDate });
    await refreshCashBookQueries(client, { factoryId: "factory-a", businessDate: cashBookPaymentDate });
    await refreshCashBookQueries(client, { factoryId: "factory-a", businessDate: "2026-09-03" });
    await refreshCashBookQueries(client, { factoryId: "factory-a", businessDate: "2026-09-04" });
    assert.equal(starts, 1); assert.equal(disabledStarts, 0); assert.equal(client.getQueryState(key)?.isInvalidated, true);
    assert.equal((client.getQueryState(key)?.error as Error & { code: string }).code, "P3201");
    assert.equal(client.getQueryCache().getAll().length, size);
    disabledKeys.forEach((queryKey) => assert.equal(client.getQueryState(queryKey)?.isInvalidated, true));
    initialized = true; await client.invalidateQueries({ queryKey: key, exact: true }, { throwOnError: true });
    assert.equal(starts, 2); assert.equal(client.getQueryData(key), "REAL INITIALIZED DAY");
    assert.equal(client.getQueryState(key)?.isInvalidated, false);
  } finally { unsubscribe(); stopDisabled(); client.clear(); }
});

test("failed Cash Book read preserves SAVED and real cached amounts until read-only empty-day recovery", async () => {
  reset(); rpcResponse.data = challanRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate);
  const oldDay = { summary: { openingBalance: 100, totalMoneyIn: 200, totalMoneyOut: 50, closingBalance: 250 }, moneyIn: [{ amount: 200 }], moneyOut: [{ amount: 50 }] };
  const emptyDay = { summary: { openingBalance: 250, totalMoneyIn: 0, totalMoneyOut: 0, closingBalance: 250 }, moneyIn: [], moneyOut: [] };
  client.setQueryData(key, oldDay); let fail = true;
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { if (fail) throw new Error("Read unavailable"); return emptyDay; } });
  const unsubscribe = observer.subscribe(() => {}); let draft: string | null = "draft";
  const latch: ChallanCreationLatch = { phase: "ready" };
  const current = () => !observer.getCurrentResult().isPaused && isCustomerPaymentReadCurrent({
    isFetching: observer.getCurrentResult().isFetching, error: observer.getCurrentResult().error,
    dataUpdatedAt: observer.getCurrentResult().dataUpdatedAt, isInvalidated: client.getQueryState(key)?.isInvalidated,
  });
  try {
    const saved = await submitChallanCreation(latch, creationPaths[1].create, () => { draft = null; },
      (header) => refreshCashBookQueries(client, { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }));
    assert.ok(saved.status === "saved" && saved.postSaveFailed); assert.equal(saved.header.id, challanRow.id);
    assert.equal(latch.savedId, challanRow.id); assert.equal(draft, null); assert.equal(current(), false);
    assert.deepEqual(client.getQueryData(key), oldDay, "hidden cached figures are not rewritten as fabricated zeroes");
    const displayed = current() ? observer.getCurrentResult().data : null; assert.equal(displayed, null);
    fail = false; await refreshCashBookQueries(client, { factoryId: "factory-a", businessDate: cashBookPaymentDate });
    assert.equal(current(), true); assert.deepEqual(observer.getCurrentResult().data, emptyDay);
    assert.deepEqual(await submitChallanCreation(latch, creationPaths[1].create, () => {}, () => {}), { status: "blocked" });
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally { unsubscribe(); client.clear(); }
});

test("offline Cash Book remains outdated through repeated Refresh until reconnect performs successful reads", { timeout: 3000 }, async () => {
  reset(); rpcResponse.data = challanRow;
  const wasOnline = onlineManager.isOnline();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); client.mount();
  const key = cashBookKey(cashBookPaymentDate); client.setQueryData(key, "OLD");
  const fresh = deferredRead<string>(); let starts = 0;
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => { starts++; return fresh.promise; } });
  const unsubscribe = observer.subscribe(() => {}); const latch: ChallanCreationLatch = { phase: "ready" }; let draft: string | null = "draft";
  const current = () => !observer.getCurrentResult().isPaused && isCustomerPaymentReadCurrent({
    isFetching: observer.getCurrentResult().isFetching, error: observer.getCurrentResult().error,
    dataUpdatedAt: observer.getCurrentResult().dataUpdatedAt, isInvalidated: client.getQueryState(key)?.isInvalidated,
  });
  try {
    const saved = await submitChallanCreation(latch, creationPaths[1].create, () => { draft = null; onlineManager.setOnline(false); },
      (header) => refreshCashBookQueries(client, { factoryId: header.factoryId, paymentDate: cashBookPaymentDate }));
    assert.ok(saved.status === "saved" && saved.postSaveFailed); assert.equal(latch.savedId, challanRow.id); assert.equal(draft, null);
    assert.equal(current(), false); assert.equal(observer.getCurrentResult().isPaused, true);
    const target = { factoryId: "factory-a", businessDate: cashBookPaymentDate };
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(() => refreshCashBookQueries(client, target));
    assert.equal(starts, 0); assert.equal(current(), false);
    onlineManager.setOnline(true); let completed = false;
    const refresh = refreshCashBookQueries(client, target).then(() => { completed = true; });
    await flushFinancialReads(); assert.equal(current(), false); assert.equal(completed, false); assert.ok(starts > 0);
    fresh.resolve("AUTHORITATIVE"); await refresh; assert.equal(current(), true);
    assert.deepEqual(await submitChallanCreation(latch, creationPaths[1].create, () => {}, () => {}), { status: "blocked" });
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally { fresh.resolve(""); unsubscribe(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline); }
});

test("overlapping Cash Book Refresh discards pre-save and interrupted reads until the final replacement completes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = cashBookKey(cashBookPaymentDate);
  const requests = [deferredRead<string>(), deferredRead<string>(), deferredRead<string>()]; let starts = 0;
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => requests[starts++].promise });
  const unsubscribe = observer.subscribe(() => {});
  let firstComplete = false; let secondComplete = false;
  const first = refreshCashBookQueries(client, { factoryId: "factory-a", paymentDate: cashBookPaymentDate })
    .then(() => { firstComplete = true; }, () => {});
  try {
    await flushFinancialReads(); assert.equal(starts, 2);
    const second = refreshCashBookQueries(client, { factoryId: "factory-a", businessDate: cashBookPaymentDate })
      .then(() => { secondComplete = true; });
    await flushFinancialReads(); assert.equal(starts, 3);
    requests[0].resolve("PRE-SAVE"); requests[1].resolve("INTERRUPTED"); await flushFinancialReads();
    assert.equal(firstComplete, false); assert.equal(secondComplete, false);
    assert.equal(client.getQueryData(key), undefined); assert.equal(client.getQueryState(key)?.error, null);
    assert.equal(client.getQueryState(key)?.isInvalidated, true); assert.equal(observer.getCurrentResult().isFetching, true);
    requests[2].resolve("FINAL POST-SAVE"); await Promise.all([first, second]);
    assert.equal(secondComplete, true); assert.equal(observer.getCurrentResult().data, "FINAL POST-SAVE");
    assert.equal(client.getQueryState(key)?.isInvalidated, false);
  } finally { requests.forEach((request) => request.resolve("")); await first; unsubscribe(); client.clear(); }
});

function registerEntry(paidAmount = 0): SalesRegisterEntry {
  return { challanId: challanRow.id, challanNumber: "42", challanDate: challanRow.challan_date,
    customerNameSnapshot: "Customer A", items: [{ particularsSnapshot: "Brick", quantity: 1000, linePosition: 1 }],
    brickRevenue: 3500, otherRevenue: 0, totalRevenue: 3500, vehicleNumber: "", status: "active",
    paymentState: paidAmount > 0 ? "partially_paid" : "unpaid", paidAmount, outstandingAmount: 3500 - paidAmount };
}

function customerReadCurrent(client: QueryClient, queryKey: readonly string[]) {
  const state = client.getQueryState(queryKey)!;
  return isCustomerPaymentReadCurrent({
    isFetching: state.fetchStatus === "fetching", error: state.error,
    isInvalidated: state.isInvalidated, dataUpdatedAt: state.dataUpdatedAt,
  });
}

test("C10 fail-first: a pre-payment Register first load cannot become CURRENT", async () => {
  reset(); rpcResponse.data = c9PaymentRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"];
  const old = deferredRead<SalesRegisterEntry[]>(); const fresh = deferredRead<SalesRegisterEntry[]>();
  let starts = 0; let clears = 0;
  const observer = new QueryObserver(client, { queryKey: key,
    queryFn: () => ++starts === 1 ? old.promise : fresh.promise }); // Deliberately ignores AbortSignal.
  const unsubscribe = observer.subscribe(() => {});
  const save = saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
    () => { clears++; }, () => {},
    () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
  try {
    await flushFinancialReads(); assert.equal(clears, 1);
    old.resolve([registerEntry(0)]); await flushFinancialReads();
    assert.equal(registerReadCurrent(client, observer, key), false,
      "pre-payment Register response must not become CURRENT after confirmed payment");
    assert.equal(starts, 2, "payment requires a genuine post-save Register read");
    assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
    fresh.resolve([registerEntry(100)]);
    const saved = await save;
    assert.ok(saved.status === "saved" && saved.refresh === "current");
    assert.equal(saved.payment.id, c9PaymentRow.id);
    assert.equal(registerReadCurrent(client, observer, key), true);
    assert.equal(client.getQueryData<SalesRegisterEntry[]>(key)?.[0].paidAmount, 100);
    assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 1);
  } finally { old.resolve([]); fresh.resolve([]); await save; unsubscribe(); client.clear(); }
});

function registerReadCurrent(client: QueryClient, observer: Pick<QueryObserver, "getCurrentResult">, key: readonly unknown[]) {
  const result = observer.getCurrentResult();
  return !result.isPaused && isCustomerPaymentReadCurrent({ isFetching: result.isFetching,
    error: result.error, dataUpdatedAt: result.dataUpdatedAt, isInvalidated: client.getQueryState(key)?.isInvalidated });
}

for (const detail of [false, true]) {
  test(`C12 P${detail ? 2 : 1}: pre-payment ${detail ? "detail cannot permit Edit/Void" : "list cannot appear CURRENT"}`, async () => {
    reset(); singleResponse.data = challanRow;
    const unlocked = await getChallan("factory-a", challanRow.id);
    rpcResponse.data = c9PaymentRow; // Missing receipt children deliberately yield unavailable details.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = detail ? ["office-sales-challan", "factory-a", challanRow.id] : ["office-sales-challans", "factory-a"];
    const old = deferredRead<typeof unlocked | typeof unlocked[]>();
    const fresh = deferredRead<typeof unlocked | typeof unlocked[]>();
    let starts = 0; let clears = 0;
    const observer = new QueryObserver(client, { queryKey: key,
      queryFn: () => ++starts === 1 ? old.promise : fresh.promise }); // Ignores AbortSignal.
    const unsubscribe = observer.subscribe(() => {});
    const save = saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => { clears++; }, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    try {
      await flushFinancialReads(); assert.equal(clears, 1);
      old.resolve(detail ? unlocked : [unlocked]); await flushFinancialReads();
      const current = registerReadCurrent(client, observer, key);
      if (detail) {
        assert.equal(current && getChallanEligibility(unlocked).canEdit, false,
          "pre-payment unlocked detail must not permit Edit after confirmed payment");
        assert.equal(current && getChallanEligibility(unlocked).canVoid, false);
      } else {
        assert.equal(current, false, "pre-payment unlocked list must not become CURRENT after confirmed payment");
      }
      assert.equal(starts, 2); assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
      const locked = { ...unlocked, isLocked: true };
      fresh.resolve(detail ? locked : [locked]);
      const saved = await save;
      assert.ok(saved.status === "saved" && saved.refresh === "current");
      assert.equal(saved.payment.detailsStatus, "unavailable"); assert.equal(saved.payment.id, c9PaymentRow.id);
      assert.equal(registerReadCurrent(client, observer, key), true);
      if (detail) {
        assert.equal(getChallanEligibility(locked).canEdit, false);
        assert.equal(getChallanEligibility(locked).canVoid, false);
      }
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 1);
    } finally { old.resolve(detail ? unlocked : []); fresh.resolve(detail ? unlocked : []); await save; unsubscribe(); client.clear(); }
  });
}

for (const split of [false, true]) {
  test(`C12 ${split ? "split" : "single"}: multiple allocations, observed variants, dormant/disabled details and isolation`, async () => {
    reset(); rpcResponse.data = { ...c9PaymentRow, payment_mode: split ? "multiple" : "upi" };
    const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const unseenId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const input = { ...c9PaymentInput,
      methods: split ? [{ mode: "cash" as const, splitAmount: 40 }, { mode: "upi" as const, splitAmount: 60 }] : c9PaymentInput.methods,
      allocations: [{ challanId: challanRow.id, amount: 40 }, { challanId: secondId, amount: 30 }, { challanId: unseenId, amount: 30 }] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [
      ["office-sales-challans", "factory-a"],
      ["office-sales-challans", "factory-a", "filter", "customer-a"], // Observed hidden/filter variant.
      ["office-sales-challans", "factory-a", "filter", "old"], // Inactive.
      ["office-sales-challans", "factory-a", "filter", "disabled"],
      ["office-sales-challan", "factory-a", challanRow.id],
      ["office-sales-challan", "factory-a", secondId], // Existing inactive eligible detail.
      ["office-sales-challan", "factory-a", secondId, "disabled"],
      ["office-sales-challan", "factory-a", "different-customers-challan"],
      ["office-sales-challans", "factory-b"],
      ["office-sales-challan", "factory-b", challanRow.id],
      ["office-customer-payment-summary", "factory-a", "customer-b"],
      ["office-dashboard", "factory-a"],
    ];
    let confirmed = false; let clears = 0; const starts = keys.map(() => 0);
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, "UNLOCKED OLD");
      return new QueryObserver(client, { queryKey, staleTime: Infinity, enabled: ![3, 6].includes(index),
        queryFn: async () => { starts[index]++; assert.equal(confirmed, true); return "LOCKED FRESH"; } });
    });
    const subscriptions = [0, 1, 3, 4, 6, 7, 8, 9, 10, 11].map((index) => observers[index].subscribe(() => {}));
    // An enabled observer must still fetch even if the same key also has a disabled observer.
    const disabledSecond = new QueryObserver(client, { ...observers[0].options, enabled: false });
    subscriptions.push(disabledSecond.subscribe(() => {}));
    try {
      const saved = await saveCustomerPaymentAndRefresh(input, createCustomerPaymentWithMethods,
        () => { confirmed = true; clears++; }, () => {},
        () => refreshCustomerPaymentQueries(client, input.factoryId, input.customerId, input.allocations.map((a) => a.challanId)));
      assert.ok(saved.status === "saved" && saved.refresh === "current");
      assert.equal(saved.payment.detailsStatus, "unavailable"); assert.equal(saved.payment.id, c9PaymentRow.id);
      assert.equal(clears, 1); assert.deepEqual(starts, [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
      for (const index of [2, 3, 6]) {
        assert.equal(client.getQueryState(keys[index])?.isInvalidated, true);
        assert.equal(client.getQueryData(keys[index]), "UNLOCKED OLD");
      }
      assert.equal(client.getQueryCache().find({ queryKey: ["office-sales-challan", "factory-a", unseenId], exact: true }), undefined);
      for (const index of [7, 8, 9, 10, 11]) assert.equal(client.getQueryState(keys[index])?.isInvalidated, false);
      // Opening a dormant list starts an authoritative read before it can appear CURRENT.
      const activate = observers[2].subscribe(() => {}); subscriptions.push(activate);
      assert.equal(registerReadCurrent(client, observers[2], keys[2]), false);
      await flushFinancialReads(); assert.equal(starts[2], 1);
      assert.equal(registerReadCurrent(client, observers[2], keys[2]), true);
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 1);
    } finally { subscriptions.forEach((stop) => stop()); client.clear(); }
  });
}

for (const detail of [false, true]) for (const split of [false, true]) for (const newestFirst of [false, true]) {
  test(`C12 held ${detail ? "detail" : "list"}, ${split ? "split" : "single"}, ${newestFirst ? "newest" : "oldest"}-first completion`, async () => {
    reset(); singleResponse.data = challanRow;
    const unlocked = await getChallan("factory-a", challanRow.id); const locked = { ...unlocked, isLocked: true };
    rpcResponse.data = { ...c9PaymentRow, payment_mode: split ? "multiple" : "upi" };
    const input = { ...c9PaymentInput, methods: split
      ? [{ mode: "cash" as const, splitAmount: 40 }, { mode: "upi" as const, splitAmount: 60 }] : c9PaymentInput.methods };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = detail ? ["office-sales-challan", "factory-a", challanRow.id] : ["office-sales-challans", "factory-a"];
    const old = deferredRead<typeof unlocked | typeof unlocked[]>(); const fresh = deferredRead<typeof unlocked | typeof unlocked[]>();
    let starts = 0;
    const observer = new QueryObserver(client, { queryKey: key, queryFn: () => ++starts === 1 ? old.promise : fresh.promise });
    const stop = observer.subscribe(() => {});
    const save = saveCustomerPaymentAndRefresh(input, createCustomerPaymentWithMethods, () => {}, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    try {
      await flushFinancialReads(); assert.equal(starts, 2);
      if (newestFirst) { fresh.resolve(detail ? locked : [locked]); await save; }
      old.resolve(detail ? unlocked : [unlocked]); await flushFinancialReads();
      if (!newestFirst) {
        assert.equal(registerReadCurrent(client, observer, key), false);
        assert.equal(client.getQueryData(key), undefined);
        fresh.resolve(detail ? locked : [locked]);
      }
      const saved = await save; assert.ok(saved.status === "saved" && saved.refresh === "current");
      assert.equal(registerReadCurrent(client, observer, key), true);
      assert.deepEqual(client.getQueryData(key), detail ? locked : [locked]);
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 1);
    } finally { old.resolve(detail ? unlocked : []); fresh.resolve(detail ? locked : []); await save; stop(); client.clear(); }
  });
}

for (const detail of [false, true]) {
  test(`C12 two close payments cannot accept an interrupted ${detail ? "detail" : "list"} read`, async () => {
    reset(); rpcResponse.data = c9PaymentRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = detail ? ["office-sales-challan", "factory-a", challanRow.id] : ["office-sales-challans", "factory-a"];
    const reads = [deferredRead<string>(), deferredRead<string>(), deferredRead<string>()]; let starts = 0; let clears = 0;
    const observer = new QueryObserver(client, { queryKey: key, queryFn: () => reads[starts++].promise });
    const stop = observer.subscribe(() => {});
    const write = () => saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
      () => { clears++; }, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    const first = write(); let second: ReturnType<typeof write> | undefined;
    try {
      await flushFinancialReads(); assert.equal(starts, 2);
      second = write(); await flushFinancialReads(); assert.equal(starts, 3); assert.equal(clears, 2);
      reads[0].resolve("PRE-SAVE"); reads[1].resolve("BEFORE SECOND SAVE"); await flushFinancialReads();
      assert.equal(registerReadCurrent(client, observer, key), false);
      assert.equal(client.getQueryData(key), undefined); assert.equal(observer.getCurrentResult().error, null);
      reads[2].resolve("AFTER BOTH SAVES");
      const results = await Promise.all([first, second]);
      assert.ok(results.every((saved) => saved.status === "saved"));
      assert.equal(results[1].status === "saved" && results[1].refresh, "current");
      assert.equal(client.getQueryData(key), "AFTER BOTH SAVES");
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 2);
    } finally { reads.forEach((r) => r.resolve("")); await first; await second; stop(); client.clear(); }
  });
}

for (const offline of [false, true]) {
  test(`C12 ${offline ? "offline/paused" : "failed"} replacement preserves saved ID and read-only lock recovery`, async () => {
    reset(); rpcResponse.data = c9PaymentRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [["office-sales-challans", "factory-a"], ["office-sales-challan", "factory-a", challanRow.id]];
    const starts = [0, 0]; let fail = !offline; let savedId = ""; let clears = 0;
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, "UNLOCKED");
      return new QueryObserver(client, { queryKey, staleTime: Infinity, queryFn: async () => {
        starts[index]++; if (fail) throw new Error("detail read unavailable"); return "LOCKED";
      } });
    });
    const stops = observers.map((observer) => observer.subscribe(() => {}));
    try {
      if (offline) onlineManager.setOnline(false);
      const saved = await saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
        (payment) => { savedId = payment.id; clears++; }, () => {},
        () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
      assert.ok(saved.status === "saved" && saved.refresh === "outdated");
      for (let i = 0; i < 2; i++) {
        assert.equal(registerReadCurrent(client, observers[i], keys[i]), false);
        assert.equal(client.getQueryState(keys[i])?.isInvalidated, true);
        if (offline) assert.equal(observers[i].getCurrentResult().isPaused, true);
      }
      if (offline) {
        await assert.rejects(refreshChallanLockQueries(client, "factory-a"));
        await assert.rejects(refreshChallanLockQueries(client, "factory-a", [challanRow.id]));
        assert.deepEqual(starts, [0, 0]); // Refresh remains actionable, without writes, while offline.
      }
      fail = false; onlineManager.setOnline(true);
      await refreshChallanLockQueries(client, "factory-a");
      await refreshChallanLockQueries(client, "factory-a", [challanRow.id]);
      for (let i = 0; i < 2; i++) {
        assert.ok(starts[i] > 0); assert.equal(registerReadCurrent(client, observers[i], keys[i]), true);
        assert.equal(client.getQueryData(keys[i]), "LOCKED");
      }
      assert.equal(savedId, c9PaymentRow.id); assert.equal(clears, 1);
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 1);
    } finally { onlineManager.setOnline(true); stops.forEach((stop) => stop()); client.clear(); }
  });
}

test("C12 unrelated held reads survive scoped cancellation", async () => {
  reset(); rpcResponse.data = c9PaymentRow;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = [["office-sales-challans", "factory-b"], ["office-sales-challan", "factory-a", "another-customer"], ["office-dashboard", "factory-a"]];
  const held = keys.map(() => deferredRead<string>());
  const observers = keys.map((queryKey, i) => new QueryObserver(client, { queryKey, queryFn: () => held[i].promise }));
  const stops = observers.map((observer) => observer.subscribe(() => {}));
  try {
    const saved = await saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods, () => {}, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    assert.ok(saved.status === "saved" && saved.refresh === "current");
    held.forEach((r) => r.resolve("UNRELATED ORIGINAL READ")); await flushFinancialReads();
    keys.forEach((key) => { assert.equal(client.getQueryData(key), "UNRELATED ORIGINAL READ"); assert.equal(client.getQueryState(key)?.isInvalidated, false); });
  } finally { held.forEach((r) => r.resolve("")); stops.forEach((stop) => stop()); client.clear(); }
});

for (const split of [false, true]) {
  test(`C10 ordinary ${split ? "split" : "single"}-mode payment refreshes observed ranges, not payment-date or inactive ranges`, async () => {
    reset(); rpcResponse.data = { ...c9PaymentRow, payment_mode: split ? "multiple" : "upi" };
    const input = { ...c9PaymentInput, methods: split
      ? [{ mode: "cash" as const, splitAmount: 40 }, { mode: "upi" as const, splitAmount: 60 }]
      : c9PaymentInput.methods };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [
      ["office-sales-register", "factory-a", "2026-08-26", "2026-08-26"],
      ["office-sales-register", "factory-a", "2026-07-01", "2026-07-31"], // Observed, allocation outside this range.
      ["office-sales-register", "factory-a", cashBookPaymentDate, cashBookPaymentDate], // Inactive payment-date period.
      ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"], // Inactive, contains allocated Challan.
      ["office-sales-register", "factory-a", "2026-08-25", "2026-08-27"], // Observed disabled.
      ["office-sales-register", "factory-a", "2026-08-28", "2026-08-27"], // Observed invalid range.
      ["office-sales-register", "factory-a", "2026-02-30", "2026-08-27"], // Observed invalid date.
      ["office-sales-register", "factory-a", undefined, undefined],
      ["office-sales-register", "factory-a", "2026-08-24", "2026-08-27"], // Registered disabled, inactive.
      ["office-sales-register", "factory-a", "2026-08-23", "2026-08-27"], // Observed enabled function returns false.
    ];
    let confirmed = false; let clears = 0;
    const starts = keys.map(() => 0);
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, index === 1 || index === 2 ? [] : [registerEntry()]);
      return new QueryObserver(client, { queryKey, staleTime: Infinity,
        enabled: index === 9 ? () => false : ![4, 7, 8].includes(index),
        queryFn: async () => { starts[index]++; assert.equal(confirmed, true);
          return index === 1 || index === 2 ? [] : [registerEntry(100)]; } });
    });
    const subscriptions = [0, 1, 4, 5, 6, 7, 9].map((index) => observers[index].subscribe(() => {}));
    // A disabled second observer must not suppress an enabled reader of the same period.
    const disabledSecond = new QueryObserver(client, { ...observers[0].options, enabled: false });
    subscriptions.push(disabledSecond.subscribe(() => {}));
    const noFetcher = ["office-sales-register", "factory-a", "2026-08-22", "2026-08-27"];
    client.setQueryData(noFetcher, [registerEntry()]);
    const foreignKey = ["office-sales-register", "factory-b", "2026-08-26", "2026-08-26"];
    const moduleKey = ["office-production", "factory-a"];
    const unrelated = [deferredRead<string>(), deferredRead<string>()]; const unrelatedStarts = [0, 0];
    [foreignKey, moduleKey].forEach((queryKey, index) => {
      const observer = new QueryObserver(client, { queryKey,
        queryFn: () => { unrelatedStarts[index]++; return unrelated[index].promise; } });
      subscriptions.push(observer.subscribe(() => {}));
    });
    const size = client.getQueryCache().getAll().length;
    try {
      const saved = await saveCustomerPaymentAndRefresh(input, createCustomerPaymentWithMethods,
        () => { confirmed = true; clears++; }, () => {},
        () => refreshCustomerPaymentQueries(client, input.factoryId, input.customerId, [challanRow.id]));
      assert.ok(saved.status === "saved" && saved.refresh === "current");
      assert.equal(saved.payment.id, c9PaymentRow.id); assert.equal(clears, 1);
      assert.deepEqual(starts, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
      keys.forEach((key, index) => assert.equal(client.getQueryState(key)?.isInvalidated, index > 1));
      assert.equal(client.getQueryState(noFetcher)?.isInvalidated, true);
      assert.equal(client.getQueryCache().getAll().length, size, "no unseen periods manufactured");
      assert.equal(registerReadCurrent(client, observers[0], keys[0]), true);
      assert.equal(disabledSecond.getCurrentResult().data?.[0].paidAmount, 100);
      assert.deepEqual(client.getQueryData(keys[1]), [], "outside-range allocation must not add a row to this period");
      assert.equal(summarizeSalesRegister(observers[1].getCurrentResult().data!).totalRevenue, 0);
      assert.deepEqual(unrelatedStarts, [1, 1]);
      [foreignKey, moduleKey].forEach((key) => {
        assert.equal(client.getQueryState(key)?.fetchStatus, "fetching");
        assert.equal(client.getQueryState(key)?.isInvalidated, false);
      });
      unrelated[0].resolve("FOREIGN"); unrelated[1].resolve("MODULE"); await flushFinancialReads();
      assert.equal(client.getQueryData(foreignKey), "FOREIGN"); assert.equal(client.getQueryData(moduleKey), "MODULE");
      // Opening the inactive earlier month performs a new read before it can become CURRENT.
      const fresh = deferredRead<SalesRegisterEntry[]>(); let opened = 0;
      const laterObserver = new QueryObserver(client, { queryKey: keys[3], staleTime: Infinity,
        queryFn: () => { opened++; return fresh.promise; } });
      const stop = laterObserver.subscribe(() => {});
      assert.equal(registerReadCurrent(client, laterObserver, keys[3]), false); assert.equal(opened, 1);
      fresh.resolve([registerEntry(100)]); await flushFinancialReads();
      assert.equal(registerReadCurrent(client, laterObserver, keys[3]), true); stop();
      const writes = calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods");
      assert.equal(writes.length, 1);
      assert.deepEqual((writes[0][2] as Row).p_payment_methods,
        input.methods.map((method) => ({ mode: method.mode, amount: method.splitAmount })));
      assert.equal((writes[0][2] as Row).p_payment_date, cashBookPaymentDate);
    } finally { unrelated.forEach((read) => read.resolve("")); subscriptions.forEach((stop) => stop()); client.clear(); }
  });
}

// Both committed-write paths use the same engine. Every network read here ignores AbortSignal.
for (const path of creationPaths) for (const paymentFirst of [false, true]) {
  for (const newestFirst of [false, true]) for (const latestState of ["success", "failure", "paused"] as const) {
    test(`C10 ${path.name}/${paymentFirst ? "payment then Challan" : "Challan then payment"}, ${newestFirst ? "new" : "old"} response first, latest ${latestState}`, { timeout: 3000 }, async () => {
      reset(); const wasOnline = onlineManager.isOnline();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); client.mount();
      const key = ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"];
      const requests = Array.from({ length: 5 }, () => deferredRead<SalesRegisterEntry[]>()); let starts = 0;
      const observer = new QueryObserver(client, { queryKey: key, queryFn: () => {
        const index = starts++;
        return requests[index].promise.then((data) => {
          if (index === 2 && latestState === "failure") throw new Error("Latest read unavailable");
          return data;
        });
      } });
      const unsubscribe = observer.subscribe(() => {});
      const foreignKey = ["office-sales-register", "factory-b", "2026-08-01", "2026-08-31"];
      const foreignRead = deferredRead<string>(); let foreignStarts = 0;
      const foreign = new QueryObserver(client, { queryKey: foreignKey,
        queryFn: () => { foreignStarts++; return foreignRead.promise; } });
      const stopForeign = foreign.subscribe(() => {});
      let paymentClears = 0; let challanClears = 0; let savedPaymentId: string | null = null;
      let paymentDraft: string | null = "payment draft";
      const latch: ChallanCreationLatch = { phase: "ready" };
      const commit = (payment: boolean, latest: boolean) => {
        const confirmed = () => { if (latest && latestState === "paused") onlineManager.setOnline(false); };
        if (payment) {
          rpcResponse.data = c9PaymentRow;
          return saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
            (saved) => { paymentClears++; paymentDraft = null; savedPaymentId = saved.id; confirmed(); }, () => {},
            () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
        }
        rpcResponse.data = challanRow;
        return submitChallanCreation(latch, path.create,
          () => { challanClears++; confirmed(); }, (header) => refreshSalesRegisterQueries(client, header));
      };
      const first = commit(paymentFirst, false);
      let second: ReturnType<typeof commit> | undefined;
      try {
        await flushFinancialReads(); assert.equal(starts, 2);
        second = commit(!paymentFirst, true); await flushFinancialReads();
        assert.equal(starts, latestState === "paused" ? 2 : 3);
        const releaseOld = async () => {
          requests[0].resolve([registerEntry()]); requests[1].resolve([registerEntry(50)]);
          await flushFinancialReads();
        };
        if (!newestFirst) {
          await releaseOld();
          assert.equal(registerReadCurrent(client, observer, key), false,
            "a response predating the latest committed write cannot become CURRENT");
          assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
        }
        if (latestState !== "paused") requests[2].resolve([registerEntry(100)]);
        const [firstSaved, secondSaved] = await Promise.all([first, second]);
        assert.equal(firstSaved.status, "saved"); assert.equal(secondSaved.status, "saved");
        assert.equal(paymentClears, 1); assert.equal(challanClears, 1);
        assert.equal(savedPaymentId, c9PaymentRow.id); assert.equal(paymentDraft, null); assert.equal(latch.savedId, challanRow.id);
        assert.equal(registerReadCurrent(client, observer, key), latestState === "success");
        if (latestState === "success") assert.equal(client.getQueryData<SalesRegisterEntry[]>(key)?.[0].paidAmount, 100);
        else {
          assert.equal(client.getQueryState(key)?.isInvalidated, true);
          if (latestState === "paused") assert.equal(observer.getCurrentResult().isPaused, true);
        }
        if (newestFirst) await releaseOld();
        assert.equal(registerReadCurrent(client, observer, key), latestState === "success");
        assert.equal(client.getQueryState(key)?.dataUpdateCount, latestState === "success" ? 1 : 0,
          "neither cancelled network response may update the cache");
        if (latestState === "success") assert.equal(client.getQueryData<SalesRegisterEntry[]>(key)?.[0].paidAmount, 100);
        assert.equal(foreignStarts, 1); assert.equal(client.getQueryState(foreignKey)?.fetchStatus, "fetching");
        foreignRead.resolve("UNRELATED"); await flushFinancialReads(); assert.equal(client.getQueryData(foreignKey), "UNRELATED");
        if (latestState !== "success") {
          onlineManager.setOnline(true);
          const recovery = refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]);
          await flushFinancialReads(); assert.equal(registerReadCurrent(client, observer, key), false);
          // Reconnect may first resume the paused read; explicit Refresh replaces it.
          requests.slice(2).forEach((read) => read.resolve([registerEntry(100)])); await recovery;
          assert.equal(registerReadCurrent(client, observer, key), true);
          assert.equal(client.getQueryData<SalesRegisterEntry[]>(key)?.[0].paidAmount, 100);
        }
        assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name),
          paymentFirst ? ["create_customer_payment_with_methods", path.rpc] : [path.rpc, "create_customer_payment_with_methods"]);
        assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
      } finally {
        requests.forEach((read) => read.resolve([])); foreignRead.resolve("");
        unsubscribe(); stopForeign(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline);
        await Promise.all([first, second]);
      }
    });
  }
}

for (const newestFirst of [false, true]) {
  test(`C10 two close ordinary payments: ${newestFirst ? "new" : "old"} Register response first never overwrites latest`, async () => {
    reset(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"];
    const reads = Array.from({ length: 3 }, () => deferredRead<SalesRegisterEntry[]>()); let starts = 0; let clears = 0;
    const observer = new QueryObserver(client, { queryKey: key, queryFn: () => reads[starts++].promise });
    const stop = observer.subscribe(() => {});
    const secondId = "22222222-2222-4222-8222-222222222222";
    const save = (id: string) => {
      rpcResponse.data = { ...c9PaymentRow, id };
      return saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
        () => { clears++; }, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
    };
    const first = save(c9PaymentRow.id); let second: ReturnType<typeof save> | undefined;
    try {
      await flushFinancialReads(); second = save(secondId); await flushFinancialReads(); assert.equal(starts, 3);
      if (!newestFirst) {
        reads[1].resolve([registerEntry(100)]); await flushFinancialReads();
        assert.equal(registerReadCurrent(client, observer, key), false); assert.equal(client.getQueryState(key)?.dataUpdateCount, 0);
      }
      reads[2].resolve([registerEntry(200)]);
      const [saved1, saved2] = await Promise.all([first, second]);
      assert.ok(saved1.status === "saved" && saved2.status === "saved" && saved2.refresh === "current");
      assert.equal(saved1.payment.id, c9PaymentRow.id); assert.equal(saved2.payment.id, secondId); assert.equal(clears, 2);
      reads[0].resolve([registerEntry()]); reads[1].resolve([registerEntry(100)]); await flushFinancialReads();
      assert.equal(registerReadCurrent(client, observer, key), true);
      assert.equal(client.getQueryData<SalesRegisterEntry[]>(key)?.[0].paidAmount, 200);
      assert.equal(calls.filter(([method, name]) => method === "rpc" && name === "create_customer_payment_with_methods").length, 2);
    } finally { reads.forEach((read) => read.resolve([])); await Promise.all([first, second]); stop(); client.clear(); }
  });
}

for (const firstState of ["success", "failure", "paused"] as const) {
  test(`C10 sequential saved-payment recovery: first ${firstState}, no extra write or stuck Register`, { timeout: 3000 }, async () => {
    reset(); rpcResponse.data = c9PaymentRow; const wasOnline = onlineManager.isOnline();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.mount();
    const key = ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"];
    client.setQueryData(key, [registerEntry()]);
    const reads = Array.from({ length: 4 }, () => deferredRead<SalesRegisterEntry[]>());
    let recovering = false; let starts = 0; let stages = 0; let draft: string | null = "draft";
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: () => {
      if (!recovering) return Promise.resolve([registerEntry(100)]);
      const index = starts++;
      return reads[index].promise.then((data) => {
        if (index === 0 && firstState === "failure") throw new Error("First recovery read failed");
        return data;
      });
    } });
    const stop = observer.subscribe(() => {});
    const unrelatedKey = ["office-sales-register", "factory-b", "2026-08-01", "2026-08-31"];
    client.setQueryData(unrelatedKey, [registerEntry()]);
    try {
      const saved = await saveCustomerPaymentAndRefresh(c9PaymentInput, createCustomerPaymentWithMethods,
        () => { draft = null; }, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]));
      assert.ok(saved.status === "saved"); recovering = true;
      if (firstState === "paused") onlineManager.setOnline(false);
      // Same two awaited calls as retryCustomerPaymentQueries, including switched current customer.
      const recovery = (async () => {
        stages++;
        await refreshCustomerPaymentQueries(client, "factory-a", "customer-b", []);
        stages++;
        await refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]);
      })();
      const settled = recovery.then(() => "current", () => "outdated");
      await flushFinancialReads(); assert.equal(registerReadCurrent(client, observer, key), false); assert.equal(stages, 1);
      if (firstState === "success") {
        assert.equal(starts, 1); reads[0].resolve([registerEntry(100)]); await flushFinancialReads();
        assert.equal(starts, 2); assert.equal(stages, 2);
        assert.equal(registerReadCurrent(client, observer, key), false);
        reads[1].resolve([registerEntry(100)]); assert.equal(await settled, "current");
      } else {
        if (firstState === "failure") reads[0].resolve([]);
        assert.equal(await settled, "outdated"); assert.equal(stages, 1, "first failure/paused read skips the second recovery call");
        assert.equal(starts, firstState === "paused" ? 0 : 1);
        assert.equal(registerReadCurrent(client, observer, key), false);
        onlineManager.setOnline(true);
        const retry = refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [challanRow.id]);
        await flushFinancialReads(); assert.equal(registerReadCurrent(client, observer, key), false);
        // For paused recovery, index 0 succeeds; for failed recovery, index 1 succeeds.
        reads.forEach((read) => read.resolve([registerEntry(100)])); await retry;
      }
      assert.equal(client.getQueryState(key)?.status, "success"); assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
      assert.equal(registerReadCurrent(client, observer, key), true);
      assert.equal(client.getQueryState(unrelatedKey)?.isInvalidated, false);
      assert.equal(saved.payment.id, c9PaymentRow.id); assert.equal(draft, null);
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), ["create_customer_payment_with_methods"]);
    } finally { reads.forEach((read) => read.resolve([])); stop(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline); }
  });
}

test("Register refresh does not manufacture unseen periods or force an invalid explicit Refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await refreshSalesRegisterQueries(client, { factoryId: "factory-a", challanDate: "2026-08-26" });
    assert.equal(client.getQueryCache().getAll().length, 0);
    const key = ["office-sales-register", "factory-a", "2026-08-28", "2026-08-27"];
    client.setQueryData(key, [registerEntry()]); let starts = 0;
    const observer = new QueryObserver(client, { queryKey: key, enabled: false,
      queryFn: async () => { starts++; return []; } });
    const unsubscribe = observer.subscribe(() => {});
    await refreshSalesRegisterQueries(client, { factoryId: "factory-a",
      range: { fromDate: "2026-08-28", toDate: "2026-08-27" } });
    assert.equal(starts, 0); assert.equal(client.getQueryState(key)?.isInvalidated, true);
    unsubscribe();
  } finally { client.clear(); }
});

for (const path of creationPaths) {
  const receivedNow = path.name === "Received Now";
  const create = () => receivedNow ? createChallanWithReceivedPayment({ ...creationInput,
    receivedPayment: { paymentDate: "2026-09-02", amount: 1250.75, paymentMode: "upi" },
  }) : path.create();
  const registerKey = ["office-sales-register", "factory-a", "2026-08-26", "2026-08-26"];

  test(`${path.name} Register invalidates all factory variants but fetches only relevant eligible or observed ranges; D1 differs from D2`, async () => {
    reset(); rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys: readonly unknown[][] = [
      registerKey,
      ["office-sales-register", "factory-a", "2026-08-01", "2026-08-02"], // Hidden observed period.
      ["office-sales-register", "factory-a", "2026-08-01", "2026-08-31"], // Inactive relevant month.
      ["office-sales-register", "factory-a", "2026-09-02", "2026-09-02"], // Payment date only, inactive.
      ["office-sales-register", "factory-a", "2026-08-25", "2026-08-27"], // Straddles D1, unmounted.
      ["office-sales-register", "factory-a", "0001-01-01", "9999-12-31"], // All-time-equivalent custom range.
      ["office-sales-register", "factory-a", "2026-08-28", "2026-08-27"],
      ["office-sales-register", "factory-a", "2026-02-30", "2026-08-27"],
      ["office-sales-register", "factory-a", undefined, undefined],
      ["office-sales-register", "factory-a", "2026-08-24", "2026-08-27"], // Observed but disabled.
      ["office-sales-register", "factory-a", "2026-08-23", "2026-08-27"], // Registered disabled, no observer.
      ["office-sales-register", "factory-b", "2026-08-26", "2026-08-26"],
      ["office-cash-book-day", "factory-a", "2026-08-26"],
      ["office-customer-payment-summary", "factory-a", "customer-a"],
    ];
    let confirmed = false;
    const starts = keys.map(() => 0);
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, [registerEntry()]);
      return new QueryObserver(client, { queryKey, staleTime: Infinity, enabled: !(index >= 6 && index <= 10),
        queryFn: async () => { starts[index]++; assert.equal(confirmed, true); return [registerEntry(receivedNow ? 1250.75 : 0)]; } });
    });
    const subscriptions = [0, 1, 6, 7, 8, 9].map((index) => observers[index].subscribe(() => {}));
    const unmount = observers[4].subscribe(() => {}); unmount();
    const unfetchableKey = ["office-sales-register", "factory-a", "2026-08-22", "2026-08-27"];
    client.setQueryData(unfetchableKey, [registerEntry()]);
    const cacheSize = client.getQueryCache().getAll().length;
    const latch: ChallanCreationLatch = { phase: "ready" };
    try {
      const saved = await submitChallanCreation(latch, create, () => { confirmed = true; },
        (header) => refreshSalesRegisterQueries(client, header));
      assert.ok(saved.status === "saved" && !saved.postSaveFailed);
      const fetched = new Set([0, 1, 2, 4, 5]);
      assert.deepEqual(starts, keys.map((_, index) => fetched.has(index) ? 1 : 0));
      keys.forEach((key, index) => assert.equal(client.getQueryState(key)?.isInvalidated, index <= 10 && !fetched.has(index)));
      assert.equal(client.getQueryState(unfetchableKey)?.isInvalidated, true);
      assert.equal(client.getQueryCache().getAll().length, cacheSize);
      const entries = client.getQueryData<SalesRegisterEntry[]>(registerKey)!;
      assert.equal(entries[0].paidAmount, receivedNow ? 1250.75 : 0);
      assert.equal(summarizeSalesRegister(entries).totalRevenue, 3500);
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
      if (receivedNow) assert.equal((calls[0][2] as Row).p_payment_date, "2026-09-02");
      // An excluded inactive period remains outdated until it becomes valid/active.
      const fresh = deferredRead<SalesRegisterEntry[]>();
      const nextObserver = new QueryObserver(client, { queryKey: keys[3], staleTime: Infinity, queryFn: () => fresh.promise });
      const unsubscribe = nextObserver.subscribe(() => {});
      assert.equal(client.getQueryState(keys[3])?.isInvalidated, true);
      fresh.resolve([]); await flushFinancialReads();
      assert.deepEqual(nextObserver.getCurrentResult().data, []);
      assert.equal(client.getQueryState(keys[3])?.isInvalidated, false);
      unsubscribe();
    } finally { subscriptions.forEach((unsubscribe) => unsubscribe()); client.clear(); }
  });

  test(`${path.name} Register cancels held pre-save first loads with multiple observers; unrelated reads continue`, async () => {
    reset(); rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const old = deferredRead<SalesRegisterEntry[]>(); const fresh = deferredRead<SalesRegisterEntry[]>();
    const unrelated = deferredRead<string>();
    let confirmed = false; const starts: boolean[] = [];
    const queryFn = () => { starts.push(confirmed); return starts.length === 1 ? old.promise : fresh.promise; };
    const observer = new QueryObserver(client, { queryKey: registerKey, queryFn });
    const hiddenObserver = new QueryObserver(client, { queryKey: registerKey, queryFn });
    const unrelatedKey = ["office-sales-register", "factory-b", "2026-08-26", "2026-08-26"];
    let unrelatedStarts = 0;
    const other = new QueryObserver(client, { queryKey: unrelatedKey,
      queryFn: () => { unrelatedStarts++; return unrelated.promise; } });
    const moduleKey = ["office-cash-book-day", "factory-a", "2026-08-26"];
    const moduleRead = deferredRead<string>(); let moduleStarts = 0;
    const moduleObserver = new QueryObserver(client, { queryKey: moduleKey,
      queryFn: () => { moduleStarts++; return moduleRead.promise; } });
    const subscriptions = [observer, hiddenObserver].map((item) => item.subscribe(() => {}));
    const unsubscribeOther = other.subscribe(() => {});
    const unsubscribeModule = moduleObserver.subscribe(() => {});
    const latch: ChallanCreationLatch = { phase: "ready" }; let completed = false;
    const save = submitChallanCreation(latch, create, () => { confirmed = true; },
      (header) => refreshSalesRegisterQueries(client, header)).then((saved) => { completed = true; return saved; });
    try {
      await flushFinancialReads(); old.resolve([registerEntry()]); await flushFinancialReads();
      assert.deepEqual(starts, [false, true]); assert.equal(completed, false);
      assert.equal(client.getQueryData(registerKey), undefined);
      assert.equal(client.getQueryState(registerKey)?.error, null);
      assert.equal(latch.phase, "saved"); assert.equal(latch.savedId, challanRow.id);
      assert.equal(client.getQueryState(unrelatedKey)?.fetchStatus, "fetching"); assert.equal(unrelatedStarts, 1);
      assert.equal(client.getQueryState(moduleKey)?.fetchStatus, "fetching"); assert.equal(moduleStarts, 1);
      fresh.resolve([registerEntry(receivedNow ? 1250.75 : 0)]);
      const saved = await save; assert.ok(saved.status === "saved" && !saved.postSaveFailed);
      assert.equal(client.getQueryState(registerKey)?.isInvalidated, false);
      assert.equal(observer.getCurrentResult().data?.[0].outstandingAmount, receivedNow ? 2249.25 : 3500);
      assert.equal(hiddenObserver.getCurrentResult().data, observer.getCurrentResult().data);
      unrelated.resolve("UNCHANGED"); await flushFinancialReads();
      assert.equal(client.getQueryData(unrelatedKey), "UNCHANGED"); assert.equal(unrelatedStarts, 1);
      moduleRead.resolve("UNCHANGED MODULE"); await flushFinancialReads();
      assert.equal(client.getQueryData(moduleKey), "UNCHANGED MODULE"); assert.equal(moduleStarts, 1);
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally {
      old.resolve([]); fresh.resolve([]); unrelated.resolve("UNCHANGED"); moduleRead.resolve("UNCHANGED MODULE"); await save;
      subscriptions.forEach((unsubscribe) => unsubscribe()); unsubscribeOther(); unsubscribeModule(); client.clear();
    }
  });

  test(`${path.name} offline Register refresh preserves SAVED; repeated read-only Refresh and reconnect await fresh totals`, { timeout: 3000 }, async () => {
    reset(); rpcResponse.data = challanRow;
    const wasOnline = onlineManager.isOnline();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); client.mount();
    client.setQueryData(registerKey, [registerEntry()]);
    const fresh = deferredRead<SalesRegisterEntry[]>(); let starts = 0;
    const observer = new QueryObserver(client, { queryKey: registerKey, staleTime: Infinity,
      queryFn: () => { starts++; return fresh.promise; } });
    const unsubscribe = observer.subscribe(() => {});
    const latch: ChallanCreationLatch = { phase: "ready" }; let draft: string | null = "draft";
    const current = () => !observer.getCurrentResult().isPaused && isCustomerPaymentReadCurrent({
      isFetching: observer.getCurrentResult().isFetching, error: observer.getCurrentResult().error,
      dataUpdatedAt: observer.getCurrentResult().dataUpdatedAt,
      isInvalidated: client.getQueryState(registerKey)?.isInvalidated,
    });
    try {
      const saved = await submitChallanCreation(latch, create, () => { draft = null; onlineManager.setOnline(false); },
        (header) => refreshSalesRegisterQueries(client, header));
      assert.ok(saved.status === "saved" && saved.postSaveFailed);
      assert.equal(saved.header.id, challanRow.id); assert.equal(latch.savedId, challanRow.id);
      assert.equal(draft, null); assert.equal(current(), false); assert.equal(observer.getCurrentResult().isPaused, true);
      const target = { factoryId: saved.header.factoryId, range: { fromDate: "2026-08-26", toDate: "2026-08-26" } };
      for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(() => refreshSalesRegisterQueries(client, target));
      assert.equal(starts, 0); assert.equal(current(), false);
      onlineManager.setOnline(true); let completed = false;
      const refresh = refreshSalesRegisterQueries(client, target).then(() => { completed = true; });
      await flushFinancialReads(); assert.equal(current(), false); assert.equal(completed, false);
      fresh.resolve([registerEntry(receivedNow ? 1250.75 : 0)]); await refresh;
      assert.equal(current(), true); assert.equal(completed, true);
      assert.equal(summarizeSalesRegister(observer.getCurrentResult().data!).totalRevenue, 3500);
      assert.deepEqual(await submitChallanCreation(latch, create, () => {}, () => {}), { status: "blocked" });
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally { fresh.resolve([]); unsubscribe(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline); }
  });

  test(`${path.name} failed Register reads hide cached totals until read-only recovery without reopening the draft`, async () => {
    reset(); rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(registerKey, [registerEntry()]); let fail = true;
    const observer = new QueryObserver(client, { queryKey: registerKey, staleTime: Infinity,
      queryFn: async () => { if (fail) throw new Error("Read unavailable"); return []; } });
    const unsubscribe = observer.subscribe(() => {});
    const latch: ChallanCreationLatch = { phase: "ready" };
    try {
      const saved = await submitChallanCreation(latch, create, () => {}, (header) => refreshSalesRegisterQueries(client, header));
      assert.ok(saved.status === "saved" && saved.postSaveFailed);
      const current = () => isCustomerPaymentReadCurrent({ isFetching: observer.getCurrentResult().isFetching,
        error: observer.getCurrentResult().error, dataUpdatedAt: observer.getCurrentResult().dataUpdatedAt,
        isInvalidated: client.getQueryState(registerKey)?.isInvalidated });
      assert.equal(current(), false);
      const displayedSummary = current() ? summarizeSalesRegister(observer.getCurrentResult().data!) : null;
      assert.equal(displayedSummary, null, "unavailable totals must not be fabricated zeros");
      assert.equal(client.getQueryData<SalesRegisterEntry[]>(registerKey)?.[0].totalRevenue, 3500);
      fail = false;
      await refreshSalesRegisterQueries(client, { factoryId: saved.header.factoryId,
        range: { fromDate: "2026-08-26", toDate: "2026-08-26" } });
      assert.equal(current(), true); assert.deepEqual(observer.getCurrentResult().data, []);
      assert.equal(summarizeSalesRegister(observer.getCurrentResult().data!).totalRevenue, 0, "fresh empty data legitimately totals zero");
      assert.deepEqual(await submitChallanCreation(latch, create, () => {}, () => {}), { status: "blocked" });
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally { unsubscribe(); client.clear(); }
  });
}

for (const path of creationPaths) {
  const receivedNow = path.name === "Received Now";

  test(`${path.name} customer refresh covers active, hidden, inactive and previously unmounted filter variants only`, async () => {
    reset();
    rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [
      ["office-customer-payment-summary", "factory-a", "customer-a"],
      ["office-customer-payment-candidates", "factory-a", "customer-a", "all", "", ""],
      ["office-customer-payment-candidates", "factory-a", "customer-a", "week", "2026-08-24", "2026-08-30"],
      ["office-customer-payment-candidates", "factory-a", "customer-a", "custom", "2026-08-01", "2026-08-26"],
      ["office-customer-payment-history", "factory-a", "customer-a"],
      ["office-factory-customer-payments", "factory-a"],
      ["office-customer-payment-summary", "factory-a", "customer-b"],
      ["office-customer-payment-summary", "factory-b", "customer-a"],
      ["office-sales-register", "factory-a"], ["office-cash-book-day", "factory-a"],
      ["office-vehicle-wages", "factory-a"], ["owner-dashboard", "factory-a"],
    ];
    const starts = keys.map(() => 0);
    let confirmed = false;
    const options = keys.map((queryKey, index) => ({ queryKey, staleTime: Infinity,
      queryFn: async () => { starts[index]++; assert.equal(confirmed, true); return `FRESH-${index}`; },
    }));
    const observers = options.map((option, index) => {
      client.setQueryData(option.queryKey, `OLD-${index}`);
      return new QueryObserver(client, option);
    });
    // Summary active; all-candidates keeps its observer when the Sales tab is hidden.
    // Week is registered but inactive; custom was mounted and then unsubscribed.
    const unsubscribes = [observers[0].subscribe(() => {}), observers[1].subscribe(() => {}),
      observers[4].subscribe(() => {})];
    const unmount = observers[3].subscribe(() => {});
    unmount();
    const latch: ChallanCreationLatch = { phase: "ready" };
    try {
      const result = await submitChallanCreation(latch, path.create, () => { confirmed = true; },
        (header) => refreshCustomerFinancialQueries(client, header, receivedNow));
      assert.ok(result.status === "saved");
      assert.equal(result.postSaveFailed, false);
      assert.equal(result.header.id, challanRow.id);
      const affected = receivedNow ? 6 : 4;
      assert.deepEqual(starts, keys.map((_, index) => index < affected ? 1 : 0));
      for (let index = 0; index < keys.length; index++) {
        assert.equal(client.getQueryData(keys[index]), index < affected ? `FRESH-${index}` : `OLD-${index}`);
        assert.equal(client.getQueryState(keys[index])?.isInvalidated, false);
      }
      assert.equal(client.getQueryCache().getAll().length, keys.length, "refresh must not create unseen filter queries");
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    } finally { unsubscribes.forEach((unsubscribe) => unsubscribe()); client.clear(); }
  });

  test(`${path.name} pre-save first-load responses cannot become CURRENT; unrelated in-flight reads continue`, async () => {
    reset();
    rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [
      ["office-customer-payment-summary", "factory-a", "customer-a"],
      ["office-customer-payment-candidates", "factory-a", "customer-a", "all", "", ""],
      ...(receivedNow ? [["office-customer-payment-history", "factory-a", "customer-a"],
        ["office-factory-customer-payments", "factory-a"]] : []),
    ];
    const old = keys.map(() => deferredRead<string>());
    const replacement = keys.map(() => deferredRead<string>());
    const starts: boolean[][] = keys.map(() => []);
    let confirmed = false;
    let settled = false;
    const observers = keys.map((queryKey, index) => new QueryObserver(client, {
      queryKey, queryFn: () => {
        starts[index].push(confirmed);
        return starts[index].length === 1 ? old[index].promise : replacement[index].promise;
      },
    }));
    const unsubscribes = observers.map((observer) => observer.subscribe(() => {}));
    const unrelated = deferredRead<string>();
    const unrelatedKey = ["office-customer-payment-summary", "factory-a", "customer-b"];
    let unrelatedStarts = 0;
    const unrelatedObserver = new QueryObserver(client, { queryKey: unrelatedKey,
      queryFn: () => { unrelatedStarts++; return unrelated.promise; } });
    const unsubscribeUnrelated = unrelatedObserver.subscribe(() => {});
    const latch: ChallanCreationLatch = { phase: "ready" };
    let savedId = "";
    const save = submitChallanCreation(latch, path.create, (header) => {
      confirmed = true; savedId = header.id;
    }, (header) => refreshCustomerFinancialQueries(client, header, receivedNow))
      .then((result) => { settled = true; return result; });
    try {
      await flushFinancialReads();
      old.forEach((read) => read.resolve("OLD"));
      await flushFinancialReads();
      assert.deepEqual(starts, keys.map(() => [false, true]));
      assert.equal(settled, false, "completion cannot be inferred from old reads finishing");
      assert.equal(latch.phase, "saved");
      assert.equal(savedId, challanRow.id);
      for (const key of keys) {
        assert.notEqual(client.getQueryData(key), "OLD");
        assert.equal(client.getQueryState(key)?.error, null, "cancellation is not a load error");
        assert.equal(customerReadCurrent(client, key), false);
      }
      assert.equal(unrelatedStarts, 1);
      assert.equal(client.getQueryState(unrelatedKey)?.fetchStatus, "fetching");
      replacement.forEach((read) => read.resolve("POST-SAVE"));
      const result = await save;
      assert.ok(result.status === "saved" && !result.postSaveFailed);
      for (const key of keys) {
        assert.equal(client.getQueryData(key), "POST-SAVE");
        assert.equal(customerReadCurrent(client, key), true);
      }
      unrelated.resolve("UNRELATED COMPLETED");
      await flushFinancialReads();
      assert.equal(client.getQueryData(unrelatedKey), "UNRELATED COMPLETED");
      assert.equal(unrelatedStarts, 1);
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    } finally {
      old.forEach((read) => read.resolve("OLD"));
      replacement.forEach((read) => read.resolve("POST-SAVE"));
      unrelated.resolve("UNRELATED COMPLETED");
      await save;
      unsubscribes.forEach((unsubscribe) => unsubscribe()); unsubscribeUnrelated(); client.clear();
    }
  });

  test(`${path.name} offline refresh stays SAVED/outdated and read-only recovery waits for completed fresh reads`, { timeout: 3000 }, async () => {
    reset();
    rpcResponse.data = challanRow;
    const wasOnline = onlineManager.isOnline();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.mount();
    const keys = [
      ["office-customer-payment-summary", "factory-a", "customer-a"],
      ["office-customer-payment-candidates", "factory-a", "customer-a", "all", "", ""],
      ...(receivedNow ? [["office-customer-payment-history", "factory-a", "customer-a"],
        ["office-factory-customer-payments", "factory-a"]] : []),
    ];
    const replacement = keys.map(() => deferredRead<string>());
    const starts = keys.map(() => 0);
    const observers = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, "OLD");
      return new QueryObserver(client, { queryKey, staleTime: Infinity,
        queryFn: () => { starts[index]++; return replacement[index].promise; } });
    });
    const unsubscribes = observers.map((observer) => observer.subscribe(() => {}));
    let draft: string | null = "completed draft";
    let selectedId = "";
    let mode = "create";
    const latch: ChallanCreationLatch = { phase: "ready" };
    try {
      const saved = await submitChallanCreation(latch, path.create, (header) => {
        draft = null; selectedId = header.id; mode = "detail"; onlineManager.setOnline(false);
      }, (header) => refreshCustomerFinancialQueries(client, header, receivedNow));
      assert.ok(saved.status === "saved" && saved.postSaveFailed);
      assert.equal(saved.header.id, challanRow.id);
      assert.equal(selectedId, challanRow.id);
      assert.equal(mode, "detail");
      assert.equal(draft, null);
      for (const key of keys) {
        assert.equal(client.getQueryState(key)?.fetchStatus, "paused");
        assert.equal(customerReadCurrent(client, key), false);
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(() => refreshCustomerFinancialQueries(client, saved.header, receivedNow),
          { message: ATLAS_UI_STRINGS.payment.balancesOutdated });
      }
      assert.deepEqual(starts, keys.map(() => 0));
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
      onlineManager.setOnline(true);
      let current = false;
      const refresh = refreshCustomerFinancialQueries(client, saved.header, receivedNow).then(() => { current = true; });
      await flushFinancialReads();
      assert.equal(current, false);
      for (const key of keys) assert.equal(customerReadCurrent(client, key), false);
      replacement.forEach((read) => read.resolve("FRESH"));
      await refresh;
      assert.equal(current, true);
      for (const key of keys) assert.equal(customerReadCurrent(client, key), true);
      assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    } finally {
      replacement.forEach((read) => read.resolve("FRESH"));
      unsubscribes.forEach((unsubscribe) => unsubscribe()); client.clear(); client.unmount();
      onlineManager.setOnline(wasOnline);
    }
  });
}

test("customer financial refresh does not manufacture queries for never-loaded views", async () => {
  const client = new QueryClient();
  try {
    await refreshCustomerFinancialQueries(client, { factoryId: "factory-a", customerId: "customer-a" }, false);
    await refreshCustomerFinancialQueries(client, { factoryId: "factory-a", customerId: "customer-a" }, true);
    assert.equal(client.getQueryCache().getAll().length, 0);
  } finally { client.clear(); }
});

for (const path of creationPaths) {
  const receivedNow = path.name === "Received Now";

  test(`${path.name} inactive cached reads without a fetcher stay outdated until Customer A is mounted and refreshed`, async () => {
    reset();
    rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keysA = ["office-customer-payment-summary", "office-customer-payment-candidates"]
      .map((prefix) => [prefix, "factory-a", "customer-a"]);
    keysA.forEach((key) => client.setQueryData(key, "OLD-A"));
    const keyB = ["office-customer-payment-summary", "factory-a", "customer-b"];
    const readB = deferredRead<string>();
    let startsB = 0;
    const observerB = new QueryObserver(client, { queryKey: keyB,
      queryFn: () => { startsB++; return readB.promise; } });
    const unsubscribeB = observerB.subscribe(() => {});
    const freshA = keysA.map(() => deferredRead<string>());
    const unsubscribesA: (() => void)[] = [];
    const latch: ChallanCreationLatch = { phase: "ready" };
    try {
      const saved = await submitChallanCreation(latch, path.create, () => {},
        (header) => refreshCustomerFinancialQueries(client, header, receivedNow));
      assert.ok(saved.status === "saved" && saved.postSaveFailed);
      assert.equal(saved.header.id, challanRow.id);
      for (const key of keysA) {
        assert.equal(client.getQueryData(key), "OLD-A");
        assert.equal(client.getQueryState(key)?.isInvalidated, true);
        assert.equal(customerReadCurrent(client, key), false);
      }
      assert.equal(client.getQueryState(keyB)?.fetchStatus, "fetching");
      assert.equal(client.getQueryState(keyB)?.isInvalidated, false);
      keysA.forEach((key, index) => {
        const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
          queryFn: () => freshA[index].promise });
        unsubscribesA.push(observer.subscribe(() => {}));
        assert.equal(customerReadCurrent(client, key), false, "reselection cannot promote old cached balances");
      });
      freshA.forEach((read) => read.resolve("FRESH-A"));
      readB.resolve("UNCHANGED-B");
      await flushFinancialReads();
      for (const key of keysA) {
        assert.equal(client.getQueryData(key), "FRESH-A");
        assert.equal(customerReadCurrent(client, key), true);
      }
      assert.equal(client.getQueryData(keyB), "UNCHANGED-B");
      assert.equal(startsB, 1);
      assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally {
      freshA.forEach((read) => read.resolve("FRESH-A")); readB.resolve("UNCHANGED-B");
      unsubscribesA.forEach((unsubscribe) => unsubscribe()); unsubscribeB(); client.clear();
    }
  });

  test(`${path.name} customer selection changing during the creation RPC cannot redirect freshness to Customer B`, async () => {
    reset();
    const response = deferredRead<typeof rpcResponse>();
    rpcPending = response.promise;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const prefixes = ["office-customer-payment-summary", "office-customer-payment-candidates"];
    const keysA = prefixes.map((prefix) => [prefix, "factory-a", "customer-a"]);
    const keysB = prefixes.map((prefix) => [prefix, "factory-a", "customer-b"]);
    const beforeSaveA = prefixes.map(() => deferredRead<string>());
    const postSaveA = prefixes.map(() => deferredRead<string>());
    const readsB = prefixes.map(() => deferredRead<string>());
    const startsA = prefixes.map(() => 0);
    const startsB = prefixes.map(() => 0);
    const queryFnA = prefixes.map((_, index) => () => {
      startsA[index]++;
      return startsA[index] === 1 ? beforeSaveA[index].promise : postSaveA[index].promise;
    });
    const observers = prefixes.map((_, index) => new QueryObserver(client, {
      queryKey: keysA[index], queryFn: queryFnA[index],
    }));
    const unsubscribes = observers.map((observer) => observer.subscribe(() => {}));
    const latch: ChallanCreationLatch = { phase: "ready" };
    let selectedCustomer = "customer-a";
    let savedId = "";
    const save = submitChallanCreation(latch, path.create, (header) => { savedId = header.id; },
      (header) => refreshCustomerFinancialQueries(client, header, receivedNow));
    try {
      assert.equal(latch.phase, "submitting");
      selectedCustomer = "customer-b";
      observers.forEach((observer, index) => observer.setOptions({ queryKey: keysB[index],
        queryFn: () => { startsB[index]++; return readsB[index].promise; },
      }));
      response.resolve({ data: challanRow, error: null });
      await flushFinancialReads();
      beforeSaveA.forEach((read) => read.resolve("OLD-A"));
      await flushFinancialReads();
      assert.equal(selectedCustomer, "customer-b");
      assert.equal(savedId, challanRow.id);
      assert.deepEqual(startsA, [2, 2]);
      assert.deepEqual(startsB, [1, 1]);
      for (const key of keysA) {
        assert.notEqual(client.getQueryData(key), "OLD-A");
        assert.equal(customerReadCurrent(client, key), false);
      }
      for (const key of keysB) {
        assert.equal(client.getQueryState(key)?.fetchStatus, "fetching");
        assert.equal(client.getQueryState(key)?.isInvalidated, false);
      }
      postSaveA.forEach((read) => read.resolve("POST-SAVE-A"));
      const saved = await save;
      assert.ok(saved.status === "saved" && !saved.postSaveFailed);
      // Reselecting A reads the verified replacement, never the late old response.
      selectedCustomer = "customer-a";
      observers.forEach((observer, index) => observer.setOptions({
        queryKey: keysA[index], queryFn: queryFnA[index], staleTime: Infinity,
      }));
      for (const key of keysA) {
        assert.equal(client.getQueryData(key), "POST-SAVE-A");
        assert.equal(customerReadCurrent(client, key), true);
      }
      readsB.forEach((read) => read.resolve("UNRELATED-B"));
      await flushFinancialReads();
      for (const key of keysB) assert.equal(client.getQueryData(key), "UNRELATED-B");
      assert.deepEqual(startsB, [1, 1]);
      assert.equal((calls.find(([method]) => method === "rpc")?.[2] as Row).p_customer_id, "customer-a");
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    } finally {
      response.resolve({ data: challanRow, error: null });
      beforeSaveA.forEach((read) => read.resolve("OLD-A"));
      postSaveA.forEach((read) => read.resolve("POST-SAVE-A"));
      readsB.forEach((read) => read.resolve("UNRELATED-B"));
      await save;
      unsubscribes.forEach((unsubscribe) => unsubscribe()); client.clear();
    }
  });

  test(`${path.name} failed customer reads keep the payment form gated; read-only balance Refresh restores submission`, async () => {
    reset();
    rpcResponse.data = challanRow;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const summaryKey = ["office-customer-payment-summary", "factory-a", "customer-a"];
    const candidatesKey = ["office-customer-payment-candidates", "factory-a", "customer-a", "all", "", ""];
    const freshCandidates = [{ challanId: challanRow.id, challanNumber: "42", challanDate: "2026-08-26",
      createdAt: challanRow.created_at, challanStatus: "active" as const, saleTotal: 6000,
      totalPaid: 0, outstandingAmount: 6000, paymentState: "unpaid" as const, isLocked: false, brickLines: [] }];
    client.setQueryData(summaryKey, { totalOutstanding: 8000 });
    client.setQueryData(candidatesKey, [{ ...freshCandidates[0], saleTotal: 8000, outstandingAmount: 8000 }]);
    let failReads = true;
    const summary = new QueryObserver(client, { queryKey: summaryKey, staleTime: Infinity,
      queryFn: async () => { if (failReads) throw new Error("Balance unavailable"); return { totalOutstanding: 6000 }; } });
    const candidate = new QueryObserver(client, { queryKey: candidatesKey, staleTime: Infinity,
      queryFn: async () => { if (failReads) throw new Error("Candidates unavailable"); return freshCandidates; } });
    const unsubscribeSummary = summary.subscribe(() => {});
    const unsubscribeCandidate = candidate.subscribe(() => {});
    const paymentForm = { ...emptyCustomerPaymentForm("2026-08-26"), amount: "6000",
      paymentModes: ["cash" as const], allocations: { [challanRow.id]: "6000" } };
    const canSubmitPayment = () => {
      const currentCandidates = customerReadCurrent(client, candidatesKey) ? candidate.getCurrentResult().data ?? [] : [];
      return getCustomerPaymentFormStatus(paymentForm, currentCandidates).canSubmit
        && customerReadCurrent(client, summaryKey) && customerReadCurrent(client, candidatesKey);
    };
    const latch: ChallanCreationLatch = { phase: "ready" };
    let draft: string | null = "Challan draft";
    let mode = "create";
    let selectedId = "";
    try {
      const saved = await submitChallanCreation(latch, path.create, (header) => {
        draft = null; mode = "detail"; selectedId = header.id;
      }, (header) => refreshCustomerFinancialQueries(client, header, receivedNow));
      assert.ok(saved.status === "saved" && saved.postSaveFailed);
      assert.equal(saved.header.id, challanRow.id);
      assert.equal(selectedId, challanRow.id);
      assert.equal(mode, "detail");
      assert.equal(draft, null);
      assert.equal(customerReadCurrent(client, summaryKey), false);
      assert.equal(customerReadCurrent(client, candidatesKey), false);
      assert.equal(canSubmitPayment(), false);
      assert.equal(client.getQueryData<{ totalOutstanding: number }>(summaryKey)?.totalOutstanding, 8000);
      assert.equal(client.getQueryState(candidatesKey)?.isInvalidated, true);
      // The payment-form balance Refresh intentionally has no payment-history or module targets.
      failReads = false;
      await refreshCustomerFinancialQueries(client, { factoryId: saved.header.factoryId, customerId: saved.header.customerId }, false);
      assert.equal(client.getQueryData<{ totalOutstanding: number }>(summaryKey)?.totalOutstanding, 6000);
      assert.equal(canSubmitPayment(), true, "successful fresh reads must recover the payment submission gate");
      assert.equal(draft, null);
      assert.equal(mode, "detail");
      assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally { unsubscribeSummary(); unsubscribeCandidate(); client.clear(); }
  });
}

for (const path of creationPaths) {
  test(`${path.name} two rapid creation attempts invoke the creation RPC only once`, async () => {
    reset();
    rpcResponse.data = challanRow;
    const latch: ChallanCreationLatch = { phase: "ready" };
    const first = submitChallanCreation(latch, path.create, () => {}, () => {});
    const second = submitChallanCreation(latch, path.create, () => {}, () => {});
    assert.deepEqual(await second, { status: "blocked" });
    assert.equal((await first).status, "saved");
    assert.deepEqual(calls.map(([method, name]) => [method, name]), [["rpc", path.rpc]]);
  });

  test(`${path.name} creation returns the authoritative header through exactly one RPC without line reads`, async () => {
    reset();
    rpcResponse.data = challanRow;
    itemListResponse.error = readFailure;
    flexibleLineListResponse.error = readFailure;
    const saved = await path.create();
    assert.equal(saved.id, challanRow.id);
    assert.equal(saved.factoryId, creationInput.factoryId);
    assert.equal(saved.customerId, creationInput.customerId);
    assert.equal(saved.challanTotal, 3500); // The server total, not the client's 2000 preview.
    assert.equal("items" in saved, false);
    assert.equal("flexibleLines" in saved, false);
    assert.equal("paymentId" in saved, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], path.rpc);
    const args = calls[0][2] as Row;
    assert.deepEqual(args.p_items, [{ brick_type_id: "brick-a", quantity: 1000, pricing_mode: "RATE", rate: 2000 }]);
    assert.deepEqual(args.p_flexible_lines, []);
    assert.doesNotMatch(JSON.stringify(args), /line_amount|challan_total/);
    if (path.name === "Received Now") {
      assert.equal(args.p_payment_amount, 1250.75);
      assert.equal(args.p_payment_mode, "upi");
      assert.equal(args.p_payment_date, "2026-08-26");
    }
  });

  test(`${path.name} explicit database rejection stays a failure and performs no reads`, async () => {
    reset();
    rpcResponse.error = { code: "P3011", message: "Empty Challan", details: null, hint: null };
    await assert.rejects(path.create, (error: unknown) => error instanceof ChallanServiceError && error.code === "P3011");
    assert.deepEqual(calls.map(([method, name]) => [method, name]), [["rpc", path.rpc]]);
  });

  test(`${path.name} missing, malformed and zero UUIDs or invalid authoritative headers are UNKNOWN`, async () => {
    const invalidRows: Array<Row | null> = [
      null, { ...challanRow, id: undefined }, { ...challanRow, id: "42" },
      { ...challanRow, id: "00000000-0000-0000-0000-000000000000" },
      { ...challanRow, factory_id: "factory-other" }, { ...challanRow, customer_id: "customer-other" },
      { ...challanRow, challan_date: "2026-08-27" }, { ...challanRow, challan_total: null },
      { ...challanRow, challan_total: "" }, { ...challanRow, challan_total: "NaN" },
      { ...challanRow, challan_total: Infinity }, { ...challanRow, challan_total: "-0.01" },
      { ...challanRow, status: "void" }, { ...challanRow, is_locked: undefined },
      { ...challanRow, customer_name_snapshot: undefined }, { ...challanRow, created_at: "invalid" },
    ];
    for (const row of invalidRows) {
      reset();
      rpcResponse.data = row;
      await assert.rejects(path.create, ChallanUnknownOutcomeError);
      assert.equal(calls.length, 1, JSON.stringify(row));
      assert.equal(calls[0][1], path.rpc);
    }
  });

  test(`${path.name} thrown, rejected and transport-error responses are UNKNOWN with no automatic retry`, async () => {
    for (const failure of ["throw", "reject", "transport"] as const) {
      reset();
      if (failure === "transport") {
        rpcResponse = { data: null, status: 0, error: { code: "", message: "Failed to fetch", details: null, hint: null } };
      } else rpcFailure = failure;
      await assert.rejects(path.create, ChallanUnknownOutcomeError);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1], path.rpc);
    }
  });

  test(`${path.name} a lost RPC response preserves the draft and cannot retry creation on that mounted latch`, async () => {
    reset();
    rpcFailure = "reject";
    const latch: ChallanCreationLatch = { phase: "ready" };
    let draft: string | null = "unsaved lines and Received Now inputs";
    const result = await submitChallanCreation(latch, path.create, () => { draft = null; }, () => {});
    assert.equal(result.status, "unknown");
    assert.equal(draft, "unsaved lines and Received Now inputs");
    assert.equal(latch.phase, "unknown");
    assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
    assert.deepEqual(calls.map(([method, name]) => [method, name]), [["rpc", path.rpc]]);
  });

  test(`${path.name} failed selected-detail loading preserves saved identity; QueryClient Retry only reads`, async () => {
    reset();
    rpcResponse.data = challanRow;
    singleResponse.data = challanRow;
    itemListResponse.error = readFailure;
    const latch: ChallanCreationLatch = { phase: "ready" };
    let draft: { receivedNowAmount?: number } | null = path.name === "Received Now" ? { receivedNowAmount: 1250.75 } : {};
    let mode = "create";
    let selectedId = "";
    const outcome = await submitChallanCreation(latch, path.create,
      () => { draft = null; },
      (header) => { selectedId = header.id; mode = "detail"; },
    );
    assert.equal(outcome.status, "saved");
    assert.equal(mode, "detail");
    assert.equal(selectedId, challanRow.id);
    assert.equal(draft, null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = ["office-sales-challan", creationInput.factoryId, selectedId];
    const read = () => client.fetchQuery({ queryKey: key, queryFn: () => getChallan(creationInput.factoryId, selectedId) });
    try {
      await assert.rejects(read, ChallanServiceError);
      assert.equal(client.getQueryData(key), undefined); // No fabricated empty saved lines/header-only detail.
      assert.equal(challanDetailLoadMessage(client.getQueryState(key)?.error, true), ATLAS_UI_STRINGS.challan.detailsUnavailable);
      assert.equal(mode, "detail");
      assert.equal(selectedId, challanRow.id);
      assert.equal(draft, null);
      assert.equal(latch.phase, "saved");
      assert.deepEqual(await submitChallanCreation(latch, path.create, () => {}, () => {}), { status: "blocked" });
      itemListResponse = { data: itemRows, error: null };
      flexibleLineListResponse = { data: flexibleLineRows, error: null };
      const details = await read();
      assert.equal(details.id, selectedId);
      assert.deepEqual(details.items.map((item) => item.lineAmount), [3000, 500]);
      assert.deepEqual(details.flexibleLines.map((line) => line.amount), [0, 1000, 2000]);
      assert.equal(details.challanTotal, 3500);
      assert.equal(latch.phase, "saved");
      assert.deepEqual(calls.filter(([method]) => method === "rpc").map(([, name]) => name), [path.rpc]);
    } finally { client.clear(); }
  });
}

test("NOTE-only zero total and flexible-only authoritative headers remain valid without invented line arrays", async () => {
  for (const total of [0, 125.75]) {
    reset();
    rpcResponse.data = { ...challanRow, challan_total: total };
    const saved = await createChallan({ ...creationInput, items: [], flexibleLines: total === 0
      ? [{ lineType: "NOTE", orderIndex: 0, particulars: "Delivery instruction" }]
      : [{ lineType: "EXTRA_CHARGE", orderIndex: 0, particulars: "Transport", amount: total }],
    });
    assert.equal(saved.challanTotal, total);
    assert.equal("items" in saved, false);
    assert.equal("flexibleLines" in saved, false);
    assert.equal(calls.length, 1);
  }
});

test("the canonical detail reader distinguishes no record from unavailable lines", async () => {
  reset();
  await assert.rejects(() => getChallan("factory-a", challanRow.id), ChallanNotFoundError);
  assert.equal(challanDetailLoadMessage(new ChallanNotFoundError(), true), ATLAS_UI_STRINGS.challan.notFound);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 0);
  assert.equal(calls.filter(([method]) => method === "from").length, 1);
  singleResponse.data = challanRow;
  flexibleLineListResponse.error = readFailure;
  await assert.rejects(() => getChallan("factory-a", challanRow.id), ChallanServiceError);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 0);
});

test("printable profile loads existing values and saves only through its controlled RPC", async () => {
  reset();
  singleResponse.data = factoryRow;
  assert.deepEqual(await getFactoryPrintableProfile("factory-a"), {
    id: "factory-a",
    name: "Atlas Bricks",
    businessDescription: "Brick manufacturer",
    village: "Rampur",
    postOffice: "Rampur Head",
    policeStation: "Kotwali",
    district: "Jaipur",
    state: "Rajasthan",
    address: "Factory Road",
    mobile: "9000000000",
    gstin: "19ABCDE1234F1Z5",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-26T10:00:00Z",
  });
  assert.deepEqual(calls, [
    ["from", "factories"],
    ["select", "id, name, business_description, village, post_office, police_station, district, state, address, mobile, gstin, created_at, updated_at"],
    ["eq", "id", "factory-a"],
    ["maybeSingle"],
  ]);

  reset();
  rpcResponse.data = factoryRow;
  await updateFactoryPrintableProfile({
    factoryId: "factory-a",
    name: " Atlas Bricks ",
    businessDescription: " Brick manufacturer ",
    village: " Rampur ",
    postOffice: " Rampur   Head ",
    policeStation: " Kotwali ",
    district: " Jaipur ",
    state: " Rajasthan ",
    mobile: " 9000000000 ",
    gstin: " 19abcde1234f1z5 ",
  });
  assert.deepEqual(calls, [["rpc", "update_factory_printable_profile", {
    p_factory_id: "factory-a",
    p_name: "Atlas Bricks",
    p_business_description: "Brick manufacturer",
    p_village: "Rampur",
    p_post_office: "Rampur Head",
    p_police_station: "Kotwali",
    p_district: "Jaipur",
    p_state: "Rajasthan",
    p_mobile: "9000000000",
    p_gstin: "19ABCDE1234F1Z5",
  }]]);

  reset();
  rpcResponse.data = { ...factoryRow, gstin: null };
  assert.equal((await updateFactoryPrintableProfile({
    factoryId: "factory-a",
    name: "Atlas Bricks",
    businessDescription: "Brick manufacturer",
    village: "Rampur",
    postOffice: "Rampur Head",
    policeStation: "Kotwali",
    district: "Jaipur",
    state: "Rajasthan",
    mobile: "9000000000",
    gstin: "   ",
  })).gstin, null);
  assert.equal((calls[0]?.[2] as Row).p_gstin, null);
});

test("customer master writes use controlled RPCs and normalized profile values", async () => {
  reset();
  rpcResponse.data = customerRow;
  assert.equal((await createCustomer({
    factoryId: "factory-a",
    name: "  Anand   Traders ",
    address: " Address A ",
    mobile: " 9111111111 ",
  })).name, "Anand Traders");
  assert.deepEqual(calls, [["rpc", "create_customer", {
    p_factory_id: "factory-a",
    p_name: "Anand Traders",
    p_address: "Address A",
    p_mobile: "9111111111",
  }]]);

  reset();
  rpcResponse.data = { ...customerRow, address: "Address B" };
  const updated = await updateCustomer({
    factoryId: "factory-a",
    customerId: "customer-a",
    name: "  Anand   Traders ",
    address: " Address B ",
    mobile: " 9222222222 ",
  });
  assert.equal(updated.id, "customer-a");
  assert.equal(updated.address, "Address B");
  assert.deepEqual(calls, [["rpc", "update_customer", {
    p_factory_id: "factory-a",
    p_customer_id: "customer-a",
    p_name: "Anand Traders",
    p_address: "Address B",
    p_mobile: "9222222222",
  }]]);
});

test("create payload contains inputs only while returned amounts come from the database", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;

  const result = await createAndReadChallan({
    factoryId: "factory-a",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 450.5,
    items: [
      { brickTypeId: "brick-a", quantity: 1500, ratePer1000Bricks: 2000 },
      { brickTypeId: "brick-b", quantity: 500, ratePer1000Bricks: 1000 },
    ],
  });

  const rpcCall = calls[0];
  assert.deepEqual(rpcCall, ["rpc", "create_challan", {
    p_factory_id: "factory-a",
    p_challan_number: null,
    p_challan_date: "2026-08-26",
    p_customer_id: "customer-a",
    p_vehicle_id: "vehicle-a",
    p_trip_labour_wage: 450.5,
    p_items: [
      { brick_type_id: "brick-a", quantity: 1500, pricing_mode: "RATE", rate: 2000 },
      { brick_type_id: "brick-b", quantity: 500, pricing_mode: "RATE", rate: 1000 },
    ],
    p_flexible_lines: [],
  }]);
  assert.doesNotMatch(JSON.stringify(rpcCall[2]), /line_amount|challan_total/i);
  assert.equal(result.challanNumber, "42");
  assert.equal(result.challanTotal, 3500);
  assert.deepEqual(result.items.map((item) => item.lineAmount), [3000, 500]);
  assert.deepEqual(result.items.map((item) => item.pricingUnit), [
    "PER_1000_BRICKS",
    "PER_1000_BRICKS",
  ]);
  assert.deepEqual(result.items.map((item) => item.lineCategory), [
    "BRICK_REVENUE",
    "BRICK_REVENUE",
  ]);
  assert.deepEqual(result.flexibleLines, []);
});

test("Trip Labour Wage keeps exact paise through save response and re-read mapping", async () => {
  for (const wage of [300, 299.99, 300.01] as const) {
    reset();
    rpcResponse.data = {
      ...challanRow,
      trip_labour_wage: wage.toFixed(2),
      tractor_labour_rate_snapshot: wage.toFixed(2),
    };
    singleResponse.data = rpcResponse.data;
    itemListResponse.data = itemRows;

    const saved = await createAndReadChallan({
      factoryId: "factory-a",
      challanDate: "2026-08-26",
      customerId: "customer-a",
      vehicleId: "vehicle-a",
      tripLabourWage: wage,
      items: [{ brickTypeId: "brick-a", quantity: 1500, ratePer1000Bricks: 2000 }],
    });
    assert.equal((calls[0]?.[2] as Row).p_trip_labour_wage, wage);
    assert.equal(saved.tripLabourWage, wage);

    calls.length = 0;
    const reloaded = await getChallan("factory-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(reloaded.tripLabourWage, wage);
  }
});

test("amount-driven brick row sends exact decimal Amount and reloads database-derived Rate", async () => {
  reset();
  rpcResponse.data = { ...challanRow, challan_total: "80000.00" };
  singleResponse.data = rpcResponse.data;
  itemListResponse.data = [{
    ...itemRows[0],
    quantity: "12347",
    pricing_mode: "AMOUNT",
    rate_per_1000_bricks: "6479.306714182",
    line_amount: "80000.00",
  }];

  const saved = await createAndReadChallan({
    factoryId: "factory-a",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: null,
    tripLabourWage: null,
    items: [{
      brickTypeId: "brick-a",
      quantity: 12347,
      pricingMode: "AMOUNT",
      lineAmount: "80000",
    }],
  });
  assert.deepEqual((calls[0]?.[2] as Row).p_items, [{
    brick_type_id: "brick-a",
    quantity: 12347,
    pricing_mode: "AMOUNT",
    amount: "80000.00",
  }]);
  assert.deepEqual({
    pricingMode: saved.items[0]?.pricingMode,
    rate: saved.items[0]?.ratePer1000Bricks,
    amount: saved.items[0]?.lineAmount,
    total: saved.challanTotal,
  }, {
    pricingMode: "AMOUNT",
    rate: 6479.306714182,
    amount: 80000,
    total: 80000,
  });

  calls.length = 0;
  const reloaded = await getChallan("factory-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(reloaded.items[0]?.lineAmount, 80000);
  assert.equal(reloaded.challanTotal, 80000);
});

test("flexible NOTE and EXTRA_CHARGE lines use the A2 overload and map database-authoritative values", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;
  flexibleLineListResponse.data = flexibleLineRows;

  const result = await createAndReadChallan({
    factoryId: "factory-a",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 450.5,
    items: [{ brickTypeId: "brick-a", quantity: 1500, ratePer1000Bricks: 2000 }],
    flexibleLines: [
      { lineType: "NOTE", orderIndex: 0, particulars: " Deliver   before noon " },
      {
        lineType: "EXTRA_CHARGE",
        orderIndex: 1,
        particulars: "Loading charge",
        quantity: 2.5,
        rate: 400,
      },
      {
        lineType: "EXTRA_CHARGE",
        orderIndex: 2,
        particulars: "Transport charge",
        amount: 2000,
      },
    ],
  });

  assert.deepEqual(calls[0], ["rpc", "create_challan", {
    p_factory_id: "factory-a",
    p_challan_number: null,
    p_challan_date: "2026-08-26",
    p_customer_id: "customer-a",
    p_vehicle_id: "vehicle-a",
    p_trip_labour_wage: 450.5,
    p_items: [{ brick_type_id: "brick-a", quantity: 1500, pricing_mode: "RATE", rate: 2000 }],
    p_flexible_lines: [
      { line_type: "NOTE", order_index: 0, particulars: "Deliver before noon" },
      {
        line_type: "EXTRA_CHARGE",
        order_index: 1,
        particulars: "Loading charge",
        quantity: 2.5,
        rate: 400,
      },
      {
        line_type: "EXTRA_CHARGE",
        order_index: 2,
        particulars: "Transport charge",
        amount: 2000,
      },
    ],
  }]);
  assert.equal(result.challanTotal, 3500);
  assert.deepEqual(result.flexibleLines.map((line) => ({
    type: line.lineType,
    category: line.lineCategory,
    amount: line.amount,
  })), [
    { type: "NOTE", category: "NON_FINANCIAL", amount: 0 },
    { type: "EXTRA_CHARGE", category: "OTHER_REVENUE", amount: 1000 },
    { type: "EXTRA_CHARGE", category: "OTHER_REVENUE", amount: 2000 },
  ]);
});

test("A3 service permits a NOTE-only create payload and returns the zero-total document", async () => {
  reset();
  rpcResponse.data = { ...challanRow, challan_total: "0.00" };
  itemListResponse.data = [];
  flexibleLineListResponse.data = [flexibleLineRows[0]];

  const result = await createAndReadChallan({
    factoryId: "factory-a",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: null,
    tripLabourWage: null,
    items: [],
    flexibleLines: [{
      lineType: "NOTE",
      orderIndex: 0,
      particulars: "Delivery postponed by customer",
    }],
  });

  assert.deepEqual(calls[0], ["rpc", "create_challan", {
    p_factory_id: "factory-a",
    p_challan_number: null,
    p_challan_date: "2026-08-26",
    p_customer_id: "customer-a",
    p_vehicle_id: null,
    p_trip_labour_wage: null,
    p_items: [],
    p_flexible_lines: [{
      line_type: "NOTE",
      order_index: 0,
      particulars: "Delivery postponed by customer",
    }],
  }]);
  assert.equal(result.challanTotal, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.flexibleLines[0]?.lineType, "NOTE");
});

test("flexible-line contradictions and incomplete calculation pairs stop before a request", async () => {
  reset();
  const common = {
    factoryId: "factory-a",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: null,
    tripLabourWage: null,
    items: [{ brickTypeId: "brick-a", quantity: 1000, ratePer1000Bricks: 2000 }],
  };

  await assert.rejects(
    () => createChallan({
      ...common,
      flexibleLines: [{
        lineType: "NOTE",
        orderIndex: 0,
        particulars: "Should be non-financial",
        amount: 500,
      } as never],
    }),
    /NOTE cannot contain amount/,
  );
  await assert.rejects(
    () => createChallan({
      ...common,
      flexibleLines: [{
        lineType: "EXTRA_CHARGE",
        orderIndex: 0,
        particulars: "Loading",
        quantity: 2,
        rate: 400,
        amount: 900,
      }],
    }),
    /must equal quantity multiplied by rate/,
  );
  await assert.rejects(
    () => createChallan({
      ...common,
      flexibleLines: [{
        lineType: "EXTRA_CHARGE",
        orderIndex: 0,
        particulars: "Loading",
        quantity: 2,
      } as never],
    }),
    /quantity and rate must be supplied together/,
  );
  assert.equal(calls.length, 0);
});

test("update and void use their controlled RPCs and never expose delete or lock writes", async () => {
  reset();
  rpcResponse.data = { ...challanRow, challan_total: "3000" };
  itemListResponse.data = [{ ...itemRows[0], quantity: 2500, line_amount: 3000 }];
  const updated = await updateChallan({
    factoryId: "factory-a",
    challanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    challanDate: "2026-08-27",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 500,
    items: [{ brickTypeId: "brick-a", quantity: 2500, ratePer1000Bricks: 1200 }],
  });
  assert.equal(calls[0][1], "update_challan");
  assert.equal((calls[0][2] as Row).p_flexible_lines, null);
  assert.equal(updated.challanTotal, 3000);
  assert.deepEqual(updated.items.map((item) => item.lineAmount), [3000]);
  assert.deepEqual(updated.flexibleLines, []);
  assert.deepEqual(calls.filter(([method]) => method === "from").map(([, table]) => table), ["challan_items", "challan_flexible_lines"]);

  reset();
  rpcResponse.data = {
    ...challanRow,
    status: "void",
    voided_at: "2026-08-27T11:00:00Z",
  };
  itemListResponse.data = itemRows;
  const voided = await voidChallan("factory-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.deepEqual(calls[0], ["rpc", "void_challan", {
    p_factory_id: "factory-a",
    p_challan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }]);
  assert.equal(voided.status, "void");
  assert.deepEqual(voided.items.map((item) => item.lineAmount), [3000, 500]);
  assert.deepEqual(voided.flexibleLines, []);
  assert.deepEqual(calls.filter(([method]) => method === "from").map(([, table]) => table), ["challan_items", "challan_flexible_lines"]);
});

test("C1 edit save distinguishes omitted flexible lines from an explicit complete replacement", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;
  flexibleLineListResponse.data = [];
  await updateChallan({
    factoryId: "factory-a",
    challanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    challanDate: "2026-08-27",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 500,
    items: [{ brickTypeId: "brick-a", quantity: 1500, ratePer1000Bricks: 2000 }],
    flexibleLines: [],
  });
  assert.deepEqual((calls[0][2] as Row).p_flexible_lines, []);

  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;
  flexibleLineListResponse.data = flexibleLineRows;
  await updateChallan({
    factoryId: "factory-a",
    challanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    challanDate: "2026-08-27",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 500,
    items: [{ brickTypeId: "brick-a", quantity: 1500, ratePer1000Bricks: 2000 }],
    flexibleLines: [
      { lineType: "NOTE", orderIndex: 0, particulars: "Updated note" },
      { lineType: "EXTRA_CHARGE", orderIndex: 1, particulars: "Loading", amount: 2000 },
    ],
  });
  assert.deepEqual((calls[0][2] as Row).p_flexible_lines, [
    { line_type: "NOTE", order_index: 0, particulars: "Updated note" },
    {
      line_type: "EXTRA_CHARGE", order_index: 1,
      particulars: "Loading", amount: 2000,
    },
  ]);
});

test("invalid client values stop before any request and lock failures stay typed", async () => {
  reset();
  await assert.rejects(
    () => createChallan({
      factoryId: "factory-a",
      challanDate: "2026-02-30",
      customerId: "customer-a",
      vehicleId: null,
      tripLabourWage: null,
      items: [{ brickTypeId: "brick-a", quantity: 1000, ratePer1000Bricks: 2000 }],
    }),
    /valid YYYY-MM-DD/,
  );
  await assert.rejects(
    () => createChallan({
      factoryId: "factory-a",
      challanDate: "2026-08-26",
      customerId: "customer-a",
      vehicleId: null,
      tripLabourWage: null,
      items: [{ brickTypeId: "brick-a", quantity: 1.5, ratePer1000Bricks: 2000 }],
    }),
    /positive whole number/,
  );
  assert.equal(calls.length, 0);

  rpcResponse.error = {
    message: "Locked.",
    code: "P3005",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => voidChallan("factory-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    (error: unknown) => error instanceof ChallanServiceError
      && error.code === "P3005"
      && /payment-locked/.test(error.message),
  );

  reset();
  rpcResponse.error = {
    message: "Empty Challan.",
    code: "P3011",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => createChallan({
      factoryId: "factory-a",
      challanDate: "2026-08-26",
      customerId: "customer-a",
      vehicleId: null,
      tripLabourWage: null,
      items: [],
      flexibleLines: [],
    }),
    (error: unknown) => error instanceof ChallanServiceError
      && error.code === "P3011"
      && /at least one brick, NOTE, or EXTRA_CHARGE line/.test(error.message),
  );

});
