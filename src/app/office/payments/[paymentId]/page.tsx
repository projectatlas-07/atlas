import { AuthGuard } from "@/features/auth/components/auth-guard";
import { PaymentReceiptScreen } from "@/features/sales/components/payment-receipt-screen";

export default async function PaymentReceiptPage({
  params,
}: Readonly<{ params: Promise<{ paymentId: string }> }>) {
  const { paymentId } = await params;
  return <AuthGuard><PaymentReceiptScreen paymentId={paymentId} /></AuthGuard>;
}
