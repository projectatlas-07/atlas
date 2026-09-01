import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type ErrorRow = { message: string; code: string; details: string | null; hint: string | null };
type Response = { data: Row | Row[] | null; error: ErrorRow | null };
type Call = [string, string, Row];

const calls: Call[] = [];
const responses = new Map<string, Response>();
const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(responses.get(functionName) ?? { data: null, error: null });
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  CashBookServiceError,
  createCashBookManualEntry,
  getCashBookDay,
  initializeCashBook,
  voidCashBookManualEntry,
} = await import("./cash-book-service.ts");

const requestId = "10000000-0000-4000-8000-000000000001";
const initializationRow = {
  factory_id: "factory-a",
  start_date: "2026-08-27",
  opening_balance: "20000",
  created_at: "2026-08-27T09:00:00Z",
  created_by: "user-a",
};
const manualRow = {
  id: requestId,
  factory_id: "factory-a",
  business_date: "2026-08-27",
  direction: "in",
  amount: "100000",
  payment_mode: "bank_transfer",
  party_details: "Owner temporary money",
  note: "Working capital",
  status: "active",
  created_at: "2026-08-27T10:00:00Z",
  created_by: "user-a",
  voided_at: null,
  voided_by: null,
};

function reset(): void {
  calls.length = 0;
  responses.clear();
}

test("initializes one factory Cash Book through the controlled RPC", async () => {
  reset();
  responses.set("initialize_cash_book", { data: initializationRow, error: null });
  assert.deepEqual(await initializeCashBook({
    factoryId: "factory-a", startDate: "2026-08-27", openingBalance: 20_000,
  }), {
    factoryId: "factory-a",
    startDate: "2026-08-27",
    openingBalance: 20_000,
    createdAt: "2026-08-27T09:00:00Z",
    createdBy: "user-a",
  });
  assert.deepEqual(calls[0], ["rpc", "initialize_cash_book", {
    p_factory_id: "factory-a",
    p_start_date: "2026-08-27",
    p_opening_balance: 20_000,
  }]);
});

test("creates an idempotent manual movement with normalized details through its RPC", async () => {
  reset();
  responses.set("create_cash_book_manual_entry", { data: manualRow, error: null });
  const entry = await createCashBookManualEntry({
    factoryId: "factory-a",
    requestId,
    businessDate: "2026-08-27",
    direction: "in",
    amount: 100_000,
    paymentMode: "bank_transfer",
    partyDetails: "  Owner   temporary money ",
    note: "  Working   capital ",
  });
  assert.equal(entry.paymentMode, "bank_transfer");
  assert.equal(entry.partyDetails, "Owner temporary money");
  assert.deepEqual(calls[0], ["rpc", "create_cash_book_manual_entry", {
    p_factory_id: "factory-a",
    p_entry_id: requestId,
    p_business_date: "2026-08-27",
    p_direction: "in",
    p_amount: 100_000,
    p_payment_mode: "bank_transfer",
    p_party_details: "Owner temporary money",
    p_note: "Working capital",
  }]);
});

test("every supported new payment mode round-trips and unsupported modes stop locally", async () => {
  for (const mode of ["cash", "upi", "bank_transfer", "cheque", "other"] as const) {
    reset();
    responses.set("create_cash_book_manual_entry", {
      data: { ...manualRow, payment_mode: mode }, error: null,
    });
    const entry = await createCashBookManualEntry({
      factoryId: "factory-a", requestId, businessDate: "2026-08-27",
      direction: "out", amount: 5_000, paymentMode: mode, partyDetails: "Tractor repair",
    });
    assert.equal(entry.paymentMode, mode);
  }

  reset();
  await assert.rejects(
    () => createCashBookManualEntry({
      factoryId: "factory-a", requestId, businessDate: "2026-08-27",
      direction: "out", amount: 5_000, paymentMode: "card" as "cash", partyDetails: "Repair",
    }),
    /supported payment mode/,
  );
  assert.equal(calls.length, 0);
});

test("voids a manual entry only through the controlled lifecycle RPC", async () => {
  reset();
  responses.set("void_cash_book_manual_entry", {
    data: { ...manualRow, status: "void", voided_at: "2026-08-27T11:00:00Z", voided_by: "user-a" },
    error: null,
  });
  const entry = await voidCashBookManualEntry("factory-a", requestId);
  assert.equal(entry.status, "void");
  assert.deepEqual(calls[0], ["rpc", "void_cash_book_manual_entry", {
    p_factory_id: "factory-a", p_entry_id: requestId,
  }]);
});

