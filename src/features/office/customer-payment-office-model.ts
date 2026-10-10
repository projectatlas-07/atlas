import type {
  ChallanHeader,
  CreateCustomerPaymentWithMethodsInput,
  Customer,
  CustomerOutstandingChallan,
  CustomerPayment,
  CustomerPaymentResult,
  NewCustomerPaymentMode,
} from "@/features/sales/types";
import type { Query, QueryClient, QueryObserverOptions } from "@tanstack/react-query";
import { resolveSalesDateRange, type SalesDateRange } from "../sales/sales-register-model.ts";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";
import { isLocalDate, shiftLocalDate } from "../../lib/local-date.ts";
import { isCashBookInitializationRequired } from "./cash-book-office-model.ts";
import {
  formatChallanLabel,
  isNewCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
  CustomerPaymentUnknownOutcomeError,
  isCustomerPaymentId,
} from "../sales/types.ts";

export type CustomerPaymentSaveOutcome =
  | { status: "saved"; payment: CustomerPaymentResult; refresh: "pending" | "current" | "outdated" }
  | { status: "unknown" | "failed"; message: string };

// Presentation callbacks and reads must never turn a confirmed write into failure.
export async function saveCustomerPaymentAndRefresh(
  input: CreateCustomerPaymentWithMethodsInput,
  create: (input: CreateCustomerPaymentWithMethodsInput) => Promise<CustomerPaymentResult>,
  onConfirmed: (payment: CustomerPaymentResult) => void,
  onSaved: (payment: CustomerPaymentResult) => void | Promise<void>,
  refresh: () => Promise<void>,
): Promise<CustomerPaymentSaveOutcome> {
  let payment: CustomerPaymentResult;
  try {
    payment = await create(input);
    if (!isCustomerPaymentId(payment.id)) throw new CustomerPaymentUnknownOutcomeError();
  } catch (error) {
    return error instanceof CustomerPaymentUnknownOutcomeError
      ? { status: "unknown", message: ATLAS_UI_STRINGS.payment.unknownOutcome }
      : { status: "failed", message: error instanceof Error ? error.message : "Could not save this customer payment." };
  }
  let callbackFailed = false;
  try { onConfirmed(payment); } catch { callbackFailed = true; }
  const results = await Promise.allSettled([
    Promise.resolve().then(() => onSaved(payment)),
    Promise.resolve().then(refresh),
  ]);
  return { status: "saved", payment,
    refresh: callbackFailed || results.some((result) => result.status === "rejected") ? "outdated" : "current" };
}

export async function refreshCustomerPaymentQueries(
  client: QueryClient,
  factoryId: string,
  customerId: string,
  submittedChallanIds: readonly string[],
): Promise<void> {
  // Submitted IDs select reads only; they are never rendered as saved allocations.
  const financialKeys: readonly (readonly string[])[] = [
    ["office-customer-payment-summary", factoryId, customerId],
    ["office-customer-payment-candidates", factoryId, customerId],
    ["office-customer-payment-history", factoryId, customerId],
    ["office-factory-customer-payments", factoryId],
    ...[...new Set(submittedChallanIds)].map((id) => ["office-challan-payment-state", factoryId, id]),
    ["office-cash-book-day", factoryId],
    ["office-sales-register", factoryId],
    ["office-sales-challans", factoryId],
    ...[...new Set(submittedChallanIds)].map((id) => ["office-sales-challan", factoryId, id]),
  ];
  // Lifetime Paid/Due can change in any Challan-date period, not just the payment
  // date. Invalidate every cached Register range, immediately reading observed ranges only.
  // Keep the existing all-cached-day Cash Book payment scope.
  const canFetchCashBook = cashBookFetchEligibility(client, factoryId, true);
  return refreshFinancialQueryGroups(client, financialKeys, [], (query) => {
    if (query.queryKey[0] === "office-cash-book-day") return canFetchCashBook(query);
    if (query.queryKey[0] === "office-sales-register") return salesRegisterFetchEligibility(query, null);
    if (query.queryKey[0] === "office-sales-challans" || query.queryKey[0] === "office-sales-challan") {
      return challanLockFetchEligibility(query);
    }
    return true;
  });
}

