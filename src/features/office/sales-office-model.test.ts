import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Challan, Customer, Vehicle } from "@/features/sales/types";
import {
  addChallanFlexibleLine,
  addChallanLine,
  buildFactoryProfileInput,
  buildCreateChallanInput,
  buildQuickCustomerInput,
  buildUpdateChallanInput,
  calculateChallanBrickLineAmountPreview,
  calculateChallanTotalPreview,
  calculateFlexibleLineAmountPreview,
  calculateLineAmountPreview,
  challanFormFromSaved,
  emptyChallanFlexibleLine,
  emptyChallanLine,
  factoryProfileFormFromSaved,
  getChallanEligibility,
  getChallanFormError,
  getSavedCustomerSnapshot,
  isFactoryPrintableProfileComplete,
  moveChallanFlexibleLine,
  removeChallanFlexibleLine,
  removeChallanLine,
  SALES_SECTION_HEADING,
  salesOfficeErrorMessage,
  selectCustomer,
  updateChallanLineField,
} from "./sales-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);

const customers: Customer[] = [{
  id: "customer-a",
  factoryId: "factory-a",
  name: "Current Customer Name",
  address: "Current Address",
  mobile: "9999999999",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-20T00:00:00Z",
}];

const savedChallan: Challan = {
  id: "challan-a",
  factoryId: "factory-a",
  challanNumber: "18",
  challanDate: "2026-08-26",
  customerId: "customer-a",
  customerNameSnapshot: "Historical Customer Name",
  customerAddressSnapshot: "Historical Address",
  customerMobileSnapshot: "9111111111",
  companyNameSnapshot: "Historical Atlas Bricks",
  companyBusinessDescriptionSnapshot: "Brick manufacturer",
  companyAddressSnapshot: "Historical Factory Address",
  companyMobileSnapshot: "9222222222",
  companyVillageSnapshot: null,
  companyPostOfficeSnapshot: null,
  companyPoliceStationSnapshot: null,
  companyDistrictSnapshot: null,
  companyStateSnapshot: null,
  vehicleId: "vehicle-a",
  vehicleNumberSnapshot: "RJ14AB1234",
  deliveryWageApplicableSnapshot: true,
  tripLabourWage: 450,
  vehicleNumber: "RJ14AB1234",
  tractorLabourRateSnapshot: 450,
  challanTotal: 3500,
  status: "active",
  isLocked: false,
  voidedAt: null,
  createdAt: "2026-08-26T10:00:00Z",
  updatedAt: "2026-08-26T10:00:00Z",
  items: [{
    id: "item-a",
    factoryId: "factory-a",
    challanId: "challan-a",
    brickTypeId: "brick-a",
    brickParticularsSnapshot: "Historical Class One",
    quantity: 1500,
    ratePer1000Bricks: 2000,
    pricingUnit: "PER_1000_BRICKS",
    lineCategory: "BRICK_REVENUE",
    lineAmount: 3000,
    linePosition: 1,
    createdAt: "2026-08-26T10:00:00Z",
  }],
  flexibleLines: [],
};

const vehicles: Vehicle[] = [{
  id: "vehicle-a",
  factoryId: "factory-a",
  vehicleNumber: "RJ14AB1234",
  normalizedVehicleNumber: "RJ14AB1234",
  deliveryWageTrackingEnabled: true,
  isActive: true,
  createdAt: "2026-08-26T09:00:00Z",
  updatedAt: "2026-08-26T09:00:00Z",
}];

const savedProfile = {
  id: "factory-a",
  name: "Atlas Bricks",
  businessDescription: "Brick manufacturer",
  village: "Rampur",
  postOffice: "Rampur",
  policeStation: "Kotwali",
  district: "Jaipur",
  state: "Rajasthan",
  address: "Factory Road",
  mobile: "9000000000",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-26T00:00:00Z",
};

test("S2.1 blocks creation until every printable factory field is complete", () => {
  assert.equal(isFactoryPrintableProfileComplete({
    ...savedProfile,
    village: " ",
  }), false);
  assert.equal(isFactoryPrintableProfileComplete(savedProfile), true);
  assert.match(sectionSource, /if \(!challan && !profileComplete\)/);
  assert.match(sectionSource, /Complete the Factory \/ Challan Profile before creating a Challan/);
});

