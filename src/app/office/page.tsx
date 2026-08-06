import { AuthGuard } from "@/features/auth/components/auth-guard";
import { OfficeDashboard } from "@/features/office/components/office-dashboard";

export default function OfficePage() { return <AuthGuard><OfficeDashboard /></AuthGuard>; }
