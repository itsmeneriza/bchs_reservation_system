import { state, setSelectedDate, setSelectedFacility } from "../core/state.js";
import { FacilityList } from "./FacilityListComponent.js";

const TIER_COLORS = {
  High: "#dc2626",
  Moderate: "#d97706",
  Low: "#059669",
};

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

function todayAsDateString() {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
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
      const response = await fetch(`/api/forecast/user?${params}`);
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
        <section class="user-forecast-card">
          <div class="macro-card-heading">
            <h3>12-month usage forecast (month &amp; week)</h3>
            <label class="macro-facility-control">Facility
              <select class="forecast-facility-select">
                ${facilities.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === facility.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
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
                    return `
                      <button type="button" class="macro-forecast-bar macro-bar-incoming" data-period="${escapeHtml(item.periodKey)}" title="${label}: ${value}% — ${escapeHtml(item.anchor_event_note)}">
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
              <div class="macro-insight macro-insight-inline">
                <strong class="macro-insight-title">${escapeHtml(selectedMacro?.periodKey || "Weekly outlook")}</strong>
                <span class="macro-insight-value">${selectedMacro?.forecasted_pct ?? 0}%</span>
                <p class="forecast-selection-note">${escapeHtml(selectedMacro?.anchor_event_note || "Select a bar to see its demand driver.")}</p>
              </div>
            </div>
            <aside class="macro-summary-panel">
              <span class="macro-insight-badge">Forecast</span>
              <span class="macro-summary-icon" aria-hidden="true">i</span>
              <h4>12-month forecast for ${escapeHtml(facility.name)}</h4>
              <p>Projected utilization based on historical activity, live bookings, and seasonal guidance.</p>
              <div class="macro-summary-stat">
                <small>First forecast bucket</small>
                <strong>${selectedMacro?.forecasted_pct ?? 0}%</strong>
              </div>
              <div class="macro-summary-stat">
                <small>Forecast method</small>
                <strong>55 / 30 / 15</strong>
              </div>
            </aside>
          </div>
        </section>

        <section class="user-forecast-card">
          <div class="forecast-step-heading">
            <span class="forecast-step forecast-step-green">Step 2</span>
            <div><h3>Choose a lower-demand hour</h3><p>Recent usage guidance for ${escapeHtml(facility.name)}. Select any hour to check the live calendar and start a request.</p></div>
          </div>
          <div class="forecast-legend">
            <span><i class="slot-dot available"></i>Available</span>
            <span><i class="slot-dot moderate"></i>Moderate</span>
            <span><i class="slot-dot busy"></i>Busy</span>
          </div>
          <div class="micro-forecast-wrap">
            <table class="micro-forecast-table">
              <thead><tr><th>Time</th>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => `<th>${day}</th>`).join("")}</tr></thead>
              <tbody>${micro.map((row) => `
                <tr><th>${formatHour(row[0].hour)}<small>${escapeHtml(row[0].policy_note)}</small></th>
                  ${row.map((slot) => `<td><button type="button" class="micro-slot ${slot.slot_status.toLowerCase()}" data-day-index="${slot.dayIndex}" data-hour="${slot.hour}" aria-label="${slot.day} ${formatHour(slot.hour)}: ${slot.slot_status}, ${Math.round(slot.moving_avg_score * 100)}% recent use" title="${escapeHtml(slot.policy_note)}">${slot.slot_status}<small>${Math.round(slot.moving_avg_score * 100)}% recent use</small></button></td>`).join("")}
                </tr>`).join("")}</tbody>
            </table>
          </div>
          <p class="forecast-policy-note">Demand labels are guidance, not availability guarantees. Actual reservations and school events remain hard calendar conflicts.</p>
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
          title.textContent = item.periodKey;
          value.textContent = `${item.forecasted_pct}%`;
          note.textContent = item.anchor_event_note;
        }
      });
    });
    this.container.querySelectorAll(".micro-slot:not(:disabled)").forEach((button) => {
      button.addEventListener("click", () => this.openSlot(button));
    });
  }

  openSlot(button) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const selectedDate = new Date(monday);
    selectedDate.setDate(monday.getDate() + Number(button.dataset.dayIndex));
    const hour = Number(button.dataset.hour);
    if (selectedDate < today || (
      selectedDate.getTime() === today.getTime() &&
      hour <= new Date().getHours()
    )) {
      selectedDate.setDate(selectedDate.getDate() + 7);
    }
    setSelectedDate(selectedDate);
    const pad = (value) => String(value).padStart(2, "0");
    window._openReservationModal?.(null, {
      startTime: `${pad(hour)}:00`,
      endTime: `${pad(hour + 1)}:00`,
    });
  }
}