// Read-only recovery uses the same cancellation/completion checks as a confirmed payment.
// Only existing query objects are fetched; submitted IDs never manufacture details.
export function refreshChallanLockQueries(client: QueryClient, factoryId: string, challanIds?: readonly string[]) {
  const keys = challanIds === undefined ? [["office-sales-challans", factoryId]]
    : [...new Set(challanIds)].map((id) => ["office-sales-challan", factoryId, id]);
  return refreshFinancialQueryGroups(client, keys, [], challanLockFetchEligibility);
}

function challanLockFetchEligibility(query: Query): boolean {
  if (query.isDisabled() || typeof query.options.queryFn !== "function") return false;
  // List filter variants are observer-owned. Dormant variants stay invalidated until opened.
  if (query.queryKey[0] === "office-sales-challans") return query.isActive();
  if (typeof query.queryKey[2] !== "string" || !query.queryKey[2]) return false;
  const enabled = (query.options as QueryObserverOptions).enabled;
  return query.isActive() || !(enabled === false || (typeof enabled === "function" && !enabled(query)));
}

// Challan callers pass the validated returned header, not the mutable selected customer.
// This refresh has no payment-ID dependency and never touches other module queries.
export async function refreshCustomerFinancialQueries(
  client: QueryClient,
  target: Pick<ChallanHeader, "factoryId" | "customerId">,
  includePaymentHistory: boolean,
): Promise<void> {
  const { factoryId, customerId } = target;
  const financialKeys: readonly (readonly string[])[] = [
    ["office-customer-payment-summary", factoryId, customerId],
    ["office-customer-payment-candidates", factoryId, customerId],
    ...(includePaymentHistory ? [
      ["office-customer-payment-history", factoryId, customerId],
      ["office-factory-customer-payments", factoryId],
    ] : []),
  ];
  return refreshFinancialQueryGroups(client, financialKeys, []);
}

// Post-save targets use the confirmed header; explicit Refresh uses the displayed valid range.
export async function refreshSalesRegisterQueries(
  client: QueryClient,
  target: Pick<ChallanHeader, "factoryId" | "challanDate"> | { factoryId: string; range: SalesDateRange },
): Promise<void> {
  const financialKeys = ["range" in target
    ? ["office-sales-register", target.factoryId, target.range.fromDate, target.range.toDate]
    : ["office-sales-register", target.factoryId]];
  return refreshFinancialQueryGroups(client, financialKeys, [], (query) => salesRegisterFetchEligibility(query, target));
}

function salesRegisterFetchEligibility(query: Query, target: { challanDate: string } | { range: SalesDateRange } | null) {
  const [, , fromDate, toDate] = query.queryKey;
  const range = typeof fromDate === "string" && typeof toDate === "string"
    ? resolveSalesDateRange("custom", fromDate, fromDate, toDate) : null;
  if (!range || query.isDisabled() || typeof query.options.queryFn !== "function") return false;
  const enabled = (query.options as QueryObserverOptions).enabled;
  if (!query.isActive() && (enabled === false || (typeof enabled === "function" && !enabled(query)))) return false;
  // C6 retains explicit Refresh and relevant inactive Challan-date periods.
  // Ordinary payments (null target) immediately read only enabled observed variants.
  return query.isActive() || (target !== null && ("range" in target
    || (range.fromDate <= target.challanDate && target.challanDate <= range.toDate)));
}

