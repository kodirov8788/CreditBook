import { handleNeonVoice } from "@/lib/api/neon-voice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export function POST(request: Request) { return handleNeonVoice(request); }