test("S2.1 loads existing profile values and prepares the controlled save input", () => {
  assert.deepEqual(factoryProfileFormFromSaved(savedProfile), {
    name: "Atlas Bricks",
    businessDescription: "Brick manufacturer",
    village: "Rampur",
    postOffice: "Rampur",
    policeStation: "Kotwali",
    district: "Jaipur",
    state: "Rajasthan",
    mobile: "9000000000",
  });
  assert.deepEqual(buildFactoryProfileInput("factory-a", {
    name: "  Atlas   Bricks ",
    businessDescription: " Brick   manufacturer ",
    village: " Rampur ",
    postOffice: " Rampur   Head ",
    policeStation: " Kotwali ",
    district: " Jaipur ",
    state: " Rajasthan ",
    mobile: " 9000000000 ",
  }), {
    factoryId: "factory-a",
    name: "Atlas Bricks",
    businessDescription: "Brick manufacturer",
    village: "Rampur",
    postOffice: "Rampur Head",
    policeStation: "Kotwali",
    district: "Jaipur",
    state: "Rajasthan",
    mobile: "9000000000",
  });
  assert.match(sectionSource, /getFactoryPrintableProfile/);
  assert.match(sectionSource, /await updateFactoryPrintableProfile\(input\)/);
});

test("S2.1 successful profile save clears the incomplete gate and Challan can proceed", () => {
  const previouslyIncomplete = { ...savedProfile, mobile: "" };
  const saved = { ...previouslyIncomplete, mobile: "9000000000" };
  assert.equal(isFactoryPrintableProfileComplete(previouslyIncomplete), false);
  assert.equal(isFactoryPrintableProfileComplete(saved), true);
  assert.notEqual(buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [{ key: "a", brickTypeId: "brick-a", quantity: "1000", ratePer1000Bricks: "2000" }],
    flexibleLines: [],
  }), null);
  assert.match(sectionSource, /setQueryData<FactoryPrintableProfile>/);
});

test("S2 Sales section is integrated into Office as the Challan workflow", () => {
  assert.equal(SALES_SECTION_HEADING, "Sales / Challan");
  assert.match(dashboardSource, /<SalesOfficeSection/);
  assert.match(sectionSource, /Create Challan/);
  assert.match(sectionSource, /Challan history/);
  assert.doesNotMatch(sectionSource, /Sales Register|Enter Sale/i);
});

test("customer selection and quick creation preserve address as destination", () => {
  assert.equal(selectCustomer(customers, "customer-a")?.address, "Current Address");
  assert.equal(selectCustomer(customers, "missing"), null);
  assert.deepEqual(buildQuickCustomerInput("factory-a", {
    name: "  Anand   Traders ",
    address: " Delivery Address ",
    mobile: " 9111111111 ",
  }), {
    factoryId: "factory-a",
    name: "Anand Traders",
    address: "Delivery Address",
    mobile: "9111111111",
  });
  assert.equal(buildQuickCustomerInput("factory-a", {
    name: " ", address: "Address", mobile: "",
  }), null);
  assert.match(sectionSource, /await createCustomer\(input\)/);
  assert.match(sectionSource, /Address \/ delivery destination/);
});

test("brick rows add and remove cleanly, including all rows for a manual Challan", () => {
  const first = emptyChallanLine("line-1");
  const two = addChallanLine([first], "line-2");
  assert.deepEqual(two.map((line) => line.key), ["line-1", "line-2"]);
  assert.deepEqual(removeChallanLine(two, "line-1").map((line) => line.key), ["line-2"]);
  assert.deepEqual(removeChallanLine([first], "line-1"), []);
  assert.match(sectionSource, /Add brick row/);
  assert.match(sectionSource, /Remove/);
});

test("preview follows database per-1000 rounding and totals rounded lines", () => {
  assert.equal(calculateLineAmountPreview("1500", "2000"), 3000);
  assert.equal(calculateLineAmountPreview("1", "5"), 0.01);
  assert.equal(calculateLineAmountPreview("500", "1000"), 500);
  assert.equal(calculateLineAmountPreview("1.5", "2000"), null);
  assert.equal(calculateLineAmountPreview("1000", "0"), null);
  assert.equal(calculateChallanTotalPreview([
    { key: "a", brickTypeId: "brick-a", quantity: "1500", ratePer1000Bricks: "2000" },
    { key: "b", brickTypeId: "brick-b", quantity: "500", ratePer1000Bricks: "1000" },
  ]), 3500);
});

