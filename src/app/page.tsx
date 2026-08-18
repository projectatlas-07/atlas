import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ManagerEntryScreen } from "@/features/manager/components/manager-entry-screen";

export default function HomePage() { return <AuthGuard><ManagerEntryScreen /></AuthGuard>; }
