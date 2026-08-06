import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionEntryScreen } from "@/features/production/components/production-entry-screen";

export default function HomePage() { return <AuthGuard><ProductionEntryScreen /></AuthGuard>; }
