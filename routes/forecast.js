import express from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { createServiceRoleSupabaseClient } from "../services/supabaseClient.js";
import {
  computeFacilityAnalytics,
  computeRevenueForecast,
  computeSummary,
  computeRecommendations,
} from "../scripts/ForecastService.js";
import { fromDbReservation } from "./requests.js";

const FACILITIES = {
  auditorium: "Auditorium",
  library: "Library",
  grounds: "Grounds",
  avr: "AVR",
  gym: "Gym",
};

const ACTIVE_STATUSES = ["confirmed", "approved", "accepted", "completed"];
const WEEK_LABELS = ["W1", "W2", "W3", "W4"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MICRO_WEEK_WEIGHTS = [0.4, 0.3, 0.2, 0.1];
const MICRO_START_HOUR = 7;
const MICRO_END_HOUR = 18;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function dateParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatMacroDateRange(start, end) {
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  if (startYear !== endYear) {
    return `${startMonth} ${start.getUTCDate()}, ${startYear}-${endMonth} ${end.getUTCDate()}, ${endYear}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${startMonth} ${start.getUTCDate()}-${endMonth} ${end.getUTCDate()}, ${endYear}`;
  }
  return `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${endYear}`;
}

function normalizeActivity(entries) {
  const intervalsByDate = new Map();
  for (const entry of entries) {
    const date = dateParts(entry.date);
    const start = parseTime(entry.startTime);
    const end = parseTime(entry.endTime);
    if (!date || !entry.facilityId || start === null || end === null || end <= start) continue;

    const startMinute = Math.max(7 * 60, start);
    const endMinute = Math.min(18 * 60, end);
    if (endMinute <= startMinute) continue;

    const key = `${entry.facilityId}|${dateKey(date)}`;
    if (!intervalsByDate.has(key)) {
      intervalsByDate.set(key, {
        facilityId: entry.facilityId,
        date: dateKey(date),
        intervals: [],
      });
    }
    intervalsByDate.get(key).intervals.push([startMinute, endMinute]);
  }

  return [...intervalsByDate.values()].flatMap(({ facilityId, date, intervals }) => {
    intervals.sort((left, right) => left[0] - right[0]);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        merged.push([...interval]);
      }
    }
    return merged.map(([startMinute, endMinute]) => ({
      facilityId,
      date,
      startMinute,
      endMinute,
    }));
  });
}

function expandEvent(event, fromDate, throughDate) {
  const eventStart = dateParts(event.start_date);
  const eventEnd = dateParts(event.end_date || event.start_date);
  const rangeStart = dateParts(fromDate);
  const rangeEnd = dateParts(throughDate);
  if (!eventStart || !eventEnd || !rangeStart || !rangeEnd || eventStart > eventEnd) return [];
  const start = eventStart > rangeStart ? eventStart : rangeStart;
  const end = eventEnd < rangeEnd ? eventEnd : rangeEnd;
  if (!start || !end) return [];
  const days = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push({
      facilityId: event.facility_id,
      date: dateKey(date),
      startTime: event.start_time,
      endTime: event.end_time,
      isEvent: true,
    });
  }
  return days;
}

function getMacroWeekRange(year, monthIndex, weekNumber) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + weekNumber * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

async function fetchAllRows(query) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadForecastActivity(referenceYear, client) {
  const firstYear = referenceYear - 3;
  const [reservations, events] = await Promise.all([
    fetchAllRows(client
      .from("reservations")
      .select("reservation_code,date,start_time,end_time,facility_id,status")
      .in("status", ACTIVE_STATUSES)
      .gte("date", `${firstYear}-01-01`)
      .lte("date", `${referenceYear}-12-31`)
      .order("date", { ascending: true })
      .order("reservation_code", { ascending: true })),
    fetchAllRows(client
      .from("events")
      .select("id,start_date,end_date,start_time,end_time,facility_id")
      .lte("start_date", `${referenceYear}-12-31`)
      .gte("end_date", `${firstYear}-01-01`)
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })),
  ]);
  return normalizeActivity([
    ...reservations
      .filter((row) => ACTIVE_STATUSES.includes(String(row.status || "").trim().toLowerCase()))
      .map((row) => ({
        facilityId: row.facility_id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
      })),
    ...events.flatMap((event) =>
      expandEvent(event, `${firstYear}-01-01`, `${referenceYear}-12-31`),
    ),
  ]);
}

function getTier(value) {
  if (value >= 70) return "High";
  if (value >= 35) return "Moderate";
  return "Low";
}

