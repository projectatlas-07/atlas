import type { Challan } from "@/features/sales/types";

export type PrintableChallanBrickLine = {
  lineKind: "BRICK";
  quantity: number;
  particulars: string;
  rate: number;
  amount: number;
};

export type PrintableChallanExtraChargeLine = {
  lineKind: "EXTRA_CHARGE";
  quantity: number | null;
  particulars: string;
  rate: number | null;
  amount: number;
};

export type PrintableChallanNoteLine = {
  lineKind: "NOTE";
  particulars: string;
};

export type PrintableChallanLine =
  | PrintableChallanBrickLine
  | PrintableChallanExtraChargeLine
  | PrintableChallanNoteLine;

type PrintableCompanyBase = {
  name: string;
  businessDescription: string;
  mobile: string;
};

export type PrintableCompany = PrintableCompanyBase & ({
  addressKind: "structured";
  village: string;
  postOffice: string;
  policeStation: string;
  district: string;
  state: string;
} | {
  addressKind: "legacy";
  address: string;
});

export type PrintableChallan = {
  company: PrintableCompany;
  challanNumber: number;
  challanDate: string;
  customer: {
    name: string;
    address: string;
    mobile: string;
  };
  lines: PrintableChallanLine[];
  total: number;
  vehicleNumber: string | null;
  isVoid: boolean;
};

export function buildPrintableChallan(challan: Challan): PrintableChallan {
  const structuredLocation = [
    challan.companyVillageSnapshot,
    challan.companyPostOfficeSnapshot,
    challan.companyPoliceStationSnapshot,
    challan.companyDistrictSnapshot,
    challan.companyStateSnapshot,
  ];
  const company: PrintableCompany = structuredLocation.every(
    (value): value is string => value !== null,
  ) ? {
      name: challan.companyNameSnapshot,
      businessDescription: challan.companyBusinessDescriptionSnapshot,
      mobile: challan.companyMobileSnapshot,
      addressKind: "structured",
      village: challan.companyVillageSnapshot as string,
      postOffice: challan.companyPostOfficeSnapshot as string,
      policeStation: challan.companyPoliceStationSnapshot as string,
      district: challan.companyDistrictSnapshot as string,
      state: challan.companyStateSnapshot as string,
    } : {
      name: challan.companyNameSnapshot,
      businessDescription: challan.companyBusinessDescriptionSnapshot,
      mobile: challan.companyMobileSnapshot,
      addressKind: "legacy",
      address: challan.companyAddressSnapshot,
    };

  const brickLines: PrintableChallanBrickLine[] = [...challan.items]
    .sort((left, right) => left.linePosition - right.linePosition)
    .map((item) => ({
      lineKind: "BRICK",
      quantity: item.quantity,
      particulars: item.brickParticularsSnapshot,
      rate: item.ratePer1000Bricks,
      amount: item.lineAmount,
    }));
  const flexibleLines: PrintableChallanLine[] = [...challan.flexibleLines]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((line) => line.lineType === "NOTE" ? {
      lineKind: "NOTE",
      particulars: line.particulars,
    } : {
      lineKind: "EXTRA_CHARGE",
      quantity: line.quantity,
      particulars: line.particulars,
      rate: line.rate,
      amount: line.amount,
    });
  const snapshotVehicleNumber = challan.vehicleNumberSnapshot?.trim();
  const legacyVehicleNumber = challan.vehicleNumber.trim();

  return {
    company,
    challanNumber: challan.challanNumber,
    challanDate: challan.challanDate,
    customer: {
      name: challan.customerNameSnapshot,
      address: challan.customerAddressSnapshot,
      mobile: challan.customerMobileSnapshot,
    },
    lines: [...brickLines, ...flexibleLines],
    total: challan.challanTotal,
    vehicleNumber: snapshotVehicleNumber || legacyVehicleNumber || null,
    isVoid: challan.status === "void",
  };
}

export function formatPrintableMoney(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPrintableQuantity(value: number): string {
  return value.toLocaleString("en-IN");
}

export function formatPrintableDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