// Received Now supplies its submitted payment date, not the Challan date.
// Cash Book balances carry forward: invalidate cached D2 and later days, but
// immediately read only enabled observed days. Explicit Refresh reads one day.
// CONSERVATIVE for payments before the permanent start date: SQL excludes those
// movements, but the day response does not expose startDate to narrow this scope.
export async function refreshCashBookQueries(
  client: QueryClient,
  target: { factoryId: string; paymentDate: string | null } | { factoryId: string; businessDate: string },
): Promise<void> {
  const date = "paymentDate" in target ? target.paymentDate : target.businessDate;
  if (!date || !isLocalDate(date)) return;
  const keys = [["office-cash-book-day", target.factoryId]];
  const canFetch = cashBookFetchEligibility(client, target.factoryId, "businessDate" in target);
  return refreshFinancialQueryGroups(client, keys, [], canFetch, (query) => {
    const businessDate = query.queryKey[2];
    return typeof businessDate === "string" && isLocalDate(businessDate)
      && ("businessDate" in target ? businessDate === date : businessDate >= date);
  });
}

function cashBookFetchEligibility(client: QueryClient, factoryId: string, includeInactive: boolean) {
  // Capture only genuine idle setup errors BEFORE cancel/revert. An initialized
  // first load has cleared that error; reverting it must not suppress replacement.
  const idleSetupQueries = new Set(client.getQueryCache().findAll({
    queryKey: ["office-cash-book-day", factoryId],
    predicate: (query) => query.state.fetchStatus === "idle" && isCashBookInitializationRequired(query.state.error),
  }));
  return (query: Query) => {
    if (idleSetupQueries.has(query) || query.isDisabled() || typeof query.options.queryFn !== "function") return false;
    const enabled = (query.options as QueryObserverOptions).enabled;
    // isDisabled covers all observed readers; a disabled second observer must
    // not suppress a day still needed by an enabled observer.
    if (!query.isActive() && (enabled === false || (typeof enabled === "function" && !enabled(query)))) return false;
    return includeInactive || query.isActive();
  };
}

export async function refreshFinancialQueryGroups(
  client: QueryClient,
  financialKeys: readonly (readonly string[])[],
  relatedKeys: readonly (readonly string[])[],
  shouldFetch: (query: Query) => boolean = () => true,
  shouldInvalidate: (query: Query) => boolean = () => true,
  assertCurrent: () => void = () => {},
): Promise<void> {
  const cache = client.getQueryCache();
  assertCurrent();
  const financialQueries = [...new Map(financialKeys.flatMap((queryKey) =>
    cache.findAll({ queryKey, predicate: shouldInvalidate })).map((query) => [query.queryHash, query])).values()];

  // Post-save callers reach here after confirmed success. Cancel/revert discards first-load results
  // when services ignore AbortSignal. No pre-save request can supply this refresh.
  await Promise.all(financialQueries.map((query) =>
    client.cancelQueries({ queryKey: query.queryKey, exact: true }, { revert: true })));
  assertCurrent();
  await Promise.all(financialKeys.map((queryKey) =>
    client.invalidateQueries({ queryKey, predicate: shouldInvalidate, refetchType: "none" })));
  assertCurrent();

  const fetchableQueries = financialQueries.filter(shouldFetch);
  const watched = new Set([...fetchableQueries, ...relatedKeys.flatMap((queryKey) => cache.findAll({ queryKey }))]);
  let stopWatching = () => {};
  let rejectPaused!: () => void;
  const paused = new Promise<never>((_, reject) => {
    rejectPaused = () => reject(new Error(ATLAS_UI_STRINGS.payment.balancesOutdated));
    stopWatching = cache.subscribe((event) => {
      if (watched.has(event.query) && event.query.state.fetchStatus === "paused") rejectPaused();
    });
  });
  try {
    const reads = fetchableQueries.map((query) => {
      assertCurrent();
      const before = query.state.dataUpdateCount;
      // Explicit fetch also refreshes registered financial queries behind hidden tabs.
      // Cancellation + forced fetch proves start order; timestamps alone cannot.
      return client.fetchQuery({ ...query.options, queryKey: query.queryKey, staleTime: 0 }).then(() => {
        if (!(query.state.dataUpdateCount > before && query.state.status === "success"
          && query.state.fetchStatus === "idle" && !query.state.isInvalidated && !query.state.error)) {
          throw new Error(ATLAS_UI_STRINGS.payment.balancesOutdated);
        }
      });
    });
    // Start every invalidation, but do not block the saved UI behind a paused read.
    const completed = Promise.all([...reads, ...relatedKeys.map((queryKey) =>
      client.invalidateQueries({ queryKey, refetchType: "all" }, { throwOnError: true }))]);
    if ([...watched].some((query) => query.state.fetchStatus === "paused")) rejectPaused();
    await Promise.race([completed, paused]);
  } catch {
    throw new Error(ATLAS_UI_STRINGS.payment.balancesOutdated);
  } finally {
    stopWatching();
  }
}