test("brick rows switch cleanly between Rate and exact Amount authority", () => {
  let [line] = updateChallanLineField(
    [emptyChallanLine("brick")],
    "brick",
    "quantity",
    "12347",
  );
  [line] = updateChallanLineField([line!], "brick", "ratePer1000Bricks", "8000");
  assert.deepEqual({
    pricingMode: line?.pricingMode,
    rate: line?.ratePer1000Bricks,
    amount: line?.lineAmount,
  }, {
    pricingMode: "RATE",
    rate: "8000",
    amount: "98776.00",
  });

  [line] = updateChallanLineField([line!], "brick", "lineAmount", "80000");
  assert.deepEqual({
    pricingMode: line?.pricingMode,
    rate: line?.ratePer1000Bricks,
    amount: line?.lineAmount,
  }, {
    pricingMode: "AMOUNT",
    rate: "6479.306714182",
    amount: "80000",
  });
  assert.equal(calculateChallanBrickLineAmountPreview(line!), 80000);

  const stable = updateChallanLineField([line!], "brick", "quantity", "12347")[0];
  assert.deepEqual(stable, line, "Recalculating from the same authority must not drift.");

  [line] = updateChallanLineField([line!], "brick", "ratePer1000Bricks", "6480");
  assert.equal(line?.pricingMode, "RATE");
  assert.equal(line?.lineAmount, "80008.56");

  [line] = updateChallanLineField([line!], "brick", "lineAmount", "80000.00");
  assert.equal(line?.pricingMode, "AMOUNT");
  assert.equal(line?.ratePer1000Bricks, "6479.306714182");
});

test("mixed Rate and Amount brick rows keep the exact Amount in total and payload", () => {
  const rateLine = updateChallanLineField(
    updateChallanLineField([emptyChallanLine("rate")], "rate", "quantity", "10000"),
    "rate",
    "ratePer1000Bricks",
    "8000",
  )[0]!;
  const amountLine = updateChallanLineField(
    updateChallanLineField([emptyChallanLine("amount")], "amount", "quantity", "12347"),
    "amount",
    "lineAmount",
    "80000",
  )[0]!;
  const completedRateLine = { ...rateLine, brickTypeId: "brick-a" };
  const completedAmountLine = { ...amountLine, brickTypeId: "brick-b" };

  const form = {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [completedRateLine, completedAmountLine],
    flexibleLines: [
      { key: "note", lineType: "NOTE" as const, particulars: "Exact agreement" },
      {
        key: "charge",
        lineType: "EXTRA_CHARGE" as const,
        particulars: "Loading",
        chargeMode: "DIRECT_AMOUNT" as const,
        amount: "2000",
        quantity: "",
        rate: "",
      },
    ],
  };
  assert.equal(calculateChallanTotalPreview(form.lines, form.flexibleLines), 162000);
  assert.deepEqual(buildCreateChallanInput("factory-a", form)?.items, [
    {
      brickTypeId: "brick-a",
      quantity: 10000,
      pricingMode: "RATE",
      ratePer1000Bricks: 8000,
    },
    {
      brickTypeId: "brick-b",
      quantity: 12347,
      pricingMode: "AMOUNT",
      lineAmount: "80000.00",
    },
  ]);
});

test("additional rows add, reorder, and remove with stable client keys", () => {
  const note = emptyChallanFlexibleLine("flex-1", "NOTE");
  const charge = emptyChallanFlexibleLine("flex-2", "EXTRA_CHARGE");
  assert.deepEqual(note, { key: "flex-1", lineType: "NOTE", particulars: "" });
  assert.equal("amount" in note, false);
  assert.deepEqual(charge, {
    key: "flex-2",
    lineType: "EXTRA_CHARGE",
    particulars: "",
    chargeMode: "DIRECT_AMOUNT",
    amount: "",
    quantity: "",
    rate: "",
  });

  const rows = addChallanFlexibleLine([note], "flex-2", "EXTRA_CHARGE");
  assert.deepEqual(rows.map((line) => line.key), ["flex-1", "flex-2"]);
  assert.deepEqual(
    moveChallanFlexibleLine(rows, "flex-2", "up").map((line) => line.key),
    ["flex-2", "flex-1"],
  );
  assert.deepEqual(
    moveChallanFlexibleLine(rows, "flex-1", "up").map((line) => line.key),
    ["flex-1", "flex-2"],
  );
  assert.deepEqual(
    removeChallanFlexibleLine(rows, "flex-1").map((line) => line.key),
    ["flex-2"],
  );
  assert.deepEqual(removeChallanFlexibleLine([note], "flex-1"), []);
});