test("reads a derived day with customer, manual, and Vehicle wage source rows", async () => {
  reset();
  responses.set("get_cash_book_day_summary", {
    data: [{
      business_date: "2026-08-27", opening_balance: "20000",
      total_money_in: "131200", total_money_out: "81200", closing_balance: "70000",
    }],
    error: null,
  });
  responses.set("list_cash_book_day_entries", {
    data: [{
      source_type: "customer_payment", source_id: "payment-a", business_date: "2026-08-27",
      direction: "in", amount: "30000", payment_mode: "upi", counterparty: "Customer A",
      description: "Challans #12, #15", note: "Reference", source_status: "active",
      created_at: "2026-08-27T10:00:00Z",
    }, {
      source_type: "vehicle_wage_payment_reversal", source_id: "wage-reversal-a", business_date: "2026-08-27",
      direction: "in", amount: "1200", payment_mode: "unspecified", counterparty: "WB12AB1234",
      description: "Vehicle Wage Payment Reversal", note: "Wrong amount", source_status: "active",
      created_at: "2026-08-27T10:00:30Z",
    }, {
      source_type: "manual_cash_entry", source_id: "manual-in", business_date: "2026-08-27",
      direction: "in", amount: "100000", payment_mode: "bank_transfer", counterparty: "Owner temporary money",
      description: "Manual Money In", note: null, source_status: "active",
      created_at: "2026-08-27T10:01:00Z",
    }, {
      source_type: "manual_cash_entry", source_id: "manual-out", business_date: "2026-08-27",
      direction: "out", amount: "80000", payment_mode: "cash", counterparty: "General payment",
      description: "Manual Money Out", note: null, source_status: "active",
      created_at: "2026-08-27T10:02:00Z",
    }, {
      source_type: "vehicle_wage_payment", source_id: "wage-payment-a", business_date: "2026-08-27",
      direction: "out", amount: "1200", payment_mode: "unspecified", counterparty: "WB12AB1234",
      description: "Vehicle Wage Payment", note: "Weekly settlement", source_status: "active",
      created_at: "2026-08-27T10:03:00Z",
    }],
    error: null,
  });
  const day = await getCashBookDay("factory-a", "2026-08-27");
  assert.deepEqual(day.summary, {
    businessDate: "2026-08-27", openingBalance: 20_000,
    totalMoneyIn: 131_200, totalMoneyOut: 81_200, closingBalance: 70_000,
  });
  assert.equal(day.moneyIn.length, 3);
  assert.equal(day.moneyOut.length, 2);
  assert.deepEqual(day.moneyIn[0], {
    sourceType: "customer_payment", sourceId: "payment-a", businessDate: "2026-08-27",
    direction: "in", amount: 30_000, paymentMode: "upi", counterparty: "Customer A",
    description: "Challans #12, #15", note: "Reference", sourceStatus: "active",
    createdAt: "2026-08-27T10:00:00Z",
  });
  assert.deepEqual(day.moneyOut[1], {
    sourceType: "vehicle_wage_payment", sourceId: "wage-payment-a", businessDate: "2026-08-27",
    direction: "out", amount: 1_200, paymentMode: "unspecified", counterparty: "WB12AB1234",
    description: "Vehicle Wage Payment", note: "Weekly settlement", sourceStatus: "active",
    createdAt: "2026-08-27T10:03:00Z",
  });
  assert.deepEqual(day.moneyIn[1], {
    sourceType: "vehicle_wage_payment_reversal", sourceId: "wage-reversal-a", businessDate: "2026-08-27",
    direction: "in", amount: 1_200, paymentMode: "unspecified", counterparty: "WB12AB1234",
    description: "Vehicle Wage Payment Reversal", note: "Wrong amount", sourceStatus: "active",
    createdAt: "2026-08-27T10:00:30Z",
  });
});

test("invalid local dates, non-positive amounts, and factory errors remain explicit", async () => {
  reset();
  await assert.rejects(
    () => getCashBookDay("factory-a", "2026-02-30"),
    /valid local calendar date/,
  );
  await assert.rejects(
    () => createCashBookManualEntry({
      factoryId: "factory-a", requestId, businessDate: "2026-08-27",
      direction: "out", amount: 0, paymentMode: "cash", partyDetails: "Repair",
    }),
    /must be positive/,
  );
  assert.equal(calls.length, 0);

  responses.set("get_cash_book_day_summary", {
    data: null,
    error: { message: "Access denied", code: "42501", details: null, hint: null },
  });
  responses.set("list_cash_book_day_entries", { data: [], error: null });
  await assert.rejects(
    () => getCashBookDay("factory-b", "2026-08-27"),
    (error: unknown) => error instanceof CashBookServiceError && error.code === "42501",
  );
});