export function isCustomerPaymentReadCurrent(state: {
  isFetching: boolean;
  error: unknown;
  isInvalidated?: boolean;
  dataUpdatedAt: number;
}): boolean {
  return !state.isFetching && !state.error && !state.isInvalidated && state.dataUpdatedAt > 0;
}

export type CustomerPaymentForm = {
  paymentDate: string;
  amount: string;
  paymentModes: NewCustomerPaymentMode[];
  paymentMethodAmounts: Partial<Record<NewCustomerPaymentMode, string>>;
  note: string;
  allocations: Record<string, string>;
};

export type CustomerPaymentFormStatus = {
  paymentAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  canSubmit: boolean;
  error: string;
  methodSplitError: string;
};

export type CustomerDuesSortOrder = "newest" | "oldest";
export type CustomerDuesDatePreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";

export type CustomerDuesDateRange = {
  fromDate: string;
  toDate: string;
};

export type CustomerDuesDateFilter = {
  range: CustomerDuesDateRange | null;
  error: string;
};

export type CustomerPaymentHistorySort =
  | "newest"
  | "oldest"
  | "amount-high"
  | "amount-low";

export type ExpandedCustomerPaymentFilters = Readonly<{
  searchText: string;
  period: CustomerDuesDatePreset;
  sort: CustomerPaymentHistorySort;
  localToday: string;
  customFrom: string;
  customTo: string;
}>;

export type ExpandedCustomerPaymentFilterResult = Readonly<{
  payments: CustomerPayment[];
  error: string;
}>;

export function filterCustomersForPaymentSelection(
  customers: readonly Customer[],
  searchText: string,
): Customer[] {
  const normalizedNameSearch = searchText.trim().toLocaleLowerCase("en-IN");
  const normalizedMobileSearch = searchText.replace(/\D/g, "");
  if (!normalizedNameSearch) return [...customers];

  return customers.filter((customer) =>
    customer.name.toLocaleLowerCase("en-IN").includes(normalizedNameSearch)
    || (normalizedMobileSearch.length > 0
      && customer.mobile.replace(/\D/g, "").includes(normalizedMobileSearch)));
}