test("total preview includes direct and quantity-rate charges exactly once while notes add zero", () => {
  const note = { key: "n", lineType: "NOTE" as const, particulars: "At site" };
  const direct = {
    key: "d", lineType: "EXTRA_CHARGE" as const, particulars: "Loading",
    chargeMode: "DIRECT_AMOUNT" as const, amount: "2000", quantity: "", rate: "",
  };
  const calculated = {
    key: "c", lineType: "EXTRA_CHARGE" as const, particulars: "Handling",
    chargeMode: "QUANTITY_RATE" as const, amount: "", quantity: "2.5", rate: "400",
  };
  assert.equal(calculateFlexibleLineAmountPreview(note), 0);
  assert.equal(calculateFlexibleLineAmountPreview(direct), 2000);
  assert.equal(calculateFlexibleLineAmountPreview(calculated), 1000);
  assert.equal(calculateFlexibleLineAmountPreview({ ...calculated, rate: "" }), null);
  assert.equal(calculateChallanTotalPreview([
    { key: "b", brickTypeId: "brick-a", quantity: "1000", ratePer1000Bricks: "100000" },
  ], [note, direct, calculated]), 103000);
  assert.equal(calculateChallanTotalPreview([], [direct]), 2000);
  assert.equal(calculateChallanTotalPreview([], [note]), 0);
});

test("manual and mixed Challans submit complete deterministic flexible collections", () => {
  const noteOnly = buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [],
    flexibleLines: [{ key: "n", lineType: "NOTE", particulars: "  Deliver   at site. " }],
  });
  assert.deepEqual(noteOnly?.items, []);
  assert.deepEqual(noteOnly?.flexibleLines, [{
    lineType: "NOTE", orderIndex: 0, particulars: "Deliver at site.",
  }]);

  const chargeOnly = buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [],
    flexibleLines: [{
      key: "d", lineType: "EXTRA_CHARGE", particulars: "Loading",
      chargeMode: "DIRECT_AMOUNT", amount: "2000", quantity: "", rate: "",
    }],
  });
  assert.deepEqual(chargeOnly?.flexibleLines, [{
    lineType: "EXTRA_CHARGE", orderIndex: 0, particulars: "Loading", amount: 2000,
  }]);

  const reordered = buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [],
    flexibleLines: [
      {
        key: "c", lineType: "EXTRA_CHARGE", particulars: "Calculated",
        chargeMode: "QUANTITY_RATE", amount: "", quantity: "2.5", rate: "400",
      },
      { key: "n", lineType: "NOTE", particulars: "After charge" },
    ],
  });
  assert.deepEqual(reordered?.flexibleLines, [
    {
      lineType: "EXTRA_CHARGE", orderIndex: 0, particulars: "Calculated",
      quantity: 2.5, rate: 400,
    },
    { lineType: "NOTE", orderIndex: 1, particulars: "After charge" },
  ]);
});

test("clear validation distinguishes an empty document and incomplete charge input", () => {
  const base = {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [],
  };
  assert.equal(getChallanFormError({ ...base, flexibleLines: [] }),
    "Add at least one brick row, note, or extra charge.");
  assert.equal(buildCreateChallanInput("factory-a", { ...base, flexibleLines: [] }), null);
  assert.equal(getChallanFormError({
    ...base,
    flexibleLines: [{ key: "n", lineType: "NOTE", particulars: " " }],
  }), "Enter particulars for note 1.");
  assert.equal(getChallanFormError({
    ...base,
    flexibleLines: [{
      key: "d", lineType: "EXTRA_CHARGE", particulars: "Loading",
      chargeMode: "DIRECT_AMOUNT", amount: "", quantity: "", rate: "",
    }],
  }), "Enter a positive amount for extra charge 1.");
  assert.equal(getChallanFormError({
    ...base,
    flexibleLines: [{
      key: "c", lineType: "EXTRA_CHARGE", particulars: "Handling",
      chargeMode: "QUANTITY_RATE", amount: "", quantity: "2", rate: "",
    }],
  }), "Enter both a valid quantity and rate for extra charge 1.");
});

