import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Vitest supports the virtual mock option at runtime.
vi.mock("server-only", () => ({}), { virtual: true });

import { recordAudit } from "@/lib/audit";

const event = {
  actorUserId: "user-1",
  shopId: "shop-1",
  entityType: "shop" as const,
  entityId: "shop-1",
  action: "shop.name_updated",
};

describe("recordAudit", () => {
  it("returns success after the audit row is persisted", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ insert }) };

    await expect(recordAudit(client as never, event)).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith({
      actor_user_id: "user-1",
      shop_id: "shop-1",
      entity_type: "shop",
      entity_id: "shop-1",
      action: "shop.name_updated",
      metadata: {},
    });
  });

  it("throws when the audit row cannot be persisted", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "database unavailable" } });
    const client = { from: vi.fn().mockReturnValue({ insert }) };

    await expect(recordAudit(client as never, event)).rejects.toThrow("Audit log yozilmadi.");
  });
});