export function resolveCustomerDuesDateFilter(
  preset: CustomerDuesDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): CustomerDuesDateFilter {
  if (!isLocalDate(localToday)) {
    return { range: null, error: "Current local date is invalid." };
  }
  if (preset === "all") return { range: null, error: "" };
  if (preset === "today") {
    return { range: { fromDate: localToday, toDate: localToday }, error: "" };
  }
  if (preset === "yesterday") {
    const yesterday = shiftLocalDate(localToday, -1)!;
    return { range: { fromDate: yesterday, toDate: yesterday }, error: "" };
  }
  if (preset === "week") {
    const [year, month, day] = localToday.split("-").map(Number);
    const weekday = new Date(year!, month! - 1, day!, 12).getDay();
    const fromDate = shiftLocalDate(localToday, -((weekday + 6) % 7))!;
    return { range: { fromDate, toDate: shiftLocalDate(fromDate, 6)! }, error: "" };
  }
  if (preset === "month") {
    const [year, month] = localToday.split("-").map(Number);
    const nextMonthFirst = month === 12
      ? `${year! + 1}-01-01`
      : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
    return {
      range: {
        fromDate: `${localToday.slice(0, 7)}-01`,
        toDate: shiftLocalDate(nextMonthFirst, -1)!,
      },
      error: "",
    };
  }
  if (!customFrom || !customTo) {
    return { range: null, error: "Choose both From and To dates." };
  }
  if (!isLocalDate(customFrom) || !isLocalDate(customTo)) {
    return { range: null, error: "Choose valid From and To dates." };
  }
  if (customFrom > customTo) {
    return { range: null, error: "From date cannot be after To date." };
  }
  return { range: { fromDate: customFrom, toDate: customTo }, error: "" };
}

function compareCustomerPaymentsNewestFirst(
  left: CustomerPayment,
  right: CustomerPayment,
): number {
  return right.paymentDate.localeCompare(left.paymentDate)
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id);
}

export function filterCustomerPaymentsForExpandedView(
  payments: readonly CustomerPayment[],
  filters: ExpandedCustomerPaymentFilters,
): ExpandedCustomerPaymentFilterResult {
  const dateFilter = resolveCustomerDuesDateFilter(
    filters.period,
    filters.localToday,
    filters.customFrom,
    filters.customTo,
  );
  if (dateFilter.error) return { payments: [], error: dateFilter.error };

  const normalizedSearch = filters.searchText.trim().toLocaleLowerCase("en-IN");
  const filtered = payments.filter((payment) => {
    if (dateFilter.range && (
      payment.paymentDate < dateFilter.range.fromDate
      || payment.paymentDate > dateFilter.range.toDate
    )) return false;
    if (!normalizedSearch) return true;

    return [
      payment.customerNameSnapshot,
      payment.customerAddressSnapshot,
      payment.customerMobileSnapshot,
      payment.note ?? "",
      ...payment.allocations.map((allocation) => formatChallanLabel(allocation.challanNumber)),
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch));
  });

  const newestFirst = (left: CustomerPayment, right: CustomerPayment) =>
    compareCustomerPaymentsNewestFirst(left, right);
  const comparator = filters.sort === "oldest"
    ? (left: CustomerPayment, right: CustomerPayment) => -newestFirst(left, right)
    : filters.sort === "amount-high"
      ? (left: CustomerPayment, right: CustomerPayment) => right.amount - left.amount
        || newestFirst(left, right)
      : filters.sort === "amount-low"
        ? (left: CustomerPayment, right: CustomerPayment) => left.amount - right.amount
          || newestFirst(left, right)
        : newestFirst;

  return { payments: [...filtered].sort(comparator), error: "" };
}

export function sortCustomerOutstandingChallans(
  challans: readonly CustomerOutstandingChallan[],
  sortOrder: CustomerDuesSortOrder,
): CustomerOutstandingChallan[] {
  const direction = sortOrder === "newest" ? -1 : 1;
  return [...challans].sort((left, right) => direction * (
    left.challanDate.localeCompare(right.challanDate)
      || left.createdAt.localeCompare(right.createdAt)
      || left.challanId.localeCompare(right.challanId)
  ));
}

export function clearCustomerPaymentAllocations(
  form: CustomerPaymentForm,
): CustomerPaymentForm {
  return Object.keys(form.allocations).length === 0 && !form.amount
    ? form
    : { ...form, amount: "", allocations: {} };
}

export function emptyCustomerPaymentForm(localToday: string): CustomerPaymentForm {
  return {
    paymentDate: localToday,
    amount: "",
    paymentModes: [],
    paymentMethodAmounts: {},
    note: "",
    allocations: {},
  };
}

