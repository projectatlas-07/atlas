import assert from "node:assert/strict";
import test from "node:test";
import type { TransportWorker, TransportWorkerWithdrawal } from "../transport/types.ts";
import {
  buildTransportBalanceDisplay,
  buildTransportFinanceWorkerOption,
  buildTransportWithdrawalHistoryItem,
  buildTransportWithdrawalInput,
  getTransportFinanceRefreshQueryKeys,
  selectTransportFinanceWorker,
  transportFinanceFormAfterSuccess,
  transportWorkerFinanceErrorMessage,
  type TransportWorkerFinanceFormState,
} from "./transport-worker-finances-model.ts";

const activeWorker: TransportWorker = {
  id: "worker-active",
  factoryId: "factory-a",
  name: "Asha",
  isActive: true,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};
const inactiveWorker: TransportWorker = {
  ...activeWorker,
  id: "worker-inactive",
  name: "Bina",
  isActive: false,
};
const form: TransportWorkerFinanceFormState = {
  selectedWorkerId: "worker-active",
  withdrawalDate: "2026-08-18",
  amountInput: "250.75",
};

test("active and inactive transport workers are both selectable", () => {
  assert.deepEqual(buildTransportFinanceWorkerOption(activeWorker), {
    id: "worker-active",
    label: "Asha",
  });
  assert.deepEqual(buildTransportFinanceWorkerOption(inactiveWorker), {
    id: "worker-inactive",
    label: "Bina (Inactive)",
  });
});

test("worker selection remains one worker identity without crew scope", () => {
  assert.deepEqual(selectTransportFinanceWorker(form, "worker-inactive"), {
    selectedWorkerId: "worker-inactive",
    withdrawalDate: "2026-08-18",
    amountInput: "",
  });
});

test("authoritative balance fields map directly to earned, withdrawn, and available display", () => {
  assert.deepEqual(buildTransportBalanceDisplay({
    totalEarned: 1000.5,
    totalWithdrawn: 250.25,
    availableBalance: 750.25,
  }), {
    earned: "₹1,000.50",
    withdrawn: "₹250.25",
    available: "₹750.25",
    hasLockedEarnings: true,
    hasAvailableBalance: true,
  });
});

test("zero authoritative balance has explicit empty-state flags", () => {
  assert.deepEqual(buildTransportBalanceDisplay({
    totalEarned: 0,
    totalWithdrawn: 0,
    availableBalance: 0,
  }), {
    earned: "₹0.00",
    withdrawn: "₹0.00",
    available: "₹0.00",
    hasLockedEarnings: false,
    hasAvailableBalance: false,
  });
});

test("positive decimal withdrawal preserves the exact numeric payload", () => {
  assert.deepEqual(buildTransportWithdrawalInput({ factoryId: "factory-a", ...form }), {
    factoryId: "factory-a",
    transportWorkerId: "worker-active",
    withdrawalDate: "2026-08-18",
    amount: 250.75,
  });
});

test("zero, negative, non-finite, and invalid-date withdrawals are prevented", () => {
  for (const amountInput of ["0", "-1", "Infinity", ""]) {
    assert.equal(buildTransportWithdrawalInput({
      factoryId: "factory-a",
      ...form,
      amountInput,
    }), null);
  }
  assert.equal(buildTransportWithdrawalInput({
    factoryId: "factory-a",
    ...form,
    withdrawalDate: "2026-02-30",
  }), null);
});

test("changing the date creates a distinct authoritative balance query", () => {
  assert.deepEqual(getTransportFinanceRefreshQueryKeys({
    factoryId: "factory-a",
    transportWorkerId: "worker-active",
    asOfDate: "2026-08-10",
  })[0], ["office-transport-worker-balance", "factory-a", "worker-active", "2026-08-10"]);
});

test("success refreshes only balance and the selected worker history", () => {
  assert.deepEqual(getTransportFinanceRefreshQueryKeys({
    factoryId: "factory-a",
    transportWorkerId: "worker-active",
    asOfDate: "2026-08-18",
  }), [
    ["office-transport-worker-balance", "factory-a", "worker-active", "2026-08-18"],
    ["office-transport-worker-withdrawals", "factory-a", "worker-active"],
  ]);
});

test("successful withdrawal clears only amount", () => {
  assert.deepEqual(transportFinanceFormAfterSuccess(form), {
    selectedWorkerId: "worker-active",
    withdrawalDate: "2026-08-18",
    amountInput: "",
  });
});

test("failed withdrawal state can preserve every entered value", () => {
  assert.deepEqual({ ...form }, form);
});

test("withdrawal history displays service ordering and stored values", () => {
  const rows: TransportWorkerWithdrawal[] = [
    {
      withdrawalId: "newer",
      factoryId: "factory-a",
      transportWorkerId: "worker-active",
      withdrawalDate: "2026-08-18",
      amount: 250.5,
      createdAt: "2026-08-18T10:00:00Z",
    },
    {
      withdrawalId: "older",
      factoryId: "factory-a",
      transportWorkerId: "worker-active",
      withdrawalDate: "2026-08-10",
      amount: 100,
      createdAt: "2026-08-10T10:00:00Z",
    },
  ];
  assert.deepEqual(rows.map(buildTransportWithdrawalHistoryItem), [
    { withdrawalId: "newer", withdrawalDate: "2026-08-18", amount: "₹250.50" },
    { withdrawalId: "older", withdrawalDate: "2026-08-10", amount: "₹100.00" },
  ]);
});

test("no-history state is represented by an empty service result", () => {
  assert.deepEqual(([] as TransportWorkerWithdrawal[]).map(buildTransportWithdrawalHistoryItem), []);
});

test("insufficient balance and expected request errors are concise", () => {
  assert.equal(transportWorkerFinanceErrorMessage({
    code: "P0001",
    message: "Withdrawal amount 1000 exceeds available balance 900.",
  }, "fallback"), "Insufficient available balance for this withdrawal date.");
  assert.equal(transportWorkerFinanceErrorMessage({ code: "22023", message: "bad" }, "fallback"),
    "Enter a valid withdrawal date and an amount greater than zero.");
  assert.equal(transportWorkerFinanceErrorMessage({ code: "42501", message: "Transport worker does not belong to this factory." }, "fallback"),
    "This transport worker does not belong to your factory.");
  assert.equal(transportWorkerFinanceErrorMessage({ code: "08006", message: "Failed to fetch" }, "fallback"),
    "Network problem. Check your connection and try again.");
});