function buildMacroForecast(activity, facilityId, referenceDate) {
  const start = dateParts(referenceDate) || new Date();
  const startMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const forecastYears = [startMonth.getUTCFullYear() - 2, startMonth.getUTCFullYear() - 1, startMonth.getUTCFullYear()];
  const facilityActivity = activity.filter((entry) => entry.facilityId === facilityId);

  return Array.from({ length: 12 }, (_, offset) => {
    const forecastMonth = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + offset, 1));
    const monthIndex = forecastMonth.getUTCMonth();
    const month = MONTHS[monthIndex];
    const year = forecastMonth.getUTCFullYear();
    return WEEK_LABELS.map((weekLabel, weekNumber) => {
      const forecastRange = getMacroWeekRange(year, monthIndex, weekNumber);
      const observedByYear = forecastYears.map((observedYear) => {
        const observedRange = getMacroWeekRange(observedYear, monthIndex, weekNumber);
        const hours = facilityActivity.reduce((total, entry) => {
          const date = dateParts(entry.date);
          return date &&
            date >= observedRange.start &&
            date <= observedRange.end
            ? total + (entry.endMinute - entry.startMinute) / 60
            : total;
        }, 0);
        return Math.min(100, (hours / 54) * 100);
      });
      const adjustment = monthIndex === 3 || monthIndex === 4 ? -40 : monthIndex === 8 ? 15 : 0;
      const forecasted = Math.max(
        0,
        Math.min(
          100,
          observedByYear[0] * 0.15 + observedByYear[1] * 0.3 + observedByYear[2] * 0.55 + adjustment,
        ),
      );
      return {
        periodKey: `${month} ${year} W${weekNumber + 1}`,
        monthLabel: `${month} ${year}`,
        dateRange: formatMacroDateRange(forecastRange.start, forecastRange.end),
        year,
        month: monthIndex + 1,
        week: weekLabel,
        forecasted_pct: Math.round(forecasted),
        demand_tier: getTier(forecasted),
        anchor_event_note: monthIndex === 3 || monthIndex === 4
          ? "Mandatory EOSY vacation adjustment"
          : monthIndex === 8
            ? "Peak orientation and event season adjustment"
            : "Historical activity and live bookings",
      };
    });
  }).flat();
}

function buildMicroForecast(activity, facilityId, referenceDate) {
  const target = dateParts(referenceDate) || new Date();
  const sunday = new Date(target);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  const facilityActivity = activity.filter((entry) => entry.facilityId === facilityId);
  return Array.from(
    { length: MICRO_END_HOUR - MICRO_START_HOUR },
    (_, index) => {
      const hour = MICRO_START_HOUR + index;
      return DAYS.map((day, dayIndex) => {
        let weightedActivity = 0;
        for (let week = 1; week <= 4; week += 1) {
          const date = new Date(sunday);
          date.setUTCDate(date.getUTCDate() - week * 7 + dayIndex);
          const dateValue = dateKey(date);
          const active = facilityActivity.some((entry) =>
            entry.date === dateValue &&
            entry.startMinute < (hour + 1) * 60 &&
            entry.endMinute > hour * 60,
          );
          if (active) weightedActivity += MICRO_WEEK_WEIGHTS[week - 1];
        }
        const weightedScore = Number(weightedActivity.toFixed(2));
        return {
          day,
          dayIndex,
          hour,
          label: `${String(hour).padStart(2, "0")}:00 - ${String(hour + 1).padStart(2, "0")}:00`,
          moving_avg_score: weightedScore,
          slot_status: weightedScore >= 0.75
            ? "Busy"
            : weightedScore >= 0.35
              ? "Moderate"
              : "Available",
        };
      });
    },
  );
}

async function computeUserForecast(facilityId, referenceDate) {
  const targetDate = dateParts(referenceDate) || new Date();
  const client = createServiceRoleSupabaseClient();
  const [{ data: facilities, error: facilitiesError }, activity] = await Promise.all([
    client.from("facilities").select("id,name").order("name", { ascending: true }),
    loadForecastActivity(targetDate.getUTCFullYear(), client),
  ]);
  if (facilitiesError) throw facilitiesError;
  if (!facilities?.length) throw new Error("No facilities are available for forecasting.");
  const selectedFacility = facilities.some((facility) => facility.id === facilityId)
    ? facilityId
    : facilities[0].id;
  const forecast = {
    lastUpdated: new Date().toISOString(),
    facilities,
    selectedFacility: selectedFacility,
    macro: buildMacroForecast(activity, selectedFacility, referenceDate),
    micro: buildMicroForecast(activity, selectedFacility, referenceDate),
  };
  return forecast;
}

