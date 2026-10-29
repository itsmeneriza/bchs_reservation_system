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
        lastUpdated: new Date().toISOString(),
        analyzedYear: lastYear,
        yearsIncluded,
        summary: {
          totalreservations: 0,
          mostPopularRoom: 'N/A',
          peakHours: 'N/A',
          averageAttendees: 0,
          totalRevenue: 0,
          averageRevenuePerReservation: 0,
          staffRevenue: 0,
          projectedRevenue: 0
        },
        roomAnalytics: [],
        weeklyTrends: [],
        recommendations: []
      };
    }
  
    const rooms = ['auditorium', 'library', 'grounds', 'avr', 'gym'];
    const roomNames = { auditorium: 'Auditorium', library: 'Library', grounds: 'Grounds', avr: 'AVR', gym: 'Gym' };
  
    const summary = computeSummary(allData, roomNames);
  
    const roomAnalytics = rooms
      .map(roomId => computeRoomAnalytics(allData.filter(r => r.roomId === roomId), roomId, roomNames))
      .filter(Boolean);
    const projectedRevenue = roomAnalytics.reduce((sum, room) => sum + (Number(room.projectedRevenue) || 0), 0);
    summary.projectedRevenue = projectedRevenue;

    // Monthly trends (last completed year, all months with data)
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const weeklyTrends = monthNames.map((monthLabel, idx) => {
      const monthStr = String(idx + 1).padStart(2, '0');
      const monthData = allData.filter(r => r.date.startsWith(`${lastYear}-${monthStr}`));
      const byRoom = {};
      rooms.forEach(id => { byRoom[id] = monthData.filter(r => r.roomId === id).length; });
      return { week: `${monthLabel} ${lastYear}`, totalreservations: monthData.length, ...byRoom };
    }).filter(m => m.totalreservations > 0);
  
    const recommendations = computeRecommendations(roomAnalytics);
  
    return {
      lastUpdated: new Date().toISOString(),
      analyzedYear: lastYear,
      yearsIncluded,
      summary,
      roomAnalytics,
      weeklyTrends,
      recommendations
    };
  }
  
  const forecastCachePath = path.join(repoDataDir, 'forecast.json');
  
  /**
   * Load cached forecast from forecast.json, or null if missing/invalid.
   */
  function loadCachedForecast() {
    if (!fs.existsSync(forecastCachePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(forecastCachePath, 'utf8'));
      return data.forecast || null;
    } catch { return null; }
  }
  
  /**
   * Save forecast to forecast.json with year, schema version, and timestamp.
   */
  function saveForecastCache(forecast, analyzedYear) {
    const payload = {
      forecast: {
        ...forecast,
        analyzedYear,
        schemaVersion: FORECAST_SCHEMA_VERSION
      }
    };
    fs.writeFileSync(forecastCachePath, JSON.stringify(payload, null, 2), 'utf8');
  }
  
  /**
   * Returns true if the cached forecast is still valid.
   */
  function isCacheValid(cached, lastYear) {
    if (!cached) return false;
    if (cached.analyzedYear !== lastYear) return false;
    if (cached.schemaVersion !== FORECAST_SCHEMA_VERSION) return false;
    if (!cached.lastUpdated) return false;
    const age = Date.now() - new Date(cached.lastUpdated).getTime();
    return age < FORECAST_MAX_CACHE_AGE_MS;
  }
  
  router.get('/api/forecast', (_req, res) => {
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
