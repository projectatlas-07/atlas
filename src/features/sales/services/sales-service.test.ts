import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let rpcResponse: { data: Row | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};
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
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const { createCustomer, updateCustomer } = await import("./customer-service.ts");
const {
  ChallanServiceError,
  createChallan,
  getFactoryPrintableProfile,
  updateFactoryPrintableProfile,
  updateChallan,
  voidChallan,
} = await import("./challan-service.ts");

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
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-26T10:00:00Z",
};

const challanRow = {
  id: "challan-a",
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
    challan_id: "challan-a",
    brick_type_id: "brick-a",
    brick_particulars_snapshot: "Class One",
    quantity: "1500",
    rate_per_1000_bricks: "2000",
    pricing_unit: "PER_1000_BRICKS",
    line_amount: "3000",
    line_position: 1,
    created_at: "2026-08-26T10:00:00Z",
  },
  {
    id: "item-b",
    factory_id: "factory-a",
    challan_id: "challan-a",
    brick_type_id: "brick-b",
    brick_particulars_snapshot: "Class Two",
    quantity: "500",
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
    challan_id: "challan-a",
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
    challan_id: "challan-a",
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
    challan_id: "challan-a",
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
  rpcResponse = { data: null, error: null };
  itemListResponse = { data: [], error: null };
  flexibleLineListResponse = { data: [], error: null };
  singleResponse = { data: null, error: null };
}

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
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-26T10:00:00Z",
  });
  assert.deepEqual(calls, [
    ["from", "factories"],
    ["select", "id, name, business_description, village, post_office, police_station, district, state, address, mobile, created_at, updated_at"],
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
  }]]);
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
  assert.equal((await updateCustomer({
    factoryId: "factory-a",
    customerId: "customer-a",
    name: "Anand Traders",
    address: "Address B",
    mobile: "9222222222",
  })).address, "Address B");
  assert.equal(calls[0][1], "update_customer");
});

test("create payload contains inputs only while returned amounts come from the database", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;

  const result = await createChallan({
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
    p_challan_date: "2026-08-26",
    p_customer_id: "customer-a",
    p_vehicle_id: "vehicle-a",
    p_trip_labour_wage: 450.5,
    p_items: [
      { brick_type_id: "brick-a", quantity: 1500, rate: 2000 },
      { brick_type_id: "brick-b", quantity: 500, rate: 1000 },
    ],
    p_flexible_lines: [],
  }]);
  assert.doesNotMatch(JSON.stringify(rpcCall[2]), /line_amount|challan_total/i);
  assert.equal(result.challanNumber, 42);
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

test("flexible NOTE and EXTRA_CHARGE lines use the A2 overload and map database-authoritative values", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;
  flexibleLineListResponse.data = flexibleLineRows;

  const result = await createChallan({
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
    p_challan_date: "2026-08-26",
    p_customer_id: "customer-a",
    p_vehicle_id: "vehicle-a",
    p_trip_labour_wage: 450.5,
    p_items: [{ brick_type_id: "brick-a", quantity: 1500, rate: 2000 }],
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

  const result = await createChallan({
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
    challanId: "challan-a",
    challanDate: "2026-08-27",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    tripLabourWage: 500,
    items: [{ brickTypeId: "brick-a", quantity: 2500, ratePer1000Bricks: 1200 }],
  });
  assert.equal(calls[0][1], "update_challan");
  assert.equal((calls[0][2] as Row).p_flexible_lines, null);
  assert.equal(updated.challanTotal, 3000);

  reset();
  rpcResponse.data = {
    ...challanRow,
    status: "void",
    voided_at: "2026-08-27T11:00:00Z",
  };
  itemListResponse.data = itemRows;
  const voided = await voidChallan("factory-a", "challan-a");
  assert.deepEqual(calls[0], ["rpc", "void_challan", {
    p_factory_id: "factory-a",
    p_challan_id: "challan-a",
  }]);
  assert.equal(voided.status, "void");
});

test("C1 edit save distinguishes omitted flexible lines from an explicit complete replacement", async () => {
  reset();
  rpcResponse.data = challanRow;
  itemListResponse.data = itemRows;
  flexibleLineListResponse.data = [];
  await updateChallan({
    factoryId: "factory-a",
    challanId: "challan-a",
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
    challanId: "challan-a",
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
    () => voidChallan("factory-a", "challan-a"),
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
