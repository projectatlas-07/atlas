import type { ChallanNumber, CustomerPayment, CustomerPaymentMode } from "@/features/sales/types";

export type PrintablePaymentReceipt = {
  company: {
    name: string;
    businessDescription: string;
    address: string;
    mobile: string;
  };
  customer: { name: string; address: string; mobile: string };
  paymentDate: string;
  amount: number;
  paymentMode: CustomerPaymentMode;
  note: string | null;
  allocations: Array<{ challanNumber: ChallanNumber; amount: number }>;
};

export function buildPrintablePaymentReceipt(
  payment: CustomerPayment,
): PrintablePaymentReceipt {
  return {
    company: {
      name: payment.companyNameSnapshot,
      businessDescription: payment.companyBusinessDescriptionSnapshot,
      address: payment.companyAddressSnapshot,
      mobile: payment.companyMobileSnapshot,
    },
    customer: {
      name: payment.customerNameSnapshot,
      address: payment.customerAddressSnapshot,
      mobile: payment.customerMobileSnapshot,
    },
    paymentDate: payment.paymentDate,
    amount: payment.amount,
    paymentMode: payment.paymentMode,
    note: payment.note,
    allocations: payment.allocations.map((allocation) => ({
      challanNumber: allocation.challanNumber,
      amount: allocation.allocatedAmount,
    })),
  };
}
