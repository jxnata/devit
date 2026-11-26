import { describe, expect, test } from "bun:test";
import { describeCron, nextRun, parseCron } from "../src/core/cron.ts";

// Local-time helpers so the tests hold in any TZ.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const next = (expr: string, from: Date) => nextRun(parseCron(expr), from);

describe("cron", () => {
  test("parses fields, lists, ranges, steps and names", () => {
    const c = parseCron("*/15 9-17 * jan,jun mon-fri");
    expect([...c.minutes]).toEqual([0, 15, 30, 45]);
    expect(c.hours.size).toBe(9);
    expect([...c.months]).toEqual([1, 6]);
    expect([...c.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 0 * * 7").weekdays]).toEqual([0]); // 7 is Sunday too
    expect([...parseCron("5/20 * * * *").minutes]).toEqual([5, 25, 45]);
  });

  test("next run: Monday 09:00 weekly", () => {
    const thu = at(2026, 11, 26, 10, 0); // a Thursday
    expect(next("0 9 * * 1", thu)).toEqual(at(2026, 11, 30, 9, 0));
    expect(next("0 9 * * mon", at(2026, 11, 30, 9, 0))).toEqual(at(2026, 12, 7, 9, 0)); // strictly after
  });

  test("next run: steps, month rollover, aliases", () => {
    expect(next("*/10 * * * *", at(2026, 1, 1, 0, 3))).toEqual(at(2026, 1, 1, 0, 10));
    expect(next("@daily", at(2026, 12, 31, 12))).toEqual(at(2027, 1, 1));
    expect(next("@monthly", at(2026, 2, 10))).toEqual(at(2026, 3, 1));
    expect(next("0 0 31 * *", at(2026, 4, 1))).toEqual(at(2026, 5, 31)); // skips April
    expect(next("0 0 29 2 *", at(2026, 1, 1))).toEqual(at(2028, 2, 29));
  });

  test("both day fields restricted means either", () => {
    // the 1st of the month OR any Friday
    expect(next("0 8 1 * fri", at(2026, 11, 26, 9))).toEqual(at(2026, 11, 27, 8)); // Friday
    expect(next("0 8 1 * fri", at(2026, 11, 28))).toEqual(at(2026, 12, 1, 8)); // the 1st
  });

  test("bad expressions explain themselves", () => {
    expect(() => parseCron("0 9 * *")).toThrow("expected 5 fields");
    expect(() => parseCron("60 * * * *")).toThrow('minute "60" is out of range 0-59');
    expect(() => parseCron("0 9 * * funday")).toThrow("day of week");
    expect(() => parseCron("*/0 * * * *")).toThrow("bad step");
    expect(() => parseCron("0 0 30 2 *")).not.toThrow();
    expect(() => next("0 0 30 2 *", at(2026, 1, 1))).toThrow("never matches");
  });

  test("describes common schedules", () => {
    expect(describeCron(parseCron("0 9 * * 1"))).toBe("Mondays at 09:00");
    expect(describeCron(parseCron("30 8 * * 1-5"))).toBe("weekdays at 08:30");
    expect(describeCron(parseCron("@daily"))).toBe("daily at 00:00");
    expect(describeCron(parseCron("0 17 * * fri"))).toBe("Fridays at 17:00");
    expect(describeCron(parseCron("*/5 * * * *"))).toBe("*/5 * * * *");
  });
});
