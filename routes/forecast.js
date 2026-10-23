import express from "express";
import { createServiceRoleSupabaseClient } from "../services/supabaseClient.js";
import {
  computeFacilityAnalytics,
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

async function computeForecast() {
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

  return {
    lastUpdated: now.toISOString(),
    analyzedYear,
    yearsIncluded,
    summary,
    facilityAnalytics,
    weeklyTrends,
    recommendations: computeRecommendations(facilityAnalytics),
  };
}

export function createForecastRouter() {
  const router = express.Router();

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