export function toggleCustomerPaymentMode(
  form: CustomerPaymentForm,
  mode: NewCustomerPaymentMode,
): CustomerPaymentForm {
  const selected = new Set(form.paymentModes);
  const paymentMethodAmounts = { ...form.paymentMethodAmounts };
  if (selected.has(mode)) {
    selected.delete(mode);
    delete paymentMethodAmounts[mode];
  } else {
    selected.add(mode);
  }
  return {
    ...form,
    paymentModes: NEW_CUSTOMER_PAYMENT_MODES.filter((candidate) => selected.has(candidate)),
    paymentMethodAmounts,
  };
}

export function setCustomerPaymentMethodAmount(
  form: CustomerPaymentForm,
  mode: NewCustomerPaymentMode,
  amount: string,
): CustomerPaymentForm {
  if (!form.paymentModes.includes(mode)) return form;
  return {
    ...form,
    paymentMethodAmounts: { ...form.paymentMethodAmounts, [mode]: amount },
  };
}

export function clearCustomerPaymentMethodAmounts(
  form: CustomerPaymentForm,
): CustomerPaymentForm {
  return Object.keys(form.paymentMethodAmounts).length === 0
    ? form
    : { ...form, paymentMethodAmounts: {} };
}

export function setPaymentAmount(
  form: CustomerPaymentForm,
  amount: string,
): CustomerPaymentForm {
  const selectedChallanIds = Object.keys(form.allocations);
  if (selectedChallanIds.length !== 1) return { ...form, amount };
  return {
    ...form,
    amount,
    allocations: { [selectedChallanIds[0]!]: amount },
  };
}

export function togglePaymentAllocation(
  form: CustomerPaymentForm,
  challan: CustomerOutstandingChallan,
  selected: boolean,
): CustomerPaymentForm {
  const allocations = { ...form.allocations };
  if (selected) allocations[challan.challanId] = formatEditableMoney(challan.outstandingAmount);
  else delete allocations[challan.challanId];
  return { ...form, amount: formatAllocationTotal(allocations), allocations };
}

export function setPaymentAllocation(
  form: CustomerPaymentForm,
  challanId: string,
  amount: string,
): CustomerPaymentForm {
  const allocations = { ...form.allocations, [challanId]: amount };
  return { ...form, amount: formatAllocationTotal(allocations), allocations };
}

export function getCustomerPaymentFormStatus(
  form: CustomerPaymentForm,
  challans: readonly CustomerOutstandingChallan[],
): CustomerPaymentFormStatus {
  const paymentPaise = parseMoneyToPaise(form.amount);
  const methodSplitError = getPaymentMethodSplitError(form, paymentPaise);
  const selected = Object.entries(form.allocations);
  let allocatedPaise = 0;
  let error = "";

  if (!isCanonicalDate(form.paymentDate)) error = "Choose a valid payment date.";
  else if (form.paymentModes.length === 0) error = "Choose at least one payment mode.";
  else if (new Set(form.paymentModes).size !== form.paymentModes.length
    || form.paymentModes.some((mode) => !isNewCustomerPaymentMode(mode))) {
    error = "Choose valid payment modes.";
  }
  else if (paymentPaise === null) error = "Enter a payment amount greater than zero.";
  else if (methodSplitError) error = methodSplitError;
  else if (selected.length === 0) error = "Select at least one Challan to allocate this payment.";

  const challansById = new Map(challans.map((challan) => [challan.challanId, challan]));
  for (const [challanId, rawAmount] of selected) {
    const challan = challansById.get(challanId);
    const allocationPaise = parseMoneyToPaise(rawAmount);
    if (!challan && !error) error = "A selected Challan is no longer available.";
    else if (allocationPaise === null && !error) error = "Every selected Challan needs an allocation greater than zero.";
    else if (challan && allocationPaise !== null
      && allocationPaise > Math.round(challan.outstandingAmount * 100) && !error) {
      error = `Allocation for ${formatChallanLabel(challan.challanNumber)} exceeds its outstanding amount.`;
    }
    if (allocationPaise !== null) allocatedPaise += allocationPaise;
  }

  const safePaymentPaise = paymentPaise ?? 0;
  const remainingPaise = safePaymentPaise - allocatedPaise;
  if (!error && remainingPaise !== 0) {
    error = remainingPaise > 0
      ? "Allocate the full payment amount before saving."
      : "Allocated amount cannot exceed the payment amount.";
  }

  return {
    paymentAmount: safePaymentPaise / 100,
    allocatedAmount: allocatedPaise / 100,
    remainingAmount: remainingPaise / 100,
    canSubmit: !error && paymentPaise !== null && selected.length > 0,
    error,
    methodSplitError,
  };
}

