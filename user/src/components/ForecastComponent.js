import { state, setSelectedFacility } from "../core/state.js";
import { FacilityList } from "./FacilityListComponent.js";

const TIER_COLORS = {
  High: "#dc2626",
  Moderate: "#d97706",
  Low: "#059669",
};
const MICRO_HEATMAP_STOPS = [
  { threshold: 0, color: TIER_COLORS.Low },
  { threshold: 0.35, color: TIER_COLORS.Moderate },
  { threshold: 0.7, color: TIER_COLORS.High },
];
const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MICRO_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function formatHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}:00 ${suffix}`;
}

function getMicroHeatmapColor(value) {
  const numericValue = Number(value);
  const score = Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : 0;

  for (let index = 1; index < MICRO_HEATMAP_STOPS.length; index++) {
    const upper = MICRO_HEATMAP_STOPS[index];
    if (score <= upper.threshold) {
      const lower = MICRO_HEATMAP_STOPS[index - 1];
      const ratio =
        (score - lower.threshold) / (upper.threshold - lower.threshold);
      const start = lower.color.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
      const end = upper.color.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
      const channels = start.map((channel, channelIndex) =>
        Math.round(channel + (end[channelIndex] - channel) * ratio),
      );
      return `rgb(${channels.join(", ")})`;
    }
  }

  return MICRO_HEATMAP_STOPS[MICRO_HEATMAP_STOPS.length - 1].color;
}

function todayAsDateString() {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function getCurrentWeekRange() {
  const sunday = new Date();
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const format = (date, options) => date.toLocaleDateString("en-US", options);

  if (sunday.getFullYear() !== saturday.getFullYear()) {
    return `${format(sunday, { month: "short", day: "numeric", year: "numeric" })}-${format(saturday, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (sunday.getMonth() !== saturday.getMonth()) {
    return `${format(sunday, { month: "short", day: "numeric" })}-${format(saturday, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return `${format(sunday, { month: "short" })} ${sunday.getDate()}-${saturday.getDate()}, ${saturday.getFullYear()}`;
}

function getMacroDateRange(item) {
  const match = String(item.periodKey || "").match(/^([A-Za-z]{3})\s+(\d{4})\s+W([1-4])$/);
  if (!match) return item.dateRange || "";

  const [, month, year, week] = match;
  const monthIndex = MONTH_ABBREVIATIONS.indexOf(month);
  if (monthIndex < 0) return item.dateRange || "";
  const start = new Date(Date.UTC(Number(year), monthIndex, 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + (Number(week) - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startMonth = MONTH_ABBREVIATIONS[start.getUTCMonth()];
  const endMonth = MONTH_ABBREVIATIONS[end.getUTCMonth()];
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

export function formatMacroPeriod(item) {
  const periodKey = item.periodKey || "Weekly outlook";
  const dateRange = getMacroDateRange(item);
  return `${periodKey}${dateRange ? `(${dateRange})` : ""}`;
}

export function normalizeMicroRows(micro) {
  const slotsByHourAndDay = new Map();
  for (const row of micro || []) {
    for (const slot of row || []) {
      const dayIndex = MICRO_DAYS.indexOf(slot.day);
      if (dayIndex < 0 || !Number.isInteger(slot.hour)) continue;
      slotsByHourAndDay.set(`${slot.hour}:${dayIndex}`, slot);
    }
  }

  return Array.from({ length: 11 }, (_, index) => {
    const hour = index + 7;
    return MICRO_DAYS.map((day, dayIndex) => slotsByHourAndDay.get(`${hour}:${dayIndex}`) || ({
      day,
      dayIndex,
      hour,
      label: `${String(hour).padStart(2, "0")}:00 - ${String(hour + 1).padStart(2, "0")}:00`,
      moving_avg_score: 0,
      slot_status: "Available",
    }));
  });
}

export class Forecast {
  constructor(container = "forecast-container") {
    this.container = typeof container === "string"
      ? document.getElementById(container)
      : container;
    this.selectedFacilityId = state.selectedFacility?.id || "auditorium";
    this.referenceDate = todayAsDateString();
    this.forecast = null;
    this.macroOffset = 0;
  }

  async render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="forecast-loading" role="status">
        <div class="spinner"></div>
        <p>Loading facility booking guidance...</p>
      </div>`;
    try {
      const params = new URLSearchParams({
        facilityId: this.selectedFacilityId,
        referenceDate: this.referenceDate,
      });
      const response = await fetch(`/api/forecast/user?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.forecast) {
        throw new Error(payload.message || `Forecast API returned ${response.status}.`);
      }
      this.forecast = payload.forecast;
      this.renderForecast();
    } catch (error) {
      console.error("Could not load facility booking forecast:", error);
      this.container.innerHTML = `
        <section class="forecast-error" role="alert">
          <h2>Forecast unavailable</h2>
          <p>We could not load current booking guidance. Please try again.</p>
          <button type="button" class="forecast-retry">Try again</button>
        </section>`;
      this.container.querySelector(".forecast-retry")?.addEventListener("click", () => this.render());
    }
  }

  renderForecast() {
    const { facilities, macro, micro } = this.forecast;
    const microRows = normalizeMicroRows(micro);
    const facility = facilities.find(({ id }) => id === this.selectedFacilityId) || facilities[0];
    this.selectedFacilityId = facility.id;
    const appFacility = state.facilities.find(({ id }) => id === facility.id);
    if (appFacility && state.selectedFacility?.id !== appFacility.id) {
      new FacilityList().selectFacility(appFacility);
    } else if (appFacility) {
      setSelectedFacility(appFacility);
    }
    const visibleMacro = macro.slice(this.macroOffset, this.macroOffset + 12);
    const monthLabels = [...new Set(visibleMacro.map((item) => item.monthLabel))];
    const monthRange = monthLabels.length
      ? `${monthLabels[0]} – ${monthLabels[monthLabels.length - 1]}`
      : "12-month outlook";
    const selectedMacro = visibleMacro[0];
    this.container.innerHTML = `
      <div class="user-forecast">
        <div class="forecast-facility-toolbar">
          <label class="macro-facility-control">Facility
            <select class="forecast-facility-select">
              ${facilities.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === facility.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <section class="user-forecast-card">
          <div class="macro-card-heading">
            <h3>12-Month Usage Forecast (Month &amp; Week)</h3>
          </div>
          <div class="macro-forecast-layout">
            <div class="macro-forecast-main">
              <div class="macro-forecast-scroll">
                <div class="macro-chart">
                  <div class="macro-y-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
                  <div class="macro-forecast-grid">
                  ${visibleMacro.map((item) => {
                    const value = item.forecasted_pct;
                    const label = "Forecast";
                    const color = TIER_COLORS[item.demand_tier];
                    const dateRange = getMacroDateRange(item);
                    return `
                      <button type="button" class="macro-forecast-bar macro-bar-incoming" data-period="${escapeHtml(item.periodKey)}" aria-label="${escapeHtml(item.periodKey)} ${escapeHtml(dateRange)}: ${value}%" title="${escapeHtml(item.periodKey)} (${escapeHtml(dateRange)}) — ${label}: ${value}% — ${escapeHtml(item.anchor_event_note)}">
                        <span class="macro-bar-value">${value}%</span>
                        <span class="macro-bar macro-bar-single" style="height:${Math.max(4, value)}%;background:${color}" aria-label="${label} ${value}%"></span>
                        <span class="macro-bar-label">${escapeHtml(item.week)}</span>
                      </button>`;
                  }).join("")}
                  </div>
                  <div class="macro-month-labels">
                    ${monthLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
                  </div>
                </div>
              </div>
              <div class="macro-forecast-toolbar">
                <button type="button" class="macro-nav-button macro-nav-previous" aria-label="Show previous three months" ${this.macroOffset === 0 ? "disabled" : ""}>&lt;</button>
                <strong>${escapeHtml(monthRange)}</strong>
                <button type="button" class="macro-nav-button macro-nav-next" aria-label="Show next three months" ${this.macroOffset + 12 >= macro.length ? "disabled" : ""}>&gt;</button>
              </div>
              <div class="forecast-legend">
                <span><i style="background:${TIER_COLORS.High}"></i>High ≥70%</span>
                <span><i style="background:${TIER_COLORS.Moderate}"></i>Moderate 35–69%</span>
                <span><i style="background:${TIER_COLORS.Low}"></i>Low &lt;35%</span>
              </div>
            </div>
            <aside class="macro-summary-panel">
              <h4>12-month forecast for ${escapeHtml(facility.name)}</h4>
              <p>Projected utilization based on historical activity, live bookings, and seasonal guidance.</p>
              <div class="macro-insight macro-insight-inline">
                <strong class="macro-insight-title">${escapeHtml(selectedMacro ? formatMacroPeriod(selectedMacro) : "Weekly outlook")}</strong>
                <span class="macro-insight-value">${selectedMacro?.forecasted_pct ?? 0}%</span>
                <p class="forecast-selection-note">${escapeHtml(selectedMacro?.anchor_event_note || "Select a bar to see its demand driver.")}</p>
              </div>
            </aside>
          </div>
        </section>

        <section class="user-forecast-card">
          <div class="forecast-step-heading">
            <div><h3>Weekly Hourly Demand Guide (${escapeHtml(getCurrentWeekRange())})</h3><p>Estimated busy hours for the ${escapeHtml(facility.name)} based on bookings from the past 4 weeks.</p></div>
          </div>
          <div class="forecast-legend">
            <span><i class="slot-dot available"></i>Lower demand</span>
            <span><i class="slot-dot moderate"></i>Moderate demand</span>
            <span><i class="slot-dot busy"></i>Higher demand</span>
          </div>
          <div class="micro-forecast-wrap">
            <table class="micro-forecast-table">
              <thead><tr><th>Time</th>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<th>${day}</th>`).join("")}</tr></thead>
              <tbody>${microRows.map((row) => `
                <tr><th>${formatHour(row[0].hour)}</th>
                  ${row.map((slot) => `<td><span class="micro-slot ${slot.slot_status.toLowerCase()}" style="--micro-slot-color: ${getMicroHeatmapColor(slot.moving_avg_score)}" aria-label="${slot.day} ${formatHour(slot.hour)}: ${slot.slot_status.toLowerCase()} demand" title="${slot.day} ${formatHour(slot.hour)}: ${slot.slot_status.toLowerCase()} demand"></span></td>`).join("")}
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="forecast-policy-note">Forecasts are guidance; actual bookings and school events determine availability.</p>
        </section>
      </div>`;

    this.bindEvents();
  }

  bindEvents() {
    this.container.querySelector(".macro-nav-previous")?.addEventListener("click", () => {
      this.macroOffset = Math.max(0, this.macroOffset - 12);
      this.renderForecast();
    });
    this.container.querySelector(".macro-nav-next")?.addEventListener("click", () => {
      this.macroOffset = Math.min(this.forecast.macro.length - 12, this.macroOffset + 12);
      this.renderForecast();
    });
    this.container.querySelector(".forecast-facility-select")?.addEventListener("change", (event) => {
      this.selectedFacilityId = event.target.value;
      this.macroOffset = 0;
      this.render();
    });
    this.container.querySelectorAll(".macro-forecast-bar").forEach((bar) => {
      bar.addEventListener("click", () => {
        const item = this.forecast.macro.find(({ periodKey }) => periodKey === bar.dataset.period);
        const title = this.container.querySelector(".macro-insight-title");
        const value = this.container.querySelector(".macro-insight-value");
        const note = this.container.querySelector(".forecast-selection-note");
        if (item && title && value && note) {
          title.textContent = formatMacroPeriod(item);
          value.textContent = `${item.forecasted_pct}%`;
          note.textContent = item.anchor_event_note;
        }
      });
    });
  }
}
