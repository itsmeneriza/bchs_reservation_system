/**
 * ForecastService — shared forecast algorithm used by both forecast functions
 * in server.js.
 *
 * Methodology (v4):
 *
 *  UTILIZATION
 *    Fixed: measures total booked hours against available hours only during
 *    the weeks the room was actually active (instead of the full date span,
 *    which inflated the denominator and produced misleadingly low percentages).
 *
 *  PREDICTION — two methods
 *    Seasonal baseline – Average the reservation counts for the matching ISO
 *              week across available years, adjusted by a recent trend factor.
 *              The seasonal/trend weights are 0.6/0.4.
 *    4-week Weighted Moving Average – Used when there is no same-week history.
 *              Weights: [0.4, 0.3, 0.2, 0.1] most-recent-first.
 *
 *  CONFIDENCE
 *    high   — seasonal baseline with at least 2 years of same-week data
 *    medium — seasonal baseline with 1 year of same-week data
 *    low    — WMA fallback used (no same-week history)
 *
 * CommonJS only — server-side.
 *
 * Usage:
 *   const { computeRoomAnalytics, computeSummary, computeRecommendations,
 *           computeMonthlyTrends }
 *       = require('./scripts/ForecastService');
 */

'use strict';

const { getISOWeek } = require('./DateUtils');
const { getRoomPrice } = require('./RoomUtils');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the ISO week number for a Date.
 * (Re-uses the shared utility; kept local-alias for brevity.)
 */
const isoWeek = getISOWeek;

/**
 * 4-week Weighted Moving Average.
 * Weights: week-1 = 0.4, week-2 = 0.3, week-3 = 0.2, week-4 = 0.1
 * (most recent first).  Returns 0 if no data at all.
 *
 * @param {object[]} roomData   Reservation records for one room
 * @param {Date}     now
 * @returns {number}
 */
function weightedMovingAverage(roomData, now) {
    const weights = [0.4, 0.3, 0.2, 0.1]; // week 1 … week 4
    let wma = 0;
    for (let i = 0; i < 4; i++) {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 7 * (i + 1));
        const weekEnd   = new Date(now);
        weekEnd.setDate(now.getDate() - 7 * i);
        const count = roomData.filter(r => {
            const d = new Date(r.date);
            return d >= weekStart && d < weekEnd;
        }).length;
        wma += count * weights[i];
    }
    return Math.max(0, Math.round(wma));
}

/**
 * Estimates the revenue for a reservation using the historical total amount when
 * available, else deriving it from the room rate and duration. Staff bookings are
 * treated as zero-charge internal reservations and do not contribute to external
 * revenue forecasts.
 *
 * @param {object} reservation
 * @returns {number}
 */
function calculateReservationRevenue(reservation) {
    if (!reservation) return 0;

    const explicitRevenue = Number(reservation.totalAmount);
    if (Number.isFinite(explicitRevenue) && explicitRevenue >= 0) {
        return explicitRevenue;
    }

    if (reservation.isStaff) return 0;

    const roomId = reservation.roomId;
    const pricePerHour = getRoomPrice(roomId) || 0;
    if (!pricePerHour) return 0;

    const start = reservation.startTime || '00:00';
    const end = reservation.endTime || start;
    const [startHour, startMin] = (start || '00:00').split(':').map(Number);
    const [endHour, endMin] = (end || '00:00').split(':').map(Number);
    const startMinutes = (startHour || 0) * 60 + (startMin || 0);
    const endMinutes = (endHour || 0) * 60 + (endMin || 0);
    const durationHours = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60 || 1));
    const utilityFee = durationHours >= 8 ? 800 : 0;
    return Math.round((pricePerHour * durationHours) + utilityFee);
}

// ─── Utilization (fixed) ──────────────────────────────────────────────────────

/**
 * Computes utilization as total booked hours ÷ available hours, where
 * "available hours" = (number of distinct weeks with any booking) × 5 days
 * × 11 hours/day.
 *
 * This avoids the old bug where daySpan stretched from the very first booking
 * to the very last, making the denominator enormous and the percentage tiny.
 *
 * @param {object[]} roomData
 * @returns {number}  0-100 (integer)
 */
function computeUtilization(roomData) {
    if (!roomData || roomData.length === 0) return 0;

    // Total booked hours
    const totalHours = roomData.reduce((s, r) => {
        const sh = parseInt((r.startTime || '0:0').split(':')[0]);
        const eh = parseInt((r.endTime   || '0:0').split(':')[0]);
        return s + Math.max(0, eh - sh);
    }, 0);

    // Count distinct ISO-year-week combos that have at least one booking
    const activeWeeks = new Set();
    roomData.forEach(r => {
        const d = new Date(r.date + 'T00:00:00');
        if (!isNaN(d.getTime())) {
            activeWeeks.add(`${d.getFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`);
        }
    });

    // Available = active weeks × 5 working days × 11 operating hours
    const available = activeWeeks.size * 5 * 11;
    if (available === 0) return 0;

    return Math.min(100, Math.round((totalHours / available) * 100));
}

