import { state, setSelectedFacility } from "../core/state.js";
import { FacilityList } from "./FacilityListComponent.js";

const TIER_COLORS = {
  High: "#dc2626",
  Moderate: "#d97706",
  Low: "#059669",
};
const MICRO_TIER_COLORS = {
  High: "#166534",
  Moderate: "#4ade80",
  Low: "#dcfce7",
};
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

function getMicroScore(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : 0;
}

function getMicroDemandTier(slot) {
  const status = String(slot?.slot_status ?? "").trim().toLowerCase();
  if (status === "busy" || status === "high") return "High";
  if (status === "moderate") return "Moderate";
  if (status === "available" || status === "low") return "Low";

  const score = getMicroScore(slot?.moving_avg_score);
  if (score >= 0.75) return "High";
  if (score >= 0.35) return "Moderate";
  return "Low";
}

function getMicroHeatmapColor(slot) {
  return MICRO_TIER_COLORS[getMicroDemandTier(slot)];
}

function todayAsDateString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getCurrentWeekRange() {
  const [year, month, day] = todayAsDateString().split("-").map(Number);
  const sunday = new Date(Date.UTC(year, month - 1, day));
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  const format = (date, options) => date.toLocaleDateString("en-US", {
    ...options,
    timeZone: "Asia/Manila",
  });

  if (sunday.getUTCFullYear() !== saturday.getUTCFullYear()) {
    return `${format(sunday, { month: "short", day: "numeric", year: "numeric" })}-${format(saturday, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (sunday.getUTCMonth() !== saturday.getUTCMonth()) {
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
  return `${periodKey}${dateRange ? ` (${dateRange})` : ""}`;
}

function getMacroAdvice(item) {
  if (item?.isObserved === true) {
    return "This completed week is based on recorded reservation and event activity.";
  }
  switch (item?.demand_tier) {
    case "High":
      return "High demand is expected. Submit your reservation early and consider alternate dates.";
    case "Moderate":
      return "Moderate demand is expected. Plan ahead and check availability before finalizing.";
    default:
      return "Low demand is expected. Check availability and submit your request when ready.";
  }
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
    this.selectedMacroPeriodKey = null;
    this.facilityRequestId = 0;
    this.loadedFacilityId = this.selectedFacilityId;
    this.referenceDateTimer = window.setInterval(() => {
      if (this.updateReferenceDate()) this.render();
    }, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.updateReferenceDate()) this.render();
    });
  }

  updateReferenceDate() {
    const referenceDate = todayAsDateString();
    if (referenceDate === this.referenceDate) return false;
    this.referenceDate = referenceDate;
    this.macroOffset = 0;
    this.selectedMacroPeriodKey = null;
    return true;
  }

  async render() {
    if (!this.container) return;
    this.updateReferenceDate();
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
    this.loadedFacilityId = facility.id;
    const appFacility = state.facilities.find(({ id }) => id === facility.id);
    if (appFacility && state.selectedFacility?.id !== appFacility.id) {
      new FacilityList().selectFacility(appFacility);
    } else if (appFacility) {
      setSelectedFacility(appFacility);
    }
    const visibleMacro = macro.slice(this.macroOffset, this.macroOffset + 12);
    const selectedMacro = visibleMacro.find(
      ({ periodKey }) => periodKey === this.selectedMacroPeriodKey,
    ) || visibleMacro.find(
      ({ startDate, endDate }) => startDate <= this.referenceDate && endDate >= this.referenceDate,
    ) || visibleMacro[0];
    this.selectedMacroPeriodKey = selectedMacro?.periodKey ?? null;
    this.container.innerHTML = `
      <div class="user-forecast">
        <section class="user-forecast-card">
          <div class="forecast-facility-toolbar" aria-label="Select facility">
            ${facilities.map((item) => `
              <button type="button"
                class="forecast-facility-button${item.id === facility.id ? " active" : ""}"
                data-facility-id="${escapeHtml(item.id)}"
                aria-pressed="${item.id === facility.id ? "true" : "false"}">
                ${escapeHtml(item.name)}
              </button>
            `).join("")}
          </div>
          <div class="macro-card-heading">
            <h3>12-Month Usage Forecast (Month &amp; Week)</h3>
          </div>
          ${this.getMacroLayoutHtml(facility, macro)}
        </section>

        <section class="user-forecast-card">
          <div class="forecast-facility-toolbar micro-facility-toolbar" aria-label="Select facility for weekly hourly demand">
            ${facilities.map((item) => `
              <button type="button"
                class="forecast-facility-button${item.id === facility.id ? " active" : ""}"
                data-facility-id="${escapeHtml(item.id)}"
                aria-pressed="${item.id === facility.id ? "true" : "false"}">
                ${escapeHtml(item.name)}
              </button>
            `).join("")}
          </div>
          <div class="forecast-step-heading">
            <div><h3>Weekly Hourly Demand Guide (${escapeHtml(getCurrentWeekRange())})</h3><p>Estimated busy hours for the ${escapeHtml(facility.name)} based on bookings from the past 4 weeks.</p></div>
          </div>
          <div class="forecast-legend">
            <span><i class="slot-dot busy" style="background:${MICRO_TIER_COLORS.High}"></i>High demand</span>
            <span><i class="slot-dot moderate" style="background:${MICRO_TIER_COLORS.Moderate}"></i>Moderate demand</span>
            <span><i class="slot-dot available" style="background:${MICRO_TIER_COLORS.Low}"></i>Low demand</span>
          </div>
          <div class="micro-forecast-wrap">
            <table class="micro-forecast-table">
              <thead><tr><th>Time</th>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<th>${day}</th>`).join("")}</tr></thead>
              <tbody>${microRows.map((row) => `
                <tr><th>${formatHour(row[0].hour)}</th>
                  ${row.map((slot) => {
                    const demand = getMicroDemandTier(slot);
                    return `<td><span class="micro-slot ${slot.slot_status.toLowerCase()}" style="--micro-slot-color: ${getMicroHeatmapColor(slot)}" aria-label="${slot.day}(${formatHour(slot.hour)}): ${demand.toLowerCase()} demand" title="${slot.day}(${formatHour(slot.hour)}): ${demand.toLowerCase()} demand"></span></td>`;
                  }).join("")}
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="forecast-policy-card" aria-label="Forecast notice">
          <p class="forecast-policy-note">Note: Forecasts are a general guide only. Actual availability depends on real-time bookings and school events.</p>
        </section>
      </div>`;

    this.bindEvents();
  }

  getMacroLayoutHtml(facility, macro) {
    const visibleMacro = macro.slice(this.macroOffset, this.macroOffset + 12);
    const monthLabels = [...new Set(visibleMacro.map((item) => item.monthLabel))];
    const monthRange = monthLabels.length
      ? `${monthLabels[0]} – ${monthLabels[monthLabels.length - 1]}`
      : "12-month outlook";
    const selectedMacro = visibleMacro.find(
      ({ periodKey }) => periodKey === this.selectedMacroPeriodKey,
    ) || visibleMacro.find(
      ({ startDate, endDate }) => startDate <= this.referenceDate && endDate >= this.referenceDate,
    ) || visibleMacro[0];
    this.selectedMacroPeriodKey = selectedMacro?.periodKey ?? null;

    return `
      <div class="macro-forecast-layout">
        <div class="macro-forecast-main">
          <div class="forecast-legend macro-forecast-legend">
            <span><i style="background:${TIER_COLORS.High}"></i>High ≥70%</span>
            <span><i style="background:${TIER_COLORS.Moderate}"></i>Moderate 35–69%</span>
            <span><i style="background:${TIER_COLORS.Low}"></i>Low &lt;35%</span>
            <span><i style="background:#94a3b8"></i>Observed</span>
          </div>
          <div class="macro-forecast-scroll">
            <div class="macro-chart">
              <div class="macro-y-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
              <div class="macro-forecast-grid">
                ${visibleMacro.map((item) => {
                  const observed = item.isObserved === true || item.endDate < this.referenceDate;
                  const value = observed ? (item.observed_pct ?? 0) : item.forecasted_pct;
                  const label = "Forecast";
                  const color = TIER_COLORS[item.demand_tier];
                  const dateRange = getMacroDateRange(item);
                  const selected = item.periodKey === selectedMacro?.periodKey;
                  const barColor = observed ? "#94a3b8" : color;
                  return `
                    <button type="button" class="macro-forecast-bar macro-bar-incoming${observed ? " observed" : ""}${selected ? " selected" : ""}" data-period="${escapeHtml(item.periodKey)}" aria-pressed="${selected}" aria-label="${escapeHtml(item.periodKey)} ${escapeHtml(dateRange)}: ${observed ? "observed" : `${value}%`}" title="${escapeHtml(item.periodKey)} (${escapeHtml(dateRange)}) — ${observed ? "Observed" : `${label}: ${value}%`} — ${escapeHtml(item.anchor_event_note)}">
                      <span class="macro-bar macro-bar-single" style="height:${Math.max(4, value)}%;background:${barColor}" aria-label="${observed ? "Observed" : `${label} ${value}%`}"></span>
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
        </div>
        <aside class="macro-summary-panel">
          ${(() => {
            const selectedObserved = selectedMacro?.isObserved === true ||
              (selectedMacro?.endDate && selectedMacro.endDate < this.referenceDate);
            const selectedValue = selectedObserved
              ? (selectedMacro?.observed_pct ?? 0)
              : (selectedMacro?.forecasted_pct ?? 0);
            return `
          <h4>${selectedObserved ? "Observed utilization" : "Utilization Forecast"} for ${escapeHtml(facility.name)}</h4>
          <div class="macro-insight macro-insight-inline">
            <strong class="macro-insight-title">${escapeHtml(selectedMacro ? formatMacroPeriod(selectedMacro) : "Weekly outlook")}</strong>
            <div class="macro-insight-demand-line">
              <span class="macro-insight-value">${selectedValue}%</span>
              <span class="macro-insight-tier">${selectedObserved ? "Observed" : "Demand"}</span>
            </div>
            <p class="forecast-selection-note">${escapeHtml(getMacroAdvice(selectedMacro))}</p>
          </div>`;
          })()}
        </aside>
      </div>`;
  }

  refreshMacroForecast(facility) {
    const layout = this.container.querySelector(".user-forecast-card .macro-forecast-layout");
    if (!layout) return;
    layout.outerHTML = this.getMacroLayoutHtml(facility, this.forecast.macro);
    this.bindEvents();
  }

  bindEvents() {
    const loadSelectedFacility = async (facilityId) => {
      if (!facilityId) return;
      this.updateReferenceDate();
      const requestId = ++this.facilityRequestId;
      this.selectedFacilityId = facilityId;
      this.macroOffset = 0;
      this.selectedMacroPeriodKey = null;

      this.container.querySelectorAll(".forecast-facility-button").forEach((facilityButton) => {
        const active = facilityButton.dataset.facilityId === facilityId;
        facilityButton.classList.toggle("active", active);
        facilityButton.setAttribute("aria-pressed", active ? "true" : "false");
      });

      const layout = this.container.querySelector(".macro-forecast-layout");
      if (layout) {
        layout.setAttribute("aria-busy", "true");
        layout.classList.add("macro-loading");
      }

      try {
        const params = new URLSearchParams({
          facilityId,
          referenceDate: this.referenceDate,
        });
        const response = await fetch(`/api/forecast/user?${params}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload.forecast) {
          throw new Error(payload.message || `Forecast API returned ${response.status}.`);
        }

        if (requestId !== this.facilityRequestId) return;
        this.forecast = payload.forecast;
        const facility = this.forecast.facilities.find(({ id }) => id === facilityId) || this.forecast.facilities[0];
        const appFacility = facility ? state.facilities.find(({ id }) => id === facility.id) : null;
        if (appFacility) setSelectedFacility(appFacility);
        this.renderForecast();
      } catch (error) {
        if (requestId !== this.facilityRequestId) return;
        console.error("Could not load the selected facility forecast:", error);
        this.selectedFacilityId = this.loadedFacilityId;
        this.container.querySelectorAll(".forecast-facility-button").forEach((facilityButton) => {
          const active = facilityButton.dataset.facilityId === this.loadedFacilityId;
          facilityButton.classList.toggle("active", active);
          facilityButton.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (layout) {
          layout.removeAttribute("aria-busy");
          layout.classList.remove("macro-loading");
        }
      }
    };

    const previousButton = this.container.querySelector(".macro-nav-previous");
    if (previousButton && previousButton.dataset.bound !== "true") {
      previousButton.dataset.bound = "true";
      previousButton.addEventListener("click", () => {
      this.macroOffset = Math.max(0, this.macroOffset - 12);
      const facility = this.forecast.facilities.find(({ id }) => id === this.selectedFacilityId) || this.forecast.facilities[0];
      this.refreshMacroForecast(facility);
      });
    }
    const nextButton = this.container.querySelector(".macro-nav-next");
    if (nextButton && nextButton.dataset.bound !== "true") {
      nextButton.dataset.bound = "true";
      nextButton.addEventListener("click", () => {
      this.macroOffset = Math.min(this.forecast.macro.length - 12, this.macroOffset + 12);
      const facility = this.forecast.facilities.find(({ id }) => id === this.selectedFacilityId) || this.forecast.facilities[0];
      this.refreshMacroForecast(facility);
      });
    }
    this.container.querySelectorAll(".forecast-facility-button").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => loadSelectedFacility(button.dataset.facilityId));
    });
    this.container.querySelectorAll(".macro-forecast-bar").forEach((bar) => {
      bar.addEventListener("click", () => {
        const item = this.forecast.macro.find(({ periodKey }) => periodKey === bar.dataset.period);
        const heading = this.container.querySelector(".macro-summary-panel h4");
        const title = this.container.querySelector(".macro-insight-title");
        const value = this.container.querySelector(".macro-insight-value");
        const tier = this.container.querySelector(".macro-insight-tier");
        const note = this.container.querySelector(".forecast-selection-note");
        if (item && title && value && tier && note) {
          this.selectedMacroPeriodKey = item.periodKey;
          this.container.querySelectorAll(".macro-forecast-bar").forEach((forecastBar) => {
            const selected = forecastBar === bar;
            forecastBar.classList.toggle("selected", selected);
            forecastBar.setAttribute("aria-pressed", String(selected));
          });
          title.textContent = formatMacroPeriod(item);
          const observed = item.isObserved === true || item.endDate < this.referenceDate;
          const observedItem = observed ? { ...item, isObserved: true } : item;
          value.textContent = `${observed ? (item.observed_pct ?? 0) : item.forecasted_pct}%`;
          tier.textContent = observed ? "Observed" : "Demand";
          note.textContent = getMacroAdvice(observedItem);
          if (heading) {
            const facility = this.forecast.facilities.find(({ id }) => id === this.selectedFacilityId) || this.forecast.facilities[0];
            heading.textContent = `${observed ? "Observed utilization" : "Utilization Forecast"} for ${facility?.name || "Facility"}`;
          }
        }
      });
    });
  }
}
