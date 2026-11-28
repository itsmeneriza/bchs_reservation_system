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
const MACRO_MONTHS_PER_PAGE = 3;

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

export function getVisibleMacroPeriods(macro, monthOffset) {
  const monthLabels = [...new Set(macro.map((item) => item.monthLabel))];
  const visibleMonthLabels = new Set(
    monthLabels.slice(monthOffset, monthOffset + MACRO_MONTHS_PER_PAGE),
  );
  return macro.filter((item) => visibleMonthLabels.has(item.monthLabel));
}

function getMacroDateRange(item) {
  if (item.dateRange) return item.dateRange;
  const match = String(item.periodKey || "").match(/^([A-Za-z]{3})\s+(\d{4})\s+W([1-5])$/);
  if (!match) return item.dateRange || "";

  const [, month, year, week] = match;
  const monthIndex = MONTH_ABBREVIATIONS.indexOf(month);
  if (monthIndex < 0) return item.dateRange || "";
  const start = new Date(Date.UTC(Number(year), monthIndex, 1));
  const firstWednesdayOffset = (3 - start.getUTCDay() + 7) % 7;
  start.setUTCDate(1 + firstWednesdayOffset + (Number(week) - 1) * 7 - 3);
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
    return "This percentage shows the facility's recorded utilization for the completed period.";
  }
  switch (item?.demand_tier) {
    case "High":
      return "High utilization is forecasted. Review staffing, resources, and availability for this period.";
    case "Moderate":
      return "Moderate utilization is forecasted. Monitor bookings and adjust resources as needed.";
    default:
      return "Low utilization is forecasted. Consider scheduling maintenance or promoting availability.";
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

export class FacilityForecast {
  constructor(container = "forecast-container") {
    this.container = typeof container === "string"
      ? document.getElementById(container)
      : container;
    this.selectedFacilityId = "auditorium";
    this.referenceDate = todayAsDateString();
    this.forecast = null;
    this.macroMonthOffset = 0;
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
    this.macroMonthOffset = 0;
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
      const response = await window.adminFetch(`/api/forecast/admin/facility?${params}`, {
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
          <p>We could not load facility booking guidance. Please try again.</p>
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
    const visibleMacro = getVisibleMacroPeriods(macro, this.macroMonthOffset);
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

        <section class="user-forecast-card micro-demand-card">
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
      </div>`;

    this.bindEvents();
  }

  getMacroLayoutHtml(facility, macro) {
    const visibleMacro = getVisibleMacroPeriods(macro, this.macroMonthOffset);
    const monthLabels = [...new Set(visibleMacro.map((item) => item.monthLabel))];
    const totalMonths = new Set(macro.map((item) => item.monthLabel)).size;
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
              <div class="macro-forecast-grid" style="--macro-week-count:${visibleMacro.length}">
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
            <button type="button" class="macro-nav-button macro-nav-previous" aria-label="Show previous three months" ${this.macroMonthOffset === 0 ? "disabled" : ""}>&lt;</button>
            <strong>${escapeHtml(monthRange)}</strong>
            <button type="button" class="macro-nav-button macro-nav-next" aria-label="Show next three months" ${this.macroMonthOffset + MACRO_MONTHS_PER_PAGE >= totalMonths ? "disabled" : ""}>&gt;</button>
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
      this.macroMonthOffset = 0;
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
        const response = await window.adminFetch(`/api/forecast/admin/facility?${params}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload.forecast) {
          throw new Error(payload.message || `Forecast API returned ${response.status}.`);
        }

        if (requestId !== this.facilityRequestId) return;
        this.forecast = payload.forecast;
        const facility = this.forecast.facilities.find(({ id }) => id === facilityId) || this.forecast.facilities[0];
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
      this.macroMonthOffset = Math.max(0, this.macroMonthOffset - MACRO_MONTHS_PER_PAGE);
      const facility = this.forecast.facilities.find(({ id }) => id === this.selectedFacilityId) || this.forecast.facilities[0];
      this.refreshMacroForecast(facility);
      });
    }
    const nextButton = this.container.querySelector(".macro-nav-next");
    if (nextButton && nextButton.dataset.bound !== "true") {
      nextButton.dataset.bound = "true";
      nextButton.addEventListener("click", () => {
      const totalMonths = new Set(this.forecast.macro.map((item) => item.monthLabel)).size;
      this.macroMonthOffset = Math.min(
        Math.max(0, totalMonths - MACRO_MONTHS_PER_PAGE),
        this.macroMonthOffset + MACRO_MONTHS_PER_PAGE,
      );
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
        const note = this.container.querySelector(".forecast-selection-note");
        if (item && title && value && note) {
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


/* Analytics forecast dashboard */
/**
 * Forecast Component
 * AI-powered analytics and predictions with year-over-year comparison
 */

export class AnalyticsForecast {
  constructor(container = "forecast-container") {
    this.container =
      typeof container === "string"
        ? document.getElementById(container)
        : container;
    this.includeRevenue = true;
    this.lastYearData = null;
    this.currentYearData = null;
    this._cachedForecast = null;
    this.yoyFacilitySelection = "all";
    this.busyPatternSelection = "all";
    this.facilityActivitySelection = null;
  }

  async loadData() {
    try {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;
      const response = await window.adminFetch("/api/requests");
      if (!response.ok) {
        throw new Error(`Requests API returned ${response.status}.`);
      }
      const data = await response.json();
      const requests = data.requests;
      if (!Array.isArray(requests)) {
        throw new Error("Requests API returned an invalid reservation list.");
      }
      const approved = requests.filter(
        (reservation) =>
          reservation.date &&
          ["approved", "accepted"].includes(reservation.status),
      );

      this.lastYearData = approved.filter(
        (r) => new Date(r.date).getFullYear() === lastYear,
      );
      this.currentYearData = approved.filter(
        (r) => new Date(r.date).getFullYear() === currentYear,
      );
    } catch (e) {
      console.error("Failed to load reservation data", e);
    }
  }

  // Kept for backward compatibility — delegates to loadData()
  async loadLastYearData() {
    await this.loadData();
  }
  async loadCurrentYearData() {
    /* already loaded by loadData() */
  }

  fetchForecast() {
    return window.adminFetch("/api/forecast/admin");
  }

  formatCurrency(amount) {
    return `₱${(Number(amount) || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  calculateYearStats(records, targetYear) {
    if (!records || records.length === 0) {
      return null;
    }

    const filtered = records.filter((r) => {
      if (!r.date) return false;
      if (targetYear && new Date(r.date).getFullYear() !== targetYear)
        return false;
      return r.status === "approved" || !r.status;
    });

    if (filtered.length === 0) return null;

    const stats = {
      totalreservations: filtered.length,
      byFacility: {},
      byMonth: {},
      byDayOfWeek: {},
      totalAttendees: 0,
      averageAttendees: 0,
    };

    filtered.forEach((reservation) => {
      if (!stats.byFacility[reservation.facilityId]) {
        stats.byFacility[reservation.facilityId] = {
          count: 0,
          attendees: 0,
        };
      }
      stats.byFacility[reservation.facilityId].count++;
      stats.byFacility[reservation.facilityId].attendees +=
        reservation.attendees || 0;

      const month = new Date(reservation.date).toLocaleString("default", {
        month: "long",
      });
      if (!stats.byMonth[month]) {
        stats.byMonth[month] = 0;
      }
      stats.byMonth[month]++;

      const dayOfWeek = new Date(reservation.date).toLocaleString("default", {
        weekday: "long",
      });
      if (!stats.byDayOfWeek[dayOfWeek]) {
        stats.byDayOfWeek[dayOfWeek] = 0;
      }
      stats.byDayOfWeek[dayOfWeek]++;

      stats.totalAttendees += reservation.attendees || 0;
    });

    stats.averageAttendees = Math.round(
      stats.totalAttendees / stats.totalreservations,
    );

    let maxCount = 0;
    let mostPopular = "";
    Object.keys(stats.byFacility).forEach((facilityId) => {
      if (stats.byFacility[facilityId].count > maxCount) {
        maxCount = stats.byFacility[facilityId].count;
        mostPopular = facilityId;
      }
    });
    stats.mostPopularFacility = this.getFacilityName(mostPopular);

    let maxMonthCount = 0;
    let busiestMonth = "";
    Object.keys(stats.byMonth).forEach((month) => {
      if (stats.byMonth[month] > maxMonthCount) {
        maxMonthCount = stats.byMonth[month];
        busiestMonth = month;
      }
    });
    stats.busiestMonth = busiestMonth;
    stats.busiestMonthCount = maxMonthCount;

    let maxDayCount = 0;
    let busiestDay = "";
    Object.keys(stats.byDayOfWeek).forEach((day) => {
      if (stats.byDayOfWeek[day] > maxDayCount) {
        maxDayCount = stats.byDayOfWeek[day];
        busiestDay = day;
      }
    });
    stats.busiestDayOfWeek = busiestDay;
    stats.busiestDayCount = maxDayCount;

    return stats;
  }

  calculateLastYearStats(targetYear) {
    return this.calculateYearStats(this.lastYearData, targetYear);
  }

  calculateCurrentYearStats(targetYear) {
    return this.calculateYearStats(this.currentYearData, targetYear);
  }

  calculateComparison(currentStats, lastYearStats) {
    if (!lastYearStats || !currentStats) return null;

    const comparison = {
      totalChange:
        currentStats.totalreservations - lastYearStats.totalreservations,
      totalChangePercent:
        lastYearStats.totalreservations > 0
          ? Math.round(
              ((currentStats.totalreservations -
                lastYearStats.totalreservations) /
                lastYearStats.totalreservations) *
                100,
            )
          : 0,
      attendeesChange:
        currentStats.averageAttendees - lastYearStats.averageAttendees,
      attendeesChangePercent:
        lastYearStats.averageAttendees > 0
          ? Math.round(
              ((currentStats.averageAttendees -
                lastYearStats.averageAttendees) /
                lastYearStats.averageAttendees) *
                100,
            )
          : 0,
      facilityComparisons: {},
    };

    const currentFacilityAnalytics = Array.isArray(currentStats.facilityAnalytics)
      ? currentStats.facilityAnalytics
      : Object.keys(currentStats.byFacility || {}).map((facilityId) => ({
          facilityId,
          totalreservations: currentStats.byFacility[facilityId].count,
        }));

    currentFacilityAnalytics.forEach((item) => {
      const facilityId = item.facilityId;
      const current = item.totalreservations ?? item.count ?? 0;
      const lastYear = lastYearStats.byFacility[facilityId];

      if (lastYear) {
        comparison.facilityComparisons[facilityId] = {
          change: current - lastYear.count,
          changePercent:
            lastYear.count > 0
              ? Math.round(((current - lastYear.count) / lastYear.count) * 100)
              : 0,
        };
      }
    });

    return comparison;
  }

  bindYoYFilters() {
    const buttons = this.container?.querySelectorAll(".yoy-filter-btn") || [];
    buttons.forEach((btn) => {
      if (btn.dataset.yoyBound === "true") return;
      btn.dataset.yoyBound = "true";
      btn.addEventListener("click", () => {
        const selected = btn.dataset.facility;
        const section = btn.closest(".year-comparison-section");
        const wrap = section?.querySelector(".yoy-chart-wrap");
        if (!wrap) return;

        this.yoyFacilitySelection = selected;
        section.querySelectorAll(".yoy-filter-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });

        const svg = wrap.querySelector(".yoy-svg-chart");
        const isAll = selected === "all";
        const chartWidth = Number(svg?.dataset.chartWidth);
        const padLeft = Number(svg?.dataset.padLeft);
        const padTop = Number(svg?.dataset.padTop);
        const plotHeight = Number(svg?.dataset.plotHeight);
        const facilityLines = [
          ...wrap.querySelectorAll(
            `.yoy-facility-line[data-facility="${selected}"]`,
          ),
        ];
        const facilityValues = facilityLines.flatMap((line) =>
          line.dataset.values.split(",").map(Number),
        );
        const maxValue = isAll
          ? Number(svg?.dataset.allYMax)
          : Math.max(4, Math.ceil(Math.max(...facilityValues) / 4) * 4);

        wrap
          .querySelectorAll(
            ".yoy-series-all, .yoy-series-all-marker, .yoy-series-last, .yoy-series-all-forecast, .yoy-series-all-forecast-marker",
          )
          .forEach((series) => {
            series.style.display = isAll ? "" : "none";
          });
        wrap.querySelectorAll(".yoy-facility-line").forEach((line) => {
          const show = !isAll && line.dataset.facility === selected;
          line.style.display = show ? "inline" : "none";
          if (show && svg && maxValue > 0) {
            const values = line.dataset.values.split(",").map(Number);
            const startIndex = Number(line.dataset.startIndex || 0);
            const endIndex = line.dataset.endIndex
              ? Number(line.dataset.endIndex)
              : startIndex + values.length - 1;
            const plotWidth =
              chartWidth - padLeft - Number(svg.dataset.padRight);
            const points = values
              .slice(0, endIndex - startIndex + 1)
              .map((value, index) => {
                const x =
                  padLeft +
                  ((startIndex + index) * plotWidth) /
                    (Number(svg.dataset.monthCount) - 1);
                const y = padTop + plotHeight - (value / maxValue) * plotHeight;
                return `${x},${y}`;
              })
              .join(" ");
            line.setAttribute("points", points);
          }
        });

        const grid = wrap.querySelector(".yoy-grid");
        grid?.querySelectorAll(".yoy-grid-tick").forEach((tick, index) => {
          const value = (maxValue * index) / 4;
          const y = padTop + plotHeight - (value / maxValue) * plotHeight;
          const line = tick.querySelector("line");
          const label = tick.querySelector("text");
          line?.setAttribute("y1", String(y));
          line?.setAttribute("y2", String(y));
          label?.setAttribute("y", String(y + 4));
          if (label) label.textContent = String(Math.round(value));
        });

        const currentLegend = wrap.querySelector(".yoy-legend-current");
        if (currentLegend) {
          currentLegend.style.display = isAll ? "" : "inline-flex";
          currentLegend.querySelector(".yoy-legend-dot").style.background =
            isAll ? "#0ea5e9" : btn.dataset.color;
          currentLegend.querySelector(".yoy-legend-current-label").textContent =
            isAll
              ? currentLegend.dataset.allLabel
              : `${btn.textContent.trim()} (${currentLegend.dataset.year})`;
        }
        wrap.querySelector(".yoy-legend-last-year").style.display = isAll
          ? ""
          : "none";
        const projectedLegend = wrap.querySelector(".yoy-legend-future-ref");
        if (projectedLegend) {
          const forecastRate = Number(btn.dataset.forecastRate);
          const formattedRate = forecastRate > 0 ? `+${forecastRate}` : forecastRate;
          projectedLegend.querySelector(".yoy-legend-future-dash").style.color =
            isAll ? "#0ea5e9" : btn.dataset.color;
          projectedLegend.querySelector(
            ".yoy-legend-future-label",
          ).textContent = `Projected (${formattedRate}% vs LY YTD)`;
        }
        const facilityLastLegend = wrap.querySelector(
          ".yoy-legend-facility-last",
        );
        if (facilityLastLegend) {
          facilityLastLegend.style.display = isAll ? "none" : "inline-flex";
          facilityLastLegend.querySelector(
            ".yoy-legend-facility-last-label",
          ).textContent =
            `${facilityLastLegend.dataset.year} (${btn.textContent.trim()})`;
        }

        const chart = wrap.querySelector(".yoy-svg-chart");
        if (chart) {
          chart.setAttribute(
            "aria-label",
            isAll
              ? "Year-over-Year monthly reservations line chart for all facilities"
              : `Monthly reservations line chart for ${btn.textContent.trim()}`,
          );
        }
      });
    });
  }

  async render() {
    if (!this.container) return;

    // Fetch history + accepted once; derives both lastYearData and currentYearData
    await this.loadData();

    let forecast = null;
    try {
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve(null), 3000),
      );
      const fetchForecast = this.fetchForecast()
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data?.forecast || null)
        .catch(() => null);

      const result = await Promise.race([fetchForecast, timeout]);
      if (result) {
        forecast = result;
        this._cachedForecast = forecast; // store for fallback
      } else {
        // Timed out — use last cached if available
        forecast = this._cachedForecast || null;
      }
    } catch (e) {
      forecast = this._cachedForecast || null;
    }

    if (!forecast) {
      this.container.innerHTML = `
                <div class="forecast-loading">
                    <div class="spinner"></div>
                    <p>Loading forecast data...</p>
                </div>
            `;
      return;
    }

    const currentYear = new Date().getFullYear();
    const analyzedYear = forecast.analyzedYear || currentYear - 1;
    const baselineYears =
      Array.isArray(forecast.yearsIncluded) && forecast.yearsIncluded.length
        ? forecast.yearsIncluded
        : [analyzedYear];
    const currentYearStats = this.calculateCurrentYearStats(currentYear);
    const lastYearStats = this.calculateLastYearStats(analyzedYear);
    const {
      summary,
      facilityAnalytics,
      weeklyTrends,
      aheadPredictions,
      recommendations,
    } = forecast;
    const comparison = this.calculateComparison(
      {
        ...currentYearStats,
        facilityAnalytics,
        byFacility: currentYearStats ? currentYearStats.byFacility : {},
        averageAttendees: currentYearStats
          ? currentYearStats.averageAttendees
          : summary.averageAttendees || 0,
        totalreservations: currentYearStats
          ? currentYearStats.totalreservations
          : summary.totalreservations || 0,
        mostPopularFacility: currentYearStats
          ? currentYearStats.mostPopularFacility
          : summary.mostPopularFacility || "N/A",
      },
      lastYearStats,
    );

    const currentSummary = currentYearStats || {
      totalreservations: summary.totalreservations || 0,
      averageAttendees: summary.averageAttendees || 0,
      mostPopularFacility: summary.mostPopularFacility || "N/A",
    };
    const showAnalyticsDashboard = this.includeRevenue;

    this.container.innerHTML = `
            ${showAnalyticsDashboard ? `
            <!-- Hero Stats Section -->
            <div class="forecast-hero">
                <div class="hero-header">
                    <div>
                        <h2 class="hero-title">Facility Analytics Dashboard</h2>
                        <p class="forecast-baseline">Forecast baseline: historical data from ${baselineYears.join(" and ")}</p>
                    </div>
                </div>
                
                <div class="hero-stats">
                    <div class="hero-stat-card primary">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.totalreservations}</div>
                            <div class="hero-stat-label">Total Reservations</div>
                            ${comparison ? this.renderChangeIndicator(comparison.totalChange, comparison.totalChangePercent) : ""}
                        </div>
                    </div>
                    <div class="hero-stat-card secondary">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.mostPopularFacility}</div>
                            <div class="hero-stat-label">Most Popular Venue</div>
                        </div>
                    </div>
                    <div class="hero-stat-card accent">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${summary.peakHours}</div>
                            <div class="hero-stat-label">Peak Hours</div>
                        </div>
                    </div>
                    <div class="hero-stat-card success">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${currentSummary.averageAttendees}</div>
                            <div class="hero-stat-label">Avg Attendees</div>
                            ${comparison ? this.renderChangeIndicator(comparison.attendeesChange, comparison.attendeesChangePercent) : ""}
                        </div>
                    </div>
                    <div class="hero-stat-card accent">
                        <div class="hero-stat-icon"></div>
                        <div class="hero-stat-content">
                            <div class="hero-stat-value">${this.formatCurrency(summary.averageRevenuePerReservation)}</div>
                            <div class="hero-stat-label">Avg Revenue per Reservation</div>
                        </div>
                    </div>
                </div>
            </div>

            ${this.renderRevenueForecast(summary)}
            ` : ""}

            <!-- Year Comparison - Prominent Position -->
            ${showAnalyticsDashboard && lastYearStats ? this.renderYearComparison(lastYearStats, currentSummary, forecast.analyzedYear, this.currentYearData) : ""}

            <!-- Busy Patterns Analysis -->
            ${lastYearStats ? this.renderBusyPatterns(lastYearStats) : ""}

            <!-- Facility Analytics -->
            <div class="forecast-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        Facility Activity
                    </h3>
                    <span class="section-badge" data-activity-count>${facilityAnalytics.length} facilities</span>
                </div>

                <div class="facility-activity-legend" aria-label="Forecast facility legend">
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-high"></span>
                        <span>High confidence</span>
                    </div>
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-medium"></span>
                        <span>Medium confidence</span>
                    </div>
                    <div class="facility-activity-legend-item">
                        <span class="facility-activity-legend-swatch facility-activity-legend-confidence facility-activity-legend-low"></span>
                        <span>Estimated</span>
                    </div>
                </div>

                ${this.renderPerformanceRanking(facilityAnalytics)}
                <div class="facility-analytics-grid">
                    ${this.rankFacilities(facilityAnalytics)
                      .map((facility, idx) =>
                        this.renderFacilityAnalytics(facility, comparison, idx),
                      )
                      .join("")}
                </div>
            </div>
            <!-- Ahead Predictions -->
            ${
              (
                aheadPredictions ||
                weeklyTrends?.filter((t) => t.week.startsWith("Predicted")) ||
                []
              ).length > 0
                ? `
            <div class="forecast-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        3-Month Ahead Forecast
                    </h3>
                    <span class="section-badge" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;">Predicted</span>
                </div>
                <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem;padding:0 0.25rem;">
                    Based on historical patterns and year-over-year growth trends.
                </div>
                <div class="trends-grid">
                    ${(aheadPredictions || weeklyTrends.filter((t) => t.week.startsWith("Predicted"))).map((trend) => this.renderWeeklyTrend(trend)).join("")}
                </div>
            </div>`
                : ""
            }
        `;

    this.bindYoYFilters();
    this.bindBusyPatternFilters();
    this.bindFacilityActivityFilters();
  }

  renderRevenueForecast(summary) {
    return `
            <div class="forecast-section admin-revenue-section">
                <div class="section-header">
                    <h3 class="section-title">Revenue Forecast</h3>
                    <span class="section-badge">Based on approved bookings</span>
                </div>
                <div class="revenue-forecast-grid">
                    <div class="revenue-forecast-card">
                        <div class="revenue-forecast-label">Historical Booked Revenue</div>
                        <div class="revenue-forecast-value">${this.formatCurrency(summary.totalRevenue)}</div>
                    </div>
                    <div class="revenue-forecast-card">
                        <div class="revenue-forecast-label">Average Revenue per Non-Staff Reservation</div>
                        <div class="revenue-forecast-value">${this.formatCurrency(summary.averageRevenuePerReservation)}</div>
                    </div>
                    <div class="revenue-forecast-card prediction">
                        <div class="revenue-forecast-label">Projected Revenue Next Week</div>
                        <div class="revenue-forecast-value">${this.formatCurrency(summary.predictedNextWeekRevenue)}</div>
                    </div>
                </div>
                <p class="revenue-forecast-note">Projection applies each facility's average booked revenue to its predicted non-staff bookings.</p>
            </div>
        `;
  }

  bindFacilityActivityFilters() {
    const buttons =
      this.container?.querySelectorAll("[data-activity-facility]") || [];
    const clearButton = this.container?.querySelector("[data-activity-clear]");
    const cards =
      this.container?.querySelectorAll(".facility-card[data-facility-id]") ||
      [];
    const countBadge = this.container?.querySelector("[data-activity-count]");
    const total = cards.length;

    const updateSelection = () => {
      let visibleCount = 0;
      cards.forEach((card) => {
        const isVisible =
          !this.facilityActivitySelection ||
          card.dataset.facilityId === this.facilityActivitySelection;
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });

      buttons.forEach((button) => {
        const selected =
          button.dataset.activityFacility === this.facilityActivitySelection;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });

      if (countBadge) {
        countBadge.textContent = this.facilityActivitySelection
          ? `${visibleCount} of ${total} facilities`
          : `${total} facilities`;
      }
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const selected = button.dataset.activityFacility;
        this.facilityActivitySelection =
          this.facilityActivitySelection === selected ? null : selected;
        updateSelection();
      });
    });

    clearButton?.addEventListener("click", () => {
      this.facilityActivitySelection = null;
      updateSelection();
    });

    updateSelection();
  }

  formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }

  renderChangeIndicator(change, changePercent) {
    if (change === 0) return '<div class="stat-change neutral">No change</div>';

    const isPositive = change > 0;
    const arrow = isPositive ? "↑" : "↓";
    const colorClass = isPositive ? "positive" : "negative";

    return `
            <div class="stat-change ${colorClass}">
                ${arrow} ${Math.abs(change)} (${Math.abs(changePercent)}%) vs last year
            </div>
        `;
  }

  renderYearComparison(
    lastYearStats,
    currentStats,
    analyzedYear,
    currentYearData,
  ) {
    const totalDiff =
      currentStats.totalreservations - lastYearStats.totalreservations;
    const totalPercent =
      lastYearStats.totalreservations > 0
        ? Math.round((totalDiff / lastYearStats.totalreservations) * 100)
        : 0;

    // Use the analyzed year from forecast, or calculate current year - 1
    const lastYear = analyzedYear || new Date().getFullYear() - 1;
    const currentYear = lastYear + 1;

    // ── Facility definitions ─────────────────────────────────────────────
    const FACILITIES = [
      { id: "all", label: "All", color: "#0ea5e9" },
      { id: "auditorium", label: "Auditorium", color: "#800020" },
      { id: "library", label: "Library", color: "#059669" },
      { id: "grounds", label: "Grounds", color: "#d97706" },
      { id: "gym", label: "Gym", color: "#7c3aed" },
      { id: "avr", label: "AVR", color: "#db2777" },
    ];

    // ── Build monthly data for both years ───────────────────────────────
    const MONTHS = [
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
    const currentMonthIdx = new Date().getMonth();

    // this.lastYearData is pre-filtered to lastYear by loadData().
    // Only approved reservations count toward facility usage.
    const lyApproved = (this.lastYearData || []).filter(
      (r) => r.date && r.status === "approved",
    );

    const buildLastYearPerFacility = (facilityId) =>
      MONTHS.map((_, i) => {
        const prefix = `${lastYear}-${String(i + 1).padStart(2, "0")}`;
        return lyApproved.filter(
          (r) => r.date.startsWith(prefix) && r.facilityId === facilityId,
        ).length;
      });

    const lastYearAllMonthly = MONTHS.map((_, i) => {
      const prefix = `${lastYear}-${String(i + 1).padStart(2, "0")}`;
      return lyApproved.filter((r) => r.date.startsWith(prefix)).length;
    });

    // this.currentYearData is pre-filtered to currentYear by loadData().
    // Only approved reservations count; blocks and cancelled requests are excluded.
    const cyApproved = (currentYearData || []).filter(
      (r) => r.date && r.status === "approved",
    );

    const buildCurrentYearPerFacility = (facilityId) =>
      MONTHS.map((_, i) => {
        const prefix = `${currentYear}-${String(i + 1).padStart(2, "0")}`;
        return cyApproved.filter(
          (r) => r.date.startsWith(prefix) && r.facilityId === facilityId,
        ).length;
      });

    const currentYearAllMonthly = MONTHS.map((_, i) => {
      const prefix = `${currentYear}-${String(i + 1).padStart(2, "0")}`;
      return cyApproved.filter((r) => r.date.startsWith(prefix)).length;
    });

    const buildProjection = (lastYearValues, currentYearValues) => {
      const currentYtd = currentYearValues
        .slice(0, currentMonthIdx)
        .reduce((sum, value) => sum + value, 0);
      const previousYtd = lastYearValues
        .slice(0, currentMonthIdx)
        .reduce((sum, value) => sum + value, 0);
      const growthRate = previousYtd > 0 ? currentYtd / previousYtd : 1;
      return {
        growthPercent: Math.round((growthRate - 1) * 100),
        values: lastYearValues.map((value, index) =>
          index <= currentMonthIdx
            ? currentYearValues[index]
            : Math.round(value * growthRate),
        ),
      };
    };

    // Pre-compute datasets keyed by facility id
    const datasets = {};
    FACILITIES.forEach((f) => {
      if (f.id === "all") {
        const projection = buildProjection(
          lastYearAllMonthly,
          currentYearAllMonthly,
        );
        datasets["all"] = {
          lastYear: lastYearAllMonthly,
          currentYear: currentYearAllMonthly,
          projected: projection.values,
          growthPercent: projection.growthPercent,
        };
      } else {
        const lastYear = buildLastYearPerFacility(f.id);
        const currentYear = buildCurrentYearPerFacility(f.id);
        const projection = buildProjection(lastYear, currentYear);
        datasets[f.id] = {
          lastYear,
          currentYear,
          projected: projection.values,
          growthPercent: projection.growthPercent,
        };
      }
    });

    // ── SVG layout constants ─────────────────────────────────────────────
    const W = 680,
      H = 220;
    const padL = 40,
      padR = 16,
      padT = 16,
      padB = 34;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const xStep = chartW / (MONTHS.length - 1);
    const toX = (i) => padL + i * xStep;

    // X-axis month labels (static — same for all facilities)
    const xLabels = MONTHS.map(
      (m, i) =>
        `<text x="${toX(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#94a3b8">${m}</text>`,
    ).join("");

    // Unique chart id to scope the script
    const chartId = `yoy-chart-${Date.now()}`;

    const projectedAllMonthly = datasets.all.projected;
    const allVals = lastYearAllMonthly.concat(
      currentYearAllMonthly,
      projectedAllMonthly,
    );
    const yMax = Math.max(...allVals, 1);
    const toY = (val) => padT + chartH - (val / yMax) * chartH;

    const seriesFor = (values, startIndex = 0) =>
      values
        .map((v, i) => `${toX(startIndex + i)},${toY(v)}`)
        .join(" ");
    const lastYearPoints = seriesFor(lastYearAllMonthly);
    const currentAllPoints = seriesFor(
      currentYearAllMonthly.slice(0, currentMonthIdx + 1),
    );
    const projectedAllPoints = seriesFor(
      projectedAllMonthly.slice(currentMonthIdx),
      currentMonthIdx,
    );

    const facilitySeries = FACILITIES.filter((f) => f.id !== "all")
      .map((f) => {
        const { lastYear, currentYear, projected } = datasets[f.id];
        return `
                <polyline class="yoy-facility-line yoy-facility-line-last" data-facility="${f.id}" data-values="${lastYear.join(",")}" points="${seriesFor(lastYear)}"
                          fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4"
                          stroke-linejoin="round" stroke-linecap="round" style="display:none"/>
                <polyline class="yoy-facility-line yoy-facility-line-current" data-facility="${f.id}" data-values="${currentYear.join(",")}" data-end-index="${currentMonthIdx}" points="${seriesFor(currentYear.slice(0, currentMonthIdx + 1))}"
                          fill="none" stroke="${f.color}" stroke-width="2.5"
                          stroke-linejoin="round" stroke-linecap="round" style="display:none"/>
                <polyline class="yoy-facility-line yoy-facility-line-forecast" data-facility="${f.id}" data-start-index="${currentMonthIdx}" data-values="${projected.slice(currentMonthIdx).join(",")}" points="${seriesFor(projected.slice(currentMonthIdx), currentMonthIdx)}"
                          fill="none" stroke="${f.color}" stroke-width="2.5" stroke-dasharray="5 4"
                          stroke-linejoin="round" stroke-linecap="round" style="display:none"/>
            `;
      })
      .join("");

    // Static SVG shell with actual SVG lines rendered directly so they are visible in the DOM.
    const svgChart = `
            <svg id="${chartId}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
                 class="yoy-svg-chart" aria-label="Year-over-Year monthly reservations line chart for all facilities"
                 data-chart-width="${W}" data-pad-left="${padL}" data-pad-right="${padR}"
                 data-pad-top="${padT}" data-plot-height="${chartH}" data-all-y-max="${yMax}"
                 data-month-count="${MONTHS.length}">
                <defs>
                    <linearGradient id="yoy-grad-last-${chartId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#94a3b8" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="yoy-grad-curr-${chartId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                ${xLabels}
                <g id="${chartId}-grid" class="yoy-grid">
                    ${Array.from({ length: 5 }, (_, t) => {
                      const val = Math.round((yMax / 4) * t);
                      const y = toY(val);
                      return `
                            <g class="yoy-grid-tick">
                                <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"></line>
                                <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${val}</text>
                            </g>
                        `;
                    }).join("")}
                </g>
                <polygon class="yoy-series-last" points="${toX(0)},${padT + chartH} ${lastYearPoints} ${toX(MONTHS.length - 1)},${padT + chartH}" fill="url(#yoy-grad-last-${chartId})"></polygon>
                <polyline class="yoy-series-last" points="${lastYearPoints}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
                <polygon class="yoy-series-all" points="${toX(0)},${padT + chartH} ${currentAllPoints} ${toX(currentMonthIdx)},${padT + chartH}" fill="url(#yoy-grad-curr-${chartId})"></polygon>
                <polyline class="yoy-series-all" points="${currentAllPoints}" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
                <polyline class="yoy-series-all-forecast" points="${projectedAllPoints}" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"></polyline>
                <line x1="${toX(currentMonthIdx)}" y1="${padT}" x2="${toX(currentMonthIdx)}" y2="${padT + chartH}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"></line>
                <text x="${toX(currentMonthIdx) + 3}" y="${padT + 8}" font-size="7" fill="#94a3b8">today</text>
                ${facilitySeries}
                ${lastYearAllMonthly.map((v, i) => `<circle class="yoy-series-last" cx="${toX(i)}" cy="${toY(v)}" r="3.5" fill="#94a3b8" stroke="#fff" stroke-width="1.5"></circle>`).join("")}
                ${currentYearAllMonthly.slice(0, currentMonthIdx + 1).map((v, i) => `<circle class="yoy-series-all-marker" cx="${toX(i)}" cy="${toY(v)}" r="3.5" fill="#0ea5e9" stroke="#0ea5e9" stroke-width="2"></circle>`).join("")}
                ${projectedAllMonthly.slice(currentMonthIdx + 1).map((v, i) => `<circle class="yoy-series-all-forecast-marker" cx="${toX(currentMonthIdx + i + 1)}" cy="${toY(v)}" r="3.5" fill="#fff" stroke="#0ea5e9" stroke-width="2"></circle>`).join("")}
            </svg>
        `;

    // Facility filter buttons
    const filterButtons = FACILITIES.map(
      (f) => `
            <button class="yoy-filter-btn ${f.id === "all" ? "active" : ""}"
                    data-facility="${f.id}"
                    data-chart="${chartId}"
                    data-color="${f.color}"
                    data-forecast-rate="${datasets[f.id].growthPercent}"
                    aria-pressed="${f.id === "all" ? "true" : "false"}"
                    style="--btn-color:${f.color}">
                ${f.label}
            </button>
        `,
    ).join("");

    const toggleScript = "";

    return `
            <div class="year-comparison-section">
                <div class="section-header">
                    <h3 class="section-title">
                        <span class="title-icon"></span>
                        Year-over-Year Activity
                    </h3>
                    <div class="comparison-summary ${totalDiff >= 0 ? "positive" : "negative"}">
                        <span class="summary-icon">${totalDiff >= 0 ? "+" : "-"}</span>
                        <span class="summary-text">
                            ${totalDiff >= 0 ? "+" : ""}${totalPercent}% ${totalDiff >= 0 ? "growth" : "decline"} from last year
                        </span>
                    </div>
                </div>

                <!-- Facility filter buttons -->
                <div class="yoy-filter-bar">
                    ${filterButtons}
                </div>

                <div class="yoy-chart-wrap">
                    <!-- Legend -->
                    <div class="yoy-legend">
                        <span class="yoy-legend-item yoy-legend-last-year">
                            <span class="yoy-legend-dot" style="background:#94a3b8"></span>
                            ${lastYear}
                        </span>
                        <span class="yoy-legend-item yoy-legend-current" data-all-label="${currentYear}" data-year="${currentYear}">
                            <span class="yoy-legend-dot yoy-legend-curr-dot" style="background:#0ea5e9"></span>
                            <span class="yoy-legend-current-label">${currentYear}</span>
                        </span>
                        <span class="yoy-legend-item yoy-legend-facility-last" data-year="${lastYear}" style="display:none">
                            <span class="yoy-legend-dot-dash yoy-legend-facility-last-dash"></span>
                            <span class="yoy-legend-facility-last-label">${lastYear}</span>
                        </span>
                        <span class="yoy-legend-item yoy-legend-future-ref">
                            <span class="yoy-legend-dot-dash yoy-legend-future-dash" style="color:#0ea5e9"></span>
                            <span class="yoy-legend-future-label">Projected (${datasets.all.growthPercent > 0 ? "+" : ""}${datasets.all.growthPercent}% vs LY YTD)</span>
                        </span>
                    </div>
                    ${svgChart}
                </div>
                <p class="yoy-forecast-note">Completed months show actual bookings. Upcoming months are projected from the same months last year, adjusted by this year's completed-month growth rate.</p>

                <div class="insights-panel" style="margin-top:1rem;">
                    <h4 class="insights-title">
                        <span></span>
                        Key Insights
                    </h4>
                    <div class="insights-list">
                        ${this.generateInsights(lastYearStats, currentStats)}
                    </div>
                </div>
            </div>
        `;
  }

  getFacilityName(facilityId) {
    const facilityNames = {
      auditorium: "Auditorium",
      library: "Library",
      grounds: "Grounds",
      gym: "Gym",
      avr: "AVR",
    };
    return facilityNames[facilityId] || facilityId;
  }

  generateInsights(lastYear, current) {
    const insights = [];

    const totalDiff = current.totalreservations - lastYear.totalreservations;
    const totalPercent =
      lastYear.totalreservations > 0
        ? Math.round((totalDiff / lastYear.totalreservations) * 100)
        : 0;

    if (totalDiff > 0) {
      insights.push(`
                <div class="insight-item positive">
                    <div class="insight-icon">+</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservations increased by <strong>${totalDiff}</strong> compared to last year</div>
                        <div class="insight-badge positive">+${totalPercent}%</div>
                    </div>
                </div>
            `);
    } else if (totalDiff < 0) {
      insights.push(`
                <div class="insight-item negative">
                    <div class="insight-icon">-</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservations decreased by <strong>${Math.abs(totalDiff)}</strong> compared to last year</div>
                        <div class="insight-badge negative">${totalPercent}%</div>
                    </div>
                </div>
            `);
    } else {
      insights.push(`
                <div class="insight-item neutral">
                    <div class="insight-icon">=</div>
                    <div class="insight-content">
                        <div class="insight-text">Reservation volume remained stable compared to last year</div>
                    </div>
                </div>
            `);
    }

    const attendeesDiff = current.averageAttendees - lastYear.averageAttendees;
    if (attendeesDiff !== 0) {
      const isPositive = attendeesDiff > 0;
      insights.push(`
                <div class="insight-item ${isPositive ? "positive" : "negative"}">
                    <div class="insight-icon"></div>
                    <div class="insight-content">
                        <div class="insight-text">Average event size ${isPositive ? "grew" : "decreased"} by <strong>${Math.abs(attendeesDiff)} attendees</strong></div>
                    </div>
                </div>
            `);
    }

    if (current.mostPopularFacility !== lastYear.mostPopularFacility) {
      insights.push(`
                <div class="insight-item info">
                    <div class="insight-icon"></div>
                    <div class="insight-content">
                        <div class="insight-text">Most popular venue shifted from <strong>${this.getFacilityName(lastYear.mostPopularFacility)}</strong> to <strong>${current.mostPopularFacility}</strong></div>
                    </div>
                </div>
            `);
    }

    return insights.join("");
  }

  getBusyPatternFacilities() {
    return [
      { id: "all", label: "All", color: "#0ea5e9" },
      { id: "auditorium", label: "Auditorium", color: "#800020" },
      { id: "library", label: "Library", color: "#059669" },
      { id: "grounds", label: "Grounds", color: "#d97706" },
      { id: "gym", label: "Gym", color: "#7c3aed" },
      { id: "avr", label: "AVR", color: "#db2777" },
    ];
  }

  getBusyDayData(facilityId = "all") {
    const baseDayOrder = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayOrder =
      facilityId === "grounds"
        ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        : baseDayOrder;
    const counts = Object.fromEntries(dayOrder.map((day) => [day, 0]));

    const records = Array.isArray(this.lastYearData) ? this.lastYearData : [];
    records
      .filter((reservation) => {
        if (!reservation?.date) return false;
        if (reservation.status && reservation.status !== "approved")
          return false;
        if (facilityId !== "all" && reservation.facilityId !== facilityId)
          return false;
        const day = new Date(reservation.date).toLocaleString("default", {
          weekday: "long",
        });
        if (
          facilityId === "grounds" &&
          (day === "Saturday" || day === "Sunday")
        )
          return false;
        return true;
      })
      .forEach((reservation) => {
        const day = new Date(reservation.date).toLocaleString("default", {
          weekday: "long",
        });
        if (counts[day] !== undefined) {
          counts[day] += 1;
        }
      });

    const entries = dayOrder.map((day) => [day, counts[day]]);
    const peakEntry = entries.reduce(
      (best, current) => (current[1] >= best[1] ? current : best),
      ["No data", 0],
    );
    const total = entries.reduce((sum, [, value]) => sum + value, 0);

    return { entries, peakEntry, total };
  }

  bindBusyPatternFilters() {
    const buttons =
      this.container?.querySelectorAll(".busy-pattern-filter-btn") || [];
    buttons.forEach((btn) => {
      if (btn.dataset.busyBound === "true") return;
      btn.dataset.busyBound = "true";
      btn.addEventListener("click", () => {
        const selected = btn.dataset.facility || "all";
        this.busyPatternSelection = selected;

        const section = btn.closest(".busy-patterns-section");
        if (!section) return;

        section.querySelectorAll(".busy-pattern-filter-btn").forEach((b) => {
          const isActive = b === btn;
          b.classList.toggle("active", isActive);
          b.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        const { entries, peakEntry, total } = this.getBusyDayData(selected);
        const maxCount = Math.max(...entries.map(([, count]) => count), 1);
        const chart = section.querySelector(".busy-pattern-bar-chart");
        if (chart) {
          chart.innerHTML = entries
            .map(([day, count]) => {
              const percentage =
                total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
              const barHeight = (count / maxCount) * 100;
              const dayShort = day.substring(0, 3);
              return `
                                <div class="pattern-bar-item">
                                    <div class="bar-value">${count} <span class="bar-percent">(${percentage}%)</span></div>
                                    <div class="bar-container">
                                        <div class="bar-fill day-bar" style="height: ${barHeight}%"></div>
                                    </div>
                                    <div class="bar-label">${dayShort}</div>
                                </div>
                            `;
            })
            .join("");
        }

        const highlightValue = section.querySelector(
          ".busy-pattern-highlight .highlight-value",
        );
        const highlightCount = section.querySelector(
          ".busy-pattern-highlight .highlight-count",
        );
        if (highlightValue) highlightValue.textContent = peakEntry[0];
        if (highlightCount)
          highlightCount.textContent = `${peakEntry[1]} reservations`;

      });
    });
  }

  renderBusyPatterns(lastYearStats) {
    const historicalYear = new Date().getFullYear() - 1;
    const facilityOptions = this.getBusyPatternFacilities();
    const selectedFacility = this.busyPatternSelection || "all";
    const { entries, peakEntry, total } = this.getBusyDayData(selectedFacility);
    const maxCount = Math.max(...entries.map(([, count]) => count), 1);
    const filterButtons = facilityOptions
      .map(
        (f) => `
                <button class="yoy-filter-btn busy-pattern-filter-btn ${f.id === selectedFacility ? "active" : ""}"
                        data-facility="${f.id}"
                        data-color="${f.color}"
                        aria-pressed="${f.id === selectedFacility ? "true" : "false"}"
                        style="--btn-color:${f.color}">
                    ${f.label}
                </button>
            `,
      )
      .join("");

    const dayBars = entries
      .map(([day, count]) => {
        const percentage =
          total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
        const barHeight = (count / maxCount) * 100;
        const dayShort = day.substring(0, 3);
        const isUnavailable =
          selectedFacility === "grounds" &&
          (day === "Saturday" || day === "Sunday");
        return `
                    <div class="pattern-bar-item">
                        <div class="bar-value">${count} <span class="bar-percent">(${percentage}%)</span></div>
                        <div class="bar-container">
                            <div class="bar-fill ${isUnavailable ? "unavailable-bar" : "day-bar"}" style="height: ${barHeight}%"></div>
                        </div>
                        <div class="bar-label">${dayShort}</div>
                    </div>
                `;
      })
      .join("");

    return `
                <div class="forecast-section busy-patterns-section">
                    <div class="section-header">
                        <h3 class="section-title">
                            <span class="title-icon"></span>
                            Historical Busy Patterns (${historicalYear})
                        </h3>
                        <span class="section-badge">Based on ${lastYearStats.totalreservations} reservations</span>
                    </div>

                    <div class="yoy-filter-bar" style="margin-bottom:1rem;">
                        ${filterButtons}
                    </div>

                    <div class="patterns-grid">
                        <div class="pattern-card">
                            <div class="pattern-header">
                                <h4 class="pattern-title">
                                    <span class="pattern-icon"></span>
                                    Busiest Days of Week
                                </h4>
                            </div>
                            <div class="pattern-body">
                                <div class="pattern-highlight busy-pattern-highlight">
                                    <div class="highlight-label">Peak Day</div>
                                    <div class="highlight-value">${peakEntry[0]}</div>
                                    <div class="highlight-count">${peakEntry[1]} reservations</div>
                                </div>
                                <div class="pattern-bars busy-pattern-bar-chart">
                                    ${dayBars}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            `;
  }

  /**
   * Sorts facilities by a composite score: utilization (40%) + reservations (40%) + avg attendees (20%)
   */
  rankFacilities(facilityAnalytics) {
    if (!facilityAnalytics || facilityAnalytics.length === 0) return [];
    const maxRes = Math.max(
      ...facilityAnalytics.map((r) => r.totalreservations),
      1,
    );
    const maxAtt = Math.max(
      ...facilityAnalytics.map((r) => r.averageAttendees),
      1,
    );
    return [...facilityAnalytics]
      .map((r) => ({
        ...r,
        _score:
          parseInt(r.utilizationRate) * 0.4 +
          (r.totalreservations / maxRes) * 100 * 0.4 +
          (r.averageAttendees / maxAtt) * 100 * 0.2,
      }))
      .sort((a, b) => b._score - a._score);
  }

  renderPerformanceRanking(facilityAnalytics) {
    if (!facilityAnalytics || facilityAnalytics.length === 0) return "";
    const ranked = this.rankFacilities(facilityAnalytics);
    const top = ranked[0];
    const medals = ["1st", "2nd", "3rd", "4th", "5th"];
    const maxRes = Math.max(...ranked.map((r) => r.totalreservations), 1);

    const bars = ranked
      .map((facility, idx) => {
        const barWidth = Math.round(
          (facility.totalreservations / maxRes) * 100,
        );
        const medal = medals[idx] || `#${idx + 1}`;
        const trendColor =
          facility.trend === "increasing"
            ? "#16a34a"
            : facility.trend === "decreasing"
              ? "#dc2626"
              : "#64748b";
        const trendArrow =
          facility.trend === "increasing"
            ? "↑"
            : facility.trend === "decreasing"
              ? "↓"
              : "→";
        return `
                <button type="button" class="facility-ranking-button" data-activity-facility="${facility.facilityId}" aria-pressed="false" aria-label="Show ${facility.facilityName} facility card">
                    <span class="facility-ranking-medal">${medal}</span>
                    <span class="facility-ranking-name">${facility.facilityName}</span>
                    <span class="facility-ranking-bar" aria-hidden="true">
                        <span style="width:${barWidth}%;"></span>
                    </span>
                    <span class="facility-ranking-bookings">${facility.totalreservations}</span>
                    <span class="facility-ranking-trend" style="color:${trendColor};">${trendArrow}</span>
                </button>`;
      })
      .join("");

    return `
            <div class="facility-performance-ranking">
                <div class="facility-ranking-header">
                    <span class="facility-ranking-featured">
                        Best Facility: ${top.facilityName}
                    </span>
                    <span class="facility-ranking-summary">${top.utilizationRate} utilization · ${top.totalreservations} bookings</span>
                </div>
                <div class="facility-ranking-content">
                    <div class="facility-ranking-list">${bars}</div>
                    <button type="button" class="facility-ranking-clear" data-activity-clear>Show all facilities</button>
                </div>
                <div class="facility-ranking-hint">Select a facility to show only its facility card. Select it again or choose “Show all facilities” to reset.</div>
            </div>`;
  }

  renderFacilityAnalytics(facility, comparison, rank = -1) {
    const trendIcon =
      facility.trend === "increasing"
        ? "+"
        : facility.trend === "decreasing"
          ? "-"
          : "=";
    const trendClass =
      facility.trend === "increasing"
        ? "positive"
        : facility.trend === "decreasing"
          ? "negative"
          : "neutral";
    const facilityComparison =
      comparison?.facilityComparisons?.[facility.facilityId];

    // Get facility icon
    const facilityIcons = {
      auditorium: "AUD",
      library: "LIB",
      grounds: "GRD",
      gym: "GYM",
      avr: "AVR",
    };
    const facilityIcon = facilityIcons[facility.facilityId] || "FACILITY";

    const medals = ["1st", "2nd", "3rd", "4th", "5th"];
    const rankBadge =
      rank >= 0
        ? `<span style="position:absolute;top:-8px;left:-8px;font-size:0.65rem;font-weight:800;color:${rank === 0 ? "#800020" : "#64748b"};background:${rank === 0 ? "#fecdd3" : "#e2e8f0"};border-radius:999px;padding:2px 6px;line-height:1;" title="Rank #${rank + 1}">${medals[rank] || `#${rank + 1}`}</span>`
        : "";

    return `
            <div class="facility-card" data-facility-id="${facility.facilityId}" style="position:relative;">
                ${rankBadge}
                <div class="facility-card-header">
                    <div class="facility-info">
                        <span class="facility-icon">${facilityIcon}</span>
                        <div>
                            <h4 class="facility-name">${facility.facilityName}</h4>
                            <span class="facility-trend ${trendClass}">
                                ${trendIcon} ${facility.trend}
                            </span>
                        </div>
                    </div>
                    <div class="facility-utilization">
                        <div class="utilization-circle">
                            <svg viewBox="0 0 36 36" class="circular-chart">
                                <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                <path class="circle" stroke-dasharray="${facility.utilizationRate.replace("%", "")}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                <text x="18" y="18.5" class="percentage">${facility.utilizationRate}</text>
                                <text x="18" y="24.5" class="utilization-label">Utilization</text>
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="facility-card-body">
                    <div class="facility-stats-grid">
                        <div class="facility-stat">
                            <div class="facility-stat-label">Total Reservations</div>
                            <div class="facility-stat-value">${facility.totalreservations}</div>
                            ${
                              facilityComparison
                                ? `
                                <div class="facility-stat-change ${facilityComparison.change >= 0 ? "positive" : "negative"}">
                                    ${facilityComparison.change >= 0 ? "↑" : "↓"} ${Math.abs(facilityComparison.changePercent)}% vs last year
                                </div>
                            `
                                : ""
                            }
                        </div>
                        <div class="facility-stat">
                            <div class="facility-stat-label">Avg Attendees</div>
                            <div class="facility-stat-value">${facility.averageAttendees}</div>
                        </div>
                        <div class="facility-stat">
                            <div class="facility-stat-label">Peak Days</div>
                            <div class="facility-stat-value small">${Array.isArray(facility.peakDays) ? facility.peakDays.join(", ") : facility.peakDays}</div>
                        </div>
                        ${
                          this.includeRevenue
                            ? `
                        <div class="facility-stat">
                            <div class="facility-stat-label">Booked Revenue</div>
                            <div class="facility-stat-value small">${this.formatCurrency(facility.totalRevenue)}</div>
                        </div>
                        <div class="facility-stat prediction-stat">
                            <div class="facility-stat-label">Next-Week Revenue</div>
                            <div class="facility-stat-value small">${this.formatCurrency(facility.predictedNextWeekRevenue)}</div>
                        </div>
                        `
                            : ""
                        }
                        <div class="facility-stat prediction-stat">
                            <div class="facility-stat-label">
                                <span></span> Next Week
                            </div>
                            <div class="facility-stat-value">${facility.predictedNextWeek}</div>
                            ${(() => {
                              const confColor =
                                facility.predictionConfidence === "high"
                                  ? "#16a34a"
                                  : facility.predictionConfidence === "medium"
                                    ? "#d97706"
                                    : "#94a3b8";
                              const confLabel =
                                facility.predictionConfidence === "high"
                                  ? "High confidence"
                                  : facility.predictionConfidence === "medium"
                                    ? "Medium confidence"
                                    : "Estimated";
                              const confDot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${confColor};margin-right:3px;vertical-align:middle;"></span>`;
                              return `<div style="font-size:0.65rem;color:${confColor};font-weight:600;margin-top:3px;">${confDot}${confLabel}</div>`;
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  renderWeeklyTrend(trend) {
    const isCurrentWeek = trend.week.includes("Current");
    const isPrediction = trend.week.includes("Predicted");

    return `
            <div class="trend-card ${isPrediction ? "prediction" : ""}">
                <div class="trend-header">
                    <h4>${trend.week}</h4>
                    ${isPrediction ? '<span class="prediction-badge">Predicted</span>' : ""}
                </div>
                <div class="trend-stats">
                    <div class="trend-stat">
                        <span class="trend-stat-label">Total:</span>
                        <span class="trend-stat-value">${trend.totalreservations}</span>
                    </div>
                    <div class="trend-breakdown">
                        <div class="trend-item">
                            <span>Auditorium:</span>
                            <strong>${trend.auditorium}</strong>
                        </div>
                        <div class="trend-item">
                            <span>Library:</span>
                            <strong>${trend.library}</strong>
                        </div>
                        <div class="trend-item">
                            <span>Grounds:</span>
                            <strong>${trend.grounds}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  renderWeeklyTrend(trend) {
    const isPrediction = trend.week.includes("Predicted");

    return `
            <div class="trend-card ${isPrediction ? "prediction" : "current"}">
                <div class="trend-card-header">
                    <h4 class="trend-title">${trend.week}</h4>
                    ${isPrediction ? '<span class="prediction-badge"><span></span> Prediction</span>' : '<span class="current-badge"><span></span> Actual Data</span>'}
                </div>
                <div class="trend-card-body">
                    <div class="trend-total">
                        <div class="trend-total-label">Total Reservations</div>
                        <div class="trend-total-value">${trend.totalreservations}</div>
                    </div>
                    <div class="trend-breakdown">
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill auditorium" style="width: ${(trend.auditorium / trend.totalreservations) * 100}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Auditorium</span>
                                <span class="breakdown-value">${trend.auditorium}</span>
                            </div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill library" style="width: ${(trend.library / trend.totalreservations) * 100}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Library</span>
                                <span class="breakdown-value">${trend.library}</span>
                            </div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-bar">
                                <div class="breakdown-fill grounds" style="width: ${(trend.grounds / trend.totalreservations) * 100}%"></div>
                            </div>
                            <div class="breakdown-info">
                                <span class="breakdown-icon"></span>
                                <span class="breakdown-name">Grounds</span>
                                <span class="breakdown-value">${trend.grounds}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  renderRecommendation(rec) {
    const priorityConfig = {
      high: { color: "#ef4444", icon: "HIGH", label: "High Priority" },
      medium: { color: "#f59e0b", icon: "MED", label: "Medium Priority" },
      low: { color: "#10b981", icon: "LOW", label: "Low Priority" },
    };

    const config = priorityConfig[rec.priority] || priorityConfig.medium;

    return `
            <div class="recommendation-card ${rec.priority}">
                <div class="recommendation-priority-badge" style="background-color: ${config.color}">
                    <span class="priority-icon">${config.icon}</span>
                    <span class="priority-label">${config.label}</span>
                </div>
                <div class="recommendation-content">
                    <p class="recommendation-text">${rec.message}</p>
                </div>
                <div class="recommendation-action">
                    <button class="action-btn" onclick="alert('Feature coming soon!')">
                        <span>Take Action</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
        `;
  }
}