test("creation request contains inputs only and rejects invalid quantities/rates", () => {
  const valid = buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: true,
    tripLabourWage: "450.50",
    lines: [
      { key: "a", brickTypeId: "brick-a", quantity: "1500", ratePer1000Bricks: "2000" },
      { key: "b", brickTypeId: "brick-b", quantity: "500", ratePer1000Bricks: "1000" },
    ],
    flexibleLines: [],
  });
  assert.deepEqual(valid, {
    factoryId: "factory-a",
    challanNumber: null,
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 450.5,
    items: [
      { brickTypeId: "brick-a", quantity: 1500, pricingMode: "RATE", ratePer1000Bricks: 2000 },
      { brickTypeId: "brick-b", quantity: 500, pricingMode: "RATE", ratePer1000Bricks: 1000 },
    ],
    flexibleLines: [],
  });
  assert.doesNotMatch(JSON.stringify(valid), /lineAmount|challanTotal/);
  assert.equal(buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [{ key: "a", brickTypeId: "brick-a", quantity: "1.5", ratePer1000Bricks: "2000" }],
    flexibleLines: [],
  }), null);
  assert.equal(buildCreateChallanInput("factory-a", {
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [{ key: "a", brickTypeId: "brick-a", quantity: "1000", ratePer1000Bricks: "2.999" }],
    flexibleLines: [],
  }), null);
});

test("optional manual Challan numbers preserve operator text and blank stores as NULL", () => {
  const baseForm = {
    challanDate: "2026-09-11",
    customerId: "customer-a",
    vehicleId: "",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: false,
    tripLabourWage: "",
    lines: [{ key: "a", brickTypeId: "brick-a", quantity: "1000", ratePer1000Bricks: "2000" }],
    flexibleLines: [],
  };

  for (const challanNumber of ["145", "A-39", "2026/145"]) {
    assert.equal(
      buildCreateChallanInput("factory-a", { ...baseForm, challanNumber })?.challanNumber,
      challanNumber,
    );
  }
  assert.equal(
    buildCreateChallanInput("factory-a", { ...baseForm, challanNumber: "  A-39  " })?.challanNumber,
    "A-39",
  );
  assert.equal(
    buildCreateChallanInput("factory-a", { ...baseForm, challanNumber: "   " })?.challanNumber,
    null,
  );
});

test("saved data populates edit form while detail display keeps historical snapshots", () => {
  assert.deepEqual(challanFormFromSaved(savedChallan, vehicles), {
    challanNumber: "18",
    challanDate: "2026-08-26",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: true,
    tripLabourWage: "450",
    lines: [{
      key: "saved-item-a",
      brickTypeId: "brick-a",
      quantity: "1500",
      pricingMode: "RATE",
      ratePer1000Bricks: "2000",
      lineAmount: "3000",
    }],
    flexibleLines: [],
  });
  assert.deepEqual(getSavedCustomerSnapshot(savedChallan), {
    name: "Historical Customer Name",
    address: "Historical Address",
    mobile: "9111111111",
  });
  assert.notEqual(getSavedCustomerSnapshot(savedChallan).address, customers[0].address);
  assert.match(sectionSource, /customerAddressSnapshot/);
  assert.match(sectionSource, /brickParticularsSnapshot/);
});