export function buildCustomerPaymentInput(
  factoryId: string,
  customerId: string,
  form: CustomerPaymentForm,
  challans: readonly CustomerOutstandingChallan[],
): CreateCustomerPaymentWithMethodsInput | null {
  if (!factoryId || !customerId) return null;
  const status = getCustomerPaymentFormStatus(form, challans);
  if (!status.canSubmit) return null;
  return {
    factoryId,
    customerId,
    paymentDate: form.paymentDate,
    amount: status.paymentAmount,
    methods: form.paymentModes.map((mode) => {
      const rawSplitAmount = form.paymentMethodAmounts[mode]?.trim() ?? "";
      return {
        mode,
        splitAmount: rawSplitAmount
          ? parseMoneyToPaise(rawSplitAmount)! / 100
          : null,
      };
    }),
    note: form.note,
    allocations: Object.entries(form.allocations).map(([challanId, amount]) => ({
      challanId,
      amount: parseMoneyToPaise(amount)! / 100,
    })),
  };
}

function getPaymentMethodSplitError(
  form: CustomerPaymentForm,
  paymentPaise: number | null,
): string {
  const rawAmounts = form.paymentModes.map((mode) => (
    form.paymentMethodAmounts[mode]?.trim() ?? ""
  ));
  const suppliedCount = rawAmounts.filter(Boolean).length;
  if (suppliedCount === 0) return "";
  if (suppliedCount !== form.paymentModes.length) {
    return "Enter an amount for every selected method, or leave all method amounts blank.";
  }

  const parsedAmounts = rawAmounts.map(parseMoneyToPaise);
  if (parsedAmounts.some((amount) => amount === null)) {
    return "Method amounts must be positive and use at most two decimal places.";
  }
  if (paymentPaise === null) {
    return "Enter a valid Payment amount to reconcile method amounts.";
  }
  const methodTotalPaise = parsedAmounts.reduce<number>(
    (total, amount) => total + (amount ?? 0),
    0,
  );
  if (!Number.isSafeInteger(methodTotalPaise) || methodTotalPaise !== paymentPaise) {
    return "Method amounts must equal the Payment total.";
  }
  return "";
}

export function applyPaymentLocks(
  challans: readonly ChallanHeader[],
  payment: CustomerPayment,
): ChallanHeader[] {
  const affected = new Set(payment.allocations.map((allocation) => allocation.challanId));
  return challans.map((challan) => affected.has(challan.id) && !challan.isLocked
    ? { ...challan, isLocked: true }
    : challan);
}

function parseMoneyToPaise(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  const paise = Math.round(amount * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function formatEditableMoney(amount: number): string {
  return amount.toFixed(2).replace(/\.00$/, "");
}

function formatAllocationTotal(allocations: Readonly<Record<string, string>>): string {
  const values = Object.values(allocations);
  if (values.length === 0) return "";
  let totalPaise = 0;
  for (const value of values) {
    const paise = parseMoneyToPaise(value);
    if (paise === null) return "";
    totalPaise += paise;
    if (!Number.isSafeInteger(totalPaise)) return "";
  }
  return formatEditableMoney(totalPaise / 100);
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
