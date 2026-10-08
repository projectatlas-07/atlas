import {
  formatCustomerPaymentMethods,
  type ChallanNumber,
  type CustomerPayment,
  type CustomerPaymentResult,
} from "./types.ts";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";

export type PaymentReceiptLoadState =
  | { status: "loading" }
  | { status: "error" | "not-found" | "details-unavailable"; paymentId: string; message: string }
  | { status: "ready"; receipt: PrintablePaymentReceipt };

export async function loadPaymentReceiptDetails(
  paymentId: string,
  readPayment: () => Promise<CustomerPaymentResult>,
): Promise<PaymentReceiptLoadState> {
  try {
    const payment = await readPayment();
    if (payment.detailsStatus === "unavailable") {
      return { status: "details-unavailable", paymentId: payment.id,
        message: ATLAS_UI_STRINGS.payment.detailsUnavailable };
    }
    return { status: "ready", receipt: buildPrintablePaymentReceipt(payment) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "PAYMENT_NOT_FOUND") {
      return { status: "not-found", paymentId, message: ATLAS_UI_STRINGS.payment.notFound };
    }
    return { status: "error", paymentId, message: "Could not load this payment receipt. Retry details." };
  }
}

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