test("editing restores persisted flexible values and always submits the intended full collection", () => {
  const savedWithFlexible: Challan = {
    ...savedChallan,
    challanTotal: 5500,
    flexibleLines: [
      {
        id: "note-a", factoryId: "factory-a", challanId: "challan-a",
        lineType: "NOTE", lineCategory: "NON_FINANCIAL", orderIndex: 1,
        particulars: "Original note", quantity: null, rate: null, amount: 0,
        createdAt: "2026-08-26T10:00:00Z",
      },
      {
        id: "charge-a", factoryId: "factory-a", challanId: "challan-a",
        lineType: "EXTRA_CHARGE", lineCategory: "OTHER_REVENUE", orderIndex: 0,
        particulars: "Loading", quantity: null, rate: null, amount: 2000,
        createdAt: "2026-08-26T10:00:00Z",
      },
      {
        id: "charge-b", factoryId: "factory-a", challanId: "challan-a",
        lineType: "EXTRA_CHARGE", lineCategory: "OTHER_REVENUE", orderIndex: 2,
        particulars: "Handling", quantity: 2.5, rate: 200, amount: 500,
        createdAt: "2026-08-26T10:00:00Z",
      },
    ],
  };
  const hydrated = challanFormFromSaved(savedWithFlexible, vehicles);
  assert.deepEqual(hydrated.flexibleLines, [
    {
      key: "saved-flexible-charge-a", lineType: "EXTRA_CHARGE", particulars: "Loading",
      chargeMode: "DIRECT_AMOUNT", amount: "2000", quantity: "", rate: "",
    },
    { key: "saved-flexible-note-a", lineType: "NOTE", particulars: "Original note" },
    {
      key: "saved-flexible-charge-b", lineType: "EXTRA_CHARGE", particulars: "Handling",
      chargeMode: "QUANTITY_RATE", amount: "", quantity: "2.5", rate: "200",
    },
  ]);

  const edited = {
    ...hydrated,
    flexibleLines: hydrated.flexibleLines.map((line) => {
      if (line.key === "saved-flexible-note-a") return { ...line, particulars: "Updated note" };
      if (line.key === "saved-flexible-charge-a" && line.lineType === "EXTRA_CHARGE") {
        return { ...line, amount: "2500" };
      }
      return line;
    }),
  };
  assert.deepEqual(
    buildUpdateChallanInput("factory-a", "challan-a", edited)?.flexibleLines,
    [
      {
        lineType: "EXTRA_CHARGE", orderIndex: 0, particulars: "Loading", amount: 2500,
      },
      { lineType: "NOTE", orderIndex: 1, particulars: "Updated note" },
      {
        lineType: "EXTRA_CHARGE", orderIndex: 2, particulars: "Handling",
        quantity: 2.5, rate: 200,
      },
    ],
  );

  const removedOne = {
    ...hydrated,
    flexibleLines: removeChallanFlexibleLine(hydrated.flexibleLines, "saved-flexible-note-a"),
  };
  assert.equal(buildUpdateChallanInput("factory-a", "challan-a", removedOne)?.flexibleLines?.length, 2);
  assert.deepEqual(
    buildUpdateChallanInput("factory-a", "challan-a", { ...hydrated, flexibleLines: [] })
      ?.flexibleLines,
    [],
  );
});

test("edit and void eligibility respect void and locked lifecycle states", () => {
  assert.deepEqual(getChallanEligibility(savedChallan), {
    canEdit: true, canVoid: true, reason: null,
  });
  assert.deepEqual(getChallanEligibility({ status: "void", isLocked: false }), {
    canEdit: false, canVoid: false, reason: "void",
  });
  assert.deepEqual(getChallanEligibility({ status: "active", isLocked: true }), {
    canEdit: false, canVoid: false, reason: "locked",
  });
  assert.match(sectionSource, /await updateChallan\(input\)/);
  assert.match(sectionSource, /await voidChallan\(factoryId, challan\.id\)/);
  assert.match(sectionSource, /Confirm void/);
  assert.doesNotMatch(sectionSource, /deleteChallan|Delete Challan|Delete numbered/i);
});

test("successful writes refresh caches and duplicate submits are blocked", () => {
  assert.match(sectionSource, /if \(isSaving\) return/);
  assert.match(sectionSource, /await createChallan\(input\)/);
  assert.match(sectionSource, /upsertChallanNewestFirst/);
  assert.match(sectionSource, /setQueryData<Challan>/);
  assert.match(sectionSource, /formatChallanLabel\(saved\.challanNumber\).*created/);
  assert.equal(
    salesOfficeErrorMessage({ code: "P3005", message: "Locked" }, "fallback"),
    "This Challan is locked and cannot be edited or voided.",
  );
  assert.equal(
    salesOfficeErrorMessage(new TypeError("Failed to fetch"), "fallback"),
    "Network problem. Check your connection and try again.",
  );
});
