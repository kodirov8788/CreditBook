import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

type ActivityRow = {
  id: string;
  customer_id: string | null;
  event_type: string;
  description: string;
  created_at: string;
  customers?: { name?: string; phone?: string | null } | null;
};

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const url = new URL(request.url);
  const eventType = url.searchParams.get("eventType");
  const customerId = url.searchParams.get("customerId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const query = url.searchParams.get("q")?.trim();
  const format = url.searchParams.get("format");
  const access = await requireShopPermission(supabase, user, format === "csv" ? "activity.export" : "activity.read");
  if (!access.ok) return access.response;
  const isCsv = format === "csv";
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 50), 1), 100);
  const fromRow = (page - 1) * pageSize;

  let builder = supabase
    .from("activity_logs")
    .select("id, customer_id, event_type, description, created_at, customers(name, phone)", { count: "exact" })
    .eq("shop_id", access.shopId)
    .order("created_at", { ascending: false });
  if (eventType && eventType !== "all") builder = builder.eq("event_type", eventType);
  if (customerId && customerId !== "all") builder = builder.eq("customer_id", customerId);
  if (from) builder = builder.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) builder = builder.lt("created_at", `${to}T23:59:59.999Z`);
  const safeQuery = query?.replace(/[(),]/g, " ").trim();
  if (safeQuery) builder = builder.or(`description.ilike.%${safeQuery}%,event_type.ilike.%${safeQuery}%`);
  if (!isCsv) builder = builder.range(fromRow, fromRow + pageSize - 1);

  const { data, error, count } = await builder;
  if (error) return serverError();
  const activities = (data ?? []) as ActivityRow[];
  if (format === "csv") {
    const rows = [
      ["Sana", "Mijoz", "Turi", "Izoh"],
      ...activities.map((activity) => [activity.created_at, activity.customers?.name || "", activity.event_type, activity.description]),
    ];
    return new NextResponse(rows.map((row) => row.map(csvCell).join(",")).join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="creditbook-faoliyat.csv"`,
      },
    });
  }

  return NextResponse.json({ activities, page, pageSize, total: count ?? 0, hasMore: fromRow + activities.length < (count ?? 0) });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "activity.create");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null) as { customerId?: string | null; eventType?: string; description?: string } | null;
  const description = body?.description?.trim();
  const eventType = body?.eventType?.trim();
  if (!description || eventType !== "note") return badRequest("Qo'lda faqat izoh yozish mumkin.");

  const { data, error } = await supabase
    .from("activity_logs")
    .insert({ customer_id: body?.customerId || null, event_type: eventType, description })
    .select("id, customer_id, event_type, description, created_at")
    .single();

  if (error || !data) return serverError();
  return NextResponse.json({ activity: data }, { status: 201 });
}