async function computeForecast({ includeRevenue = false } = {}) {
  const now = new Date();
  const analyzedYear = now.getFullYear() - 1;
  const yearsToInclude = [analyzedYear];
  if (analyzedYear - 1 >= 2024) yearsToInclude.push(analyzedYear - 1);

  const firstYear = Math.min(...yearsToInclude);
  const { data, error } = await createServiceRoleSupabaseClient()
    .from("reservations")
    .select("*, facilities(name)")
    .in("status", ["approved", "accepted"])
    .gte("date", `${firstYear}-01-01`)
    .lte("date", `${analyzedYear}-12-31`);
  if (error) throw error;

  const reservations = (data || [])
    .map(fromDbReservation)
    .filter((reservation) => yearsToInclude.includes(
      new Date(`${reservation.date}T00:00:00`).getFullYear(),
    ));
  const yearsIncluded = [
    ...new Set(
      reservations.map((reservation) =>
        new Date(`${reservation.date}T00:00:00`).getFullYear(),
      ),
    ),
  ].sort((a, b) => a - b);

  const summary = computeSummary(reservations, FACILITIES);
  const facilityAnalytics = Object.keys(FACILITIES)
    .map((facilityId) =>
      computeFacilityAnalytics(
        reservations.filter((reservation) => reservation.facilityId === facilityId),
        facilityId,
        FACILITIES,
      ),
    )
    .filter(Boolean);
  const monthLabels = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const weeklyTrends = monthLabels
    .map((month, index) => {
      const monthPrefix = `${analyzedYear}-${String(index + 1).padStart(2, "0")}`;
      const monthReservations = reservations.filter((reservation) =>
        reservation.date.startsWith(monthPrefix),
      );
      const facilityTotals = Object.fromEntries(
        Object.keys(FACILITIES).map((facilityId) => [
          facilityId,
          monthReservations.filter(
            (reservation) => reservation.facilityId === facilityId,
          ).length,
        ]),
      );
      return {
        week: `${month} ${analyzedYear}`,
        totalreservations: monthReservations.length,
        ...facilityTotals,
      };
    })
    .filter((month) => month.totalreservations > 0);

  const forecast = {
    lastUpdated: now.toISOString(),
    analyzedYear,
    yearsIncluded,
    summary,
    facilityAnalytics,
    weeklyTrends,
    recommendations: computeRecommendations(facilityAnalytics),
  };

  if (includeRevenue) {
    const {
      facilityAnalytics: revenueFacilities,
      ...revenueSummary
    } = computeRevenueForecast(reservations, facilityAnalytics);
    forecast.summary = { ...summary, ...revenueSummary };
    forecast.facilityAnalytics = revenueFacilities;
  }

  return forecast;
}

export function createForecastRouter() {
  const router = express.Router();

  router.get("/admin", requireAdmin, async (_req, res) => {
    try {
      return res.json({ forecast: await computeForecast({ includeRevenue: true }) });
    } catch (error) {
      console.error("Could not compute admin forecast from Supabase:", error);
      return res.status(500).json({
        success: false,
        message: "Could not compute admin forecast.",
        error: error.message,
      });
    }
  });

  router.get("/", async (_req, res) => {
    try {
      return res.json({ forecast: await computeForecast() });
    } catch (error) {
      console.error("Could not compute forecast from Supabase:", error);
      return res.status(500).json({
        success: false,
        message: "Could not compute forecast.",
        error: error.message,
      });
    }
  });

  router.get("/user", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.referenceDate && !dateParts(req.query.referenceDate)) {
      return res.status(400).json({
        message: "Enter a valid forecast reference date.",
      });
    }
    try {
      return res.json({
        forecast: await computeUserForecast(
          req.query.facilityId,
          req.query.referenceDate,
        ),
      });
    } catch (error) {
      console.error("Could not compute user forecast from Supabase:", error);
      return res.status(500).json({
        success: false,
        message: "Could not compute facility booking forecast.",
      });
    }
  });

  router.post("/refresh", async (_req, res) => {
    try {
      return res.json({
        success: true,
        forecast: await computeForecast(),
      });
    } catch (error) {
      console.error("Could not refresh forecast from Supabase:", error);
      return res.status(500).json({
        success: false,
        message: "Could not refresh forecast.",
        error: error.message,
      });
    }
  });

  return router;
}

export {
  buildMacroForecast,
  buildMicroForecast,
  expandEvent,
  getMacroWeekRange,
  normalizeActivity,
};
