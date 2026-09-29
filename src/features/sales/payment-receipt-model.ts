import {
  formatCustomerPaymentMethods,
  type ChallanNumber,
  type CustomerPayment,
} from "./types.ts";

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
  paymentMethodDisplay: string;
  note: string | null;
  allocations: Array<{ challanNumber: ChallanNumber; challanDate: string; amount: number }>;
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
    paymentMethodDisplay: formatCustomerPaymentMethods(payment.methods, payment.paymentMode),
    note: payment.note,
    allocations: payment.allocations.map((allocation) => ({
      challanNumber: allocation.challanNumber,
      challanDate: allocation.challanDate,
      amount: allocation.allocatedAmount,
    })),
  };
}
