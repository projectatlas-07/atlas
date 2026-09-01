import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ChallanPrintScreen } from "@/features/sales/components/challan-print-screen";

export default async function ChallanPage({
  params,
}: Readonly<{
  params: Promise<{ challanId: string }>;
}>) {
  const { challanId } = await params;
  return <AuthGuard><ChallanPrintScreen challanId={challanId} /></AuthGuard>;
}
