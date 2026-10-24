import { handleNeonLedger } from "@/lib/api/neon-ledger";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleNeonLedger(request, "snapshot"); }