// ─── Room Analytics ───────────────────────────────────────────────────────────

/**
 * Computes analytics and next-week prediction for a single room.
 *
 * @param {object[]} roomData     Reservation records filtered to this room
 * @param {string}   roomId
 * @param {Object<string,string>} roomNames   { id → displayName }
 * @param {object}   [opts]
 * @param {number}   [opts.comparisonYear]   Year to compare against for trend
 * @returns {object|null}  Analytics object, or null if roomData is empty
 */
function computeRoomAnalytics(roomData, roomId, roomNames, opts = {}) {
    if (!roomData || roomData.length === 0) return null;

    const currentYear = new Date().getFullYear();
    const compYear = opts.comparisonYear != null ? opts.comparisonYear : currentYear;

    // ── Average attendees ──────────────────────────────────────────────────
    const totalAtt = roomData.reduce((s, r) => s + (parseInt(r.attendees) || 0), 0);
    const averageAttendees = Math.round(totalAtt / roomData.length);

    const roomRevenue = roomData.reduce((acc, r) => {
        const amount = calculateReservationRevenue(r);
        acc.total += amount;
        if (r.isStaff) acc.staff += amount;
        return acc;
    }, { total: 0, staff: 0 });
    const averageRevenuePerReservation = roomData.length > 0
        ? Math.round(roomRevenue.total / roomData.length)
        : 0;

    // ── Peak days ──────────────────────────────────────────────────────────
    const dayCounts = {};
    roomData.forEach(r => {
        const d = new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        dayCounts[d] = (dayCounts[d] || 0) + 1;
    });
    const peakDays = Object.entries(dayCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([d]) => d);

    // ── Utilization (fixed algorithm) ──────────────────────────────────────
    const utilization = computeUtilization(roomData);

    // ── Year-over-year trend ───────────────────────────────────────────────
    const thisYearRes = roomData.filter(r => new Date(r.date).getFullYear() === compYear);
    const lastYearRes = roomData.filter(r => new Date(r.date).getFullYear() === compYear - 1);
    const trend = thisYearRes.length > lastYearRes.length ? 'increasing'
        : thisYearRes.length < lastYearRes.length ? 'decreasing'
        : 'stable';

    // ── Next-week prediction ───────────────────────────────────────────────
    const now = new Date();
    const nextWeekDate = new Date(now);
    nextWeekDate.setDate(now.getDate() + 7);
    const targetWeek = isoWeek(nextWeekDate);

    // Gather same-week counts per year, sorted oldest → newest
    const weekCountsByYear = {};
    roomData.forEach(r => {
        const d = new Date(r.date + 'T00:00:00');
        if (isNaN(d.getTime())) return;
        if (isoWeek(d) === targetWeek) {
            const yr = d.getFullYear();
            weekCountsByYear[yr] = (weekCountsByYear[yr] || 0) + 1;
        }
    });

    const sortedYears  = Object.keys(weekCountsByYear).map(Number).sort((a, b) => a - b);
    const sameWeekSeries = sortedYears.map(yr => weekCountsByYear[yr]);

    let predictedNextWeek;
    let predictionConfidence;
    let methodUsed;

    if (sameWeekSeries.length > 0) {
        // Seasonal baseline averaged across years with same-week observations.
        const seasonalBaseline = sameWeekSeries.reduce((sum, count) => sum + count, 0) / sameWeekSeries.length;

        // Recent trend factor: last 4 weeks vs prior 4 weeks
        const fourWeeksAgo  = new Date(now); fourWeeksAgo.setDate(now.getDate() - 28);
        const eightWeeksAgo = new Date(now); eightWeeksAgo.setDate(now.getDate() - 56);
        const recentFour   = roomData.filter(r => new Date(r.date) >= fourWeeksAgo  && new Date(r.date) < now).length;
        const previousFour = roomData.filter(r => new Date(r.date) >= eightWeeksAgo && new Date(r.date) < fourWeeksAgo).length;
        const recentAvg    = recentFour   / 4;
        const previousAvg  = previousFour / 4;
        // Clamp trend factor between 0.5 and 2.0
        const trendFactor  = previousAvg > 0
            ? Math.min(2.0, Math.max(0.5, recentAvg / previousAvg))
            : 1.0;

        // Blend 60% seasonal baseline with 40% recent trend.
        predictedNextWeek  = Math.max(0, Math.round(seasonalBaseline * (0.6 + 0.4 * trendFactor)));
        predictionConfidence = sameWeekSeries.length >= 2 ? 'high' : 'medium';
        methodUsed = 'seasonal-baseline';
    } else {
        // Use the 4-week weighted moving average when no seasonal history exists.
        predictedNextWeek  = weightedMovingAverage(roomData, now);
        predictionConfidence = 'low';
        methodUsed = 'weighted-moving-average';
    }

    const projectedRevenue = Math.max(0, Math.round((predictedNextWeek || 0) * averageRevenuePerReservation));

    return {
        roomId,
        roomName: roomNames[roomId] || roomId,
        totalreservations: roomData.length,
        averageAttendees,
        averageRevenuePerReservation,
        totalRevenue: roomRevenue.total,
        staffRevenue: roomRevenue.staff,
        projectedRevenue,
        utilizationRate: `${utilization}%`,
        trend,
        peakDays,
        predictedNextWeek,
        predictionConfidence,
        predictionMethod: methodUsed   // exposed so the UI can show how the value was derived
    };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * Computes the summary block (total, most popular room, peak hours, avg pax).
 *
 * @param {object[]} allData      All reservation records in scope
 * @param {Object<string,string>} roomNames
 * @returns {object}
 */
function computeSummary(allData, roomNames) {
    const totalAttendees = allData.reduce((s, r) => s + (parseInt(r.attendees) || 0), 0);
    const avgAttendees = allData.length > 0 ? Math.round(totalAttendees / allData.length) : 0;
    const totalRevenue = allData.reduce((sum, r) => sum + calculateReservationRevenue(r), 0);
    const avgRevenuePerReservation = allData.length > 0 ? Math.round(totalRevenue / allData.length) : 0;
    const staffRevenue = allData.reduce((sum, r) => sum + (r.isStaff ? calculateReservationRevenue(r) : 0), 0);

    // Most popular room
    const roomCounts = {};
    allData.forEach(r => { roomCounts[r.roomId] = (roomCounts[r.roomId] || 0) + 1; });
    const mostPopularRoomId = Object.entries(roomCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const mostPopularRoom = roomNames[mostPopularRoomId] || mostPopularRoomId;

    // Peak hours (top 2)
    const hourCounts = {};
    allData.forEach(r => {
        if (!r.startTime) return;
        const h = parseInt(r.startTime.split(':')[0]);
        const label = `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
        hourCounts[label] = (hourCounts[label] || 0) + 1;
    });
    const topHours = Object.entries(hourCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([h]) => h);
    const peakHours = topHours.length >= 2
        ? `${topHours[0]} - ${topHours[1]}`
        : (topHours[0] || 'N/A');

    return {
        totalreservations: allData.length,
        mostPopularRoom,
        peakHours,
        averageAttendees: avgAttendees,
        totalRevenue,
        averageRevenuePerReservation: avgRevenuePerReservation,
        staffRevenue
    };
}

// ─── Recommendations ──────────────────────────────────────────────────────────

/**
 * Generates recommendation messages from room analytics.
 *
 * @param {object[]} roomAnalytics  Array returned by computeRoomAnalytics calls
 * @returns {{ priority: string, message: string }[]}
 */
function computeRecommendations(roomAnalytics) {
    return roomAnalytics.map(r => {
        const util = parseInt(r.utilizationRate);
        if (util >= 70) {
            return {
                priority: 'high',
                message: `${r.roomName} is at ${r.utilizationRate} utilization. Consider adding more time slots during peak hours.`
            };
        }
        if (util >= 40) {
            return {
                priority: 'medium',
                message: `${r.roomName} usage is steady at ${r.utilizationRate}. Promote group packages to increase weekday bookings.`
            };
        }
        return {
            priority: 'low',
            message: `${r.roomName} utilization is low at ${r.utilizationRate}. Consider promotional campaigns to boost bookings.`
        };
    });
}

// ─── Monthly trend buckets ────────────────────────────────────────────────────

/**
 * Groups reservation data into monthly buckets for the weeklyTrends chart.
 *
 * @param {object[]} allData
 * @param {string[]} roomIds
 * @param {number}   [sliceLastN]  Only keep the last N months (default: all)
 * @returns {object[]}
 */
function computeMonthlyTrends(allData, roomIds, sliceLastN) {
    const monthBuckets = {};
    allData.forEach(r => {
        const d = new Date(r.date);
        const key = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        if (!monthBuckets[key]) {
            const entry = { week: key, totalreservations: 0 };
            roomIds.forEach(id => { entry[id] = 0; });
            monthBuckets[key] = entry;
        }
        monthBuckets[key].totalreservations++;
        if (roomIds.includes(r.roomId)) monthBuckets[key][r.roomId]++;
    });

    const sorted = Object.values(monthBuckets)
        .sort((a, b) => new Date(a.week) - new Date(b.week));

    return sliceLastN != null ? sorted.slice(-sliceLastN) : sorted;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    computeRoomAnalytics,
    computeSummary,
    computeRecommendations,
    computeMonthlyTrends
};
