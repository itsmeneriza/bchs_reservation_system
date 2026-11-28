import assert from "node:assert/strict";
import test from "node:test";

if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = "https://forecast-test.supabase.co";
}
if (!process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = "forecast-test-key";
}

const {
  buildMacroForecast,
  getMacroWeekCount,
  getMacroWeekRange,
} = await import("./forecast.js");
const { formatMacroPeriod, getVisibleMacroPeriods } =
  await import("../admin/js/FacilityForecast.js");

test("Wednesday-anchored weeks cover calendar dates without gaps or overlaps", () => {
  const decemberFirstWeek = getMacroWeekRange(2026, 11, 0);
  assert.equal(decemberFirstWeek.start.toISOString().slice(0, 10), "2026-11-29");
  assert.equal(decemberFirstWeek.end.toISOString().slice(0, 10), "2026-12-05");
  assert.equal(getMacroWeekCount(2026, 10), 4);
  assert.equal(getMacroWeekCount(2026, 8), 5);

  for (const year of [2024, 2026]) {
    const ranges = [];
    for (let monthOffset = -1; monthOffset <= 12; monthOffset += 1) {
      const month = new Date(Date.UTC(year, monthOffset, 1));
      const monthYear = month.getUTCFullYear();
      const monthIndex = month.getUTCMonth();
      for (
        let weekNumber = 0;
        weekNumber < getMacroWeekCount(monthYear, monthIndex);
        weekNumber += 1
      ) {
        ranges.push(getMacroWeekRange(monthYear, monthIndex, weekNumber));
      }
    }

    for (
      let timestamp = Date.UTC(year, 0, 1);
      timestamp < Date.UTC(year + 1, 0, 1);
      timestamp += 24 * 60 * 60 * 1000
    ) {
      const containingRanges = ranges.filter(({ start, end }) =>
        timestamp >= start.getTime() && timestamp <= end.getTime(),
      );
      assert.equal(containingRanges.length, 1, new Date(timestamp).toISOString());
    }
  }
});

test("macro W5 forecast excludes historical years without a fifth Wednesday", () => {
  const activity = [
    { facilityId: "gym", date: "2026-09-27", startMinute: 420, endMinute: 960 },
    { facilityId: "gym", date: "2027-09-26", startMinute: 420, endMinute: 960 },
    { facilityId: "gym", date: "2027-09-27", startMinute: 420, endMinute: 960 },
  ];
  const macro = buildMacroForecast(activity, "gym", "2027-09-01");
  const septemberW5 = macro.find((period) => period.periodKey === "Sep 2027 W5");

  assert.ok(septemberW5);
  assert.equal(septemberW5.startDate, "2027-09-26");
  assert.equal(septemberW5.endDate, "2027-10-02");
  assert.equal(septemberW5.forecasted_pct, 42);
});

test("admin macro graph pages by three full months and formats W5 ranges", () => {
  const macro = buildMacroForecast([], "gym", "2026-11-23");
  const firstPage = getVisibleMacroPeriods(macro, 0);
  const secondPage = getVisibleMacroPeriods(macro, 3);

  assert.equal(firstPage.length, 13);
  assert.deepEqual(
    [...new Set(firstPage.map((item) => item.monthLabel))],
    ["Nov 2026", "Dec 2026", "Jan 2027"],
  );
  assert.equal(secondPage[0].monthLabel, "Feb 2027");
  assert.equal(formatMacroPeriod({ periodKey: "Dec 2026 W1" }), "Dec 2026 W1 (Nov 29-Dec 5, 2026)");
  assert.equal(formatMacroPeriod({ periodKey: "Sep 2026 W5" }), "Sep 2026 W5 (Sep 27-Oct 3, 2026)");
});
