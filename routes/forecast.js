const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  computeRoomAnalytics,
  computeSummary,
  computeRecommendations,
  computeMonthlyTrends,
} = require("../scripts/ForecastService");

module.exports = function createForecastRouter({ dataDir, readHistory }) {
  const router = express.Router();
  const repoDataDir = dataDir;
  // -- Forecast schema version � bump whenever the algorithm changes ------------
  const FORECAST_SCHEMA_VERSION = 5; // v5: seasonal baseline and weighted moving average only
  const FORECAST_MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

  // --- Live Forecast Computation -----------------------------------------------

  /**
   * Compute forecast data live from history.json + accepted.json.
   * Called on GET /api/forecast � no static forecast.json needed.
   * Core algorithm lives in scripts/ForecastService.js.
   */
  function computeForecast() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const lastYear = currentYear - 1;
    const priorYear = lastYear - 1;
    const yearsToInclude = [lastYear];

    // If 2024-style historical data exists, include it as a secondary baseline so
    // the forecast can learn from a broader trend window without changing the
    // primary analyzed year.
    if (priorYear >= 2024) {
      yearsToInclude.push(priorYear);
    }

    // Load history (past completed reservations)
    const history = readHistory();

    // Load accepted (current/future approved reservations)
    const acceptedPath = path.join(repoDataDir, "accepted.json");
    let accepted = [];
    if (fs.existsSync(acceptedPath)) {
      try {
        const d = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
        accepted = d.accepted || [];
      } catch {}
    }

    // Scope analysis to the last completed year by default, while optionally
    // including the immediately previous year for deeper forecast baselines.
    const allData = [...history, ...accepted].filter((r) => {
      const year = new Date(r.date).getFullYear();
      return yearsToInclude.includes(year);
    });
    const yearsIncluded = [
      ...new Set(allData.map((r) => new Date(r.date).getFullYear())),
    ].sort((a, b) => a - b);

    if (allData.length === 0) {
      return {
        lastUpdated: new Date().toISOString(),
        analyzedYear: lastYear,
        yearsIncluded,
        summary: {
          totalreservations: 0,
          mostPopularRoom: "N/A",
          peakHours: "N/A",
          averageAttendees: 0,
        },
        facilityAnalytics: [],
        weeklyTrends: [],
        recommendations: [],
      };
    }

    const facilitys = ["auditorium", "library", "grounds", "avr", "gym"];
    const facilityNames = {
      auditorium: "Auditorium",
      library: "Library",
      grounds: "Grounds",
      avr: "AVR",
      gym: "Gym",
    };

    const summary = computeSummary(allData, facilityNames);

    const facilityAnalytics = facilitys
      .map((facilityId) =>
        computeRoomAnalytics(
          allData.filter((r) => r.facilityId === facilityId),
          facilityId,
          facilityNames,
        ),
      )
      .filter(Boolean);

    // Monthly trends (last completed year, all months with data)
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const weeklyTrends = monthNames
      .map((monthLabel, idx) => {
        const monthStr = String(idx + 1).padStart(2, "0");
        const monthData = allData.filter((r) =>
          r.date.startsWith(`${lastYear}-${monthStr}`),
        );
        const byRoom = {};
        facilitys.forEach((id) => {
          byRoom[id] = monthData.filter((r) => r.facilityId === id).length;
        });
        return {
          week: `${monthLabel} ${lastYear}`,
          totalreservations: monthData.length,
          ...byRoom,
        };
      })
      .filter((m) => m.totalreservations > 0);

    const recommendations = computeRecommendations(facilityAnalytics);

    return {
      lastUpdated: new Date().toISOString(),
      analyzedYear: lastYear,
      yearsIncluded,
      summary,
      facilityAnalytics,
      weeklyTrends,
      recommendations,
    };
  }

  const forecastCachePath = path.join(repoDataDir, "forecast.json");

  /**
   * Load cached forecast from forecast.json, or null if missing/invalid.
   */
  function loadCachedForecast() {
    if (!fs.existsSync(forecastCachePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(forecastCachePath, "utf8"));
      return data.forecast || null;
    } catch {
      return null;
    }
  }

  /**
   * Save forecast to forecast.json with year, schema version, and timestamp.
   */
  function saveForecastCache(forecast, analyzedYear) {
    const payload = {
      forecast: {
        ...forecast,
        analyzedYear,
        schemaVersion: FORECAST_SCHEMA_VERSION,
      },
    };
    fs.writeFileSync(
      forecastCachePath,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
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

  router.get("/api/forecast", (_req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;
      const cached = loadCachedForecast();

      if (isCacheValid(cached, lastYear)) {
        return res.status(200).json({ forecast: cached });
      }

      // Cache is stale, missing, or schema changed � recompute
      const fresh = computeForecast();
      saveForecastCache(fresh, lastYear);
      res.status(200).json({ forecast: fresh });
    } catch (error) {
      console.error("? Error computing forecast:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to compute forecast",
          error: error.message,
        });
    }
  });
  // Manual forecast refresh endpoint
  router.post("/api/forecast/refresh", (_req, res) => {
    generateForecastFromData();
    res.status(200).json({ success: true, message: "Forecast refreshed" });
  });

  // --- Auto Forecast Generator -------------------------------------------------
  // Core algorithm shared with computeForecast() via scripts/ForecastService.js.

  function generateForecastFromData() {
    try {
      const requestsPath = path.join(repoDataDir, "requests.json");
      const acceptedPath = path.join(repoDataDir, "accepted.json");
      const historyPath = path.join(repoDataDir, "history.json");
      const forecastPath = path.join(repoDataDir, "forecast.json");

      // Collect all reservation data
      let all = [];
      if (fs.existsSync(requestsPath)) {
        const d = JSON.parse(fs.readFileSync(requestsPath, "utf8"));
        all = all.concat(
          (d.requests || []).filter(
            (r) => r.status === "approved" && r.date && r.facilityId,
          ),
        );
      }
      if (fs.existsSync(acceptedPath)) {
        const d = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
        all = all.concat(
          (d.accepted || []).filter((r) => r.date && r.facilityId),
        );
      }
      if (fs.existsSync(historyPath)) {
        const d = JSON.parse(fs.readFileSync(historyPath, "utf8"));
        all = all.concat(
          (Array.isArray(d) ? d : d.history || []).filter(
            (r) => r.date && r.facilityId,
          ),
        );
      }

      // Deduplicate by id
      const seen = new Set();
      all = all.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      if (all.length === 0) {
        console.log("[Forecast] No data to analyze yet.");
        return;
      }

      const facilityIds = ["auditorium", "library", "grounds", "avr", "gym"];
      const facilityNames = {
        auditorium: "Auditorium",
        library: "Library",
        grounds: "Grounds",
        avr: "AVR",
        gym: "Gym",
      };
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;

      const summary = computeSummary(all, facilityNames);

      const facilityAnalytics = facilityIds
        .map((facilityId) =>
          computeRoomAnalytics(
            all.filter((r) => r.facilityId === facilityId),
            facilityId,
            facilityNames,
          ),
        )
        .filter(Boolean);

      // Monthly historical trends (last 6 months)
      const historicalTrends = computeMonthlyTrends(all, facilityIds, 6);

      // -- Ahead predictions: next 3 months based on same-month avg from history -
      const monthlyAvg = {};
      all.forEach((r) => {
        const m = new Date(r.date).getMonth();
        if (!monthlyAvg[m]) monthlyAvg[m] = { total: 0, facilitys: {} };
        monthlyAvg[m].total++;
        facilityIds.forEach((rid) => {
          if (!monthlyAvg[m].facilitys[rid]) monthlyAvg[m].facilitys[rid] = 0;
          if (r.facilityId === rid) monthlyAvg[m].facilitys[rid]++;
        });
      });

      // Count distinct years per month for true average
      const yearsByMonth = {};
      all.forEach((r) => {
        const d = new Date(r.date);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        yearsByMonth[key] = true;
      });
      const yearsPerMonth = {};
      Object.keys(yearsByMonth).forEach((k) => {
        const m = parseInt(k.split("-")[1]);
        yearsPerMonth[m] = (yearsPerMonth[m] || 0) + 1;
      });

      const thisYearCount = all.filter(
        (r) => new Date(r.date).getFullYear() === currentYear,
      ).length;
      const lastYearCount = all.filter(
        (r) => new Date(r.date).getFullYear() === currentYear - 1,
      ).length;
      const growthFactor =
        lastYearCount > 0 ? Math.min(2, thisYearCount / lastYearCount) : 1;

      const predictedTrends = [];
      const now = new Date();
      for (let i = 1; i <= 3; i++) {
        const future = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const m = future.getMonth();
        const label = future.toLocaleString("en-US", {
          month: "short",
          year: "numeric",
        });
        const yearsOfData = yearsPerMonth[m] || 1;
        const avg = monthlyAvg[m];
        const predicted = avg
          ? Math.round(avg.total / yearsOfData)
          : Math.round(all.length / 12);
        const facilityPredictions = {};
        facilityIds.forEach((rid) => {
          facilityPredictions[rid] = avg
            ? Math.round((avg.facilitys[rid] || 0) / yearsOfData)
            : 0;
        });
        predictedTrends.push({
          week: `Predicted: ${label}`,
          totalreservations: Math.round(predicted * growthFactor),
          ...facilityPredictions,
        });
      }

      const weeklyTrends = [...historicalTrends, ...predictedTrends];
      const recommendations = computeRecommendations(facilityAnalytics);

      const forecast = {
        lastUpdated: new Date().toISOString(),
        analyzedYear: lastYear,
        schemaVersion: FORECAST_SCHEMA_VERSION,
        totalAnalyzed: all.length,
        summary,
        facilityAnalytics,
        weeklyTrends,
        aheadPredictions: predictedTrends,
        recommendations,
      };

      fs.writeFileSync(
        forecastPath,
        JSON.stringify({ forecast }, null, 2),
        "utf8",
      );
      console.log(`? Forecast auto-generated from ${all.length} reservations.`);
    } catch (e) {
      console.error("? Forecast generation failed:", e.message);
    }
  }
  return { router, generateForecastFromData };
};
