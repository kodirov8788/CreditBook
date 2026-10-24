import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getCustomerStatus } from "@/lib/customer-status";
import { localDate } from "@/lib/personal-finance/accounts";
import { BOOK_TIME_ZONE } from "@/lib/personal-finance/book";

const cases = [
  [100, "2026-10-19", "2026-10-19T16:00:00Z", "due-soon"],
  [100, "2026-10-19", "2026-10-19T23:59:59.999Z", "due-soon"],
  [100, "2026-10-19", "2026-10-20T00:00:00Z", "overdue"],
  [100, "2026-10-19", "2026-10-20T07:00:00Z", "overdue"],
  [100, "2026-10-27", "2026-10-19T16:00:00Z", "on-track"],
  [0, "2026-10-18", "2026-10-19T16:00:00Z", "paid"],
  [100, null, "2026-10-19T16:00:00Z", "on-track"],
] as const;

describe("shop UTC due-date boundary", () => {
  it.each(cases)("balance%s due%s at%s is%s", (balance, due, now, expected) => {
    expect(getCustomerStatus(balance, due, Date.parse(now))).toBe(expected);
  });

  // Separate processes prove native Date parsing really uses each TZ. Changing
  // TZ inside a test worker can leave that worker's Date timezone cached.
  it.each(["UTC", "Asia/Tokyo", "Asia/Tashkent", "America/Los_Angeles"])(
    "returns identical shop states and UTC aggregate classification in %s", zone => {
      const moduleUrl = pathToFileURL(path.resolve("lib/customer-status.ts")).href;
      const source = `import {getCustomerStatus} from ${JSON.stringify(moduleUrl)};
        const cases=${JSON.stringify(cases)};
        console.log(JSON.stringify(cases.map(([balance,due,instant])=>{
          const now=Date.parse(instant);
          return {status:getCustomerStatus(balance,due,now),
            aggregateOverdue:balance>0 && due!==null && due<new Date(now).toISOString().slice(0,10)};
        })));`;
      const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
        env: {...process.env, TZ: zone}, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      expect(JSON.parse(output)).toEqual(cases.map(([, , , status]) => ({status, aggregateOverdue: status === "overdue"})));
    },
  );

  it("does not change the personal account's Tokyo effective day", () => {
    const instant = new Date("2026-10-19T16:00:00Z");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(instant);
      expect(BOOK_TIME_ZONE).toBe("Asia/Tokyo");
      expect(localDate(BOOK_TIME_ZONE)).toBe("2026-10-20");
      expect(getCustomerStatus(100, "2026-10-19")).toBe("due-soon");
    } finally { vi.useRealTimers(); }
  });
});
