import { handleNeonLedger } from "@/lib/api/neon-ledger";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleNeonLedger(request); }
