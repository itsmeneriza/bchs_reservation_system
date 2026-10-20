/**
 * BCHS reservation System - Main Application
 */

import { state, setSelectedRoom } from "./core/state.js";
import { loadData } from "./services/reservationService.js";
import { RoomList } from "./components/RoomListComponent.js";
import { Calendar } from "./components/CalendarComponent.js";
import { TimeSlots } from "./components/TimeSlotsComponent.js";
import { Chat } from "./components/ChatComponent.js";
import { ReservationModal } from "./components/ReservationModalComponent.js";
import { Forecast } from "./components/ForecastComponent.js";
import { CancellationHandler } from "./components/CancellationComponent.js";
import { LoginHandler } from "./components/LoginComponent.js";
import { MyRequests } from "./components/MyRequestsComponent.js";
import { registerMobileViewer } from "./utils/facilityUtils.js";

class ReservationApp {
  constructor() {
    this.facilityList = new RoomList();
    this.calendar = new Calendar();
    this.timeSlots = new TimeSlots();
    this.chat = new Chat();
    this.reservationModal = new ReservationModal();
    this.forecast = new Forecast();
    this.cancellationHandler = new CancellationHandler();
    this.loginHandler = new LoginHandler();
    this.myRequests = new MyRequests();
  }

  async init() {
    try {
      const dataLoaded = await loadData();
      if (!dataLoaded) {
        alert(
          "System initialized with offline data or failed to load. Some features may be limited.",
        );
      }

      if (state.facilities.length > 0) {
        setSelectedRoom(state.facilities[0]);
      }

      // Render critical visible components first
      this.facilityList.render();
      this.calendar.render();
      this.timeSlots.render();
      this.chat.init();
      this.reservationModal.init();
      this.initEventListeners();
      this.handleHashTab();
      registerMobileViewer();

      // Defer non-visible tab renders until after paint
      requestIdleCallback(() => {
        this.myRequests.render();
        // Load forecast data then render (deferred — heaviest API call)
        import("./services/dataService.js").then(({ dataService }) => {
          dataService.loadAllDataWithForecast().then(() => {
            state.forecast = dataService.getForecast();
          });
        });
      });

      this.setupAutoRefresh();
    } catch (error) {
      console.error("Critical error during app initialization:", error);
    }
  }

  initEventListeners() {
    // Calendar navigation
    const prevMonthBtn = document.getElementById("prev-month");
    const nextMonthBtn = document.getElementById("next-month");

    if (prevMonthBtn)
      prevMonthBtn.addEventListener("click", () => {
        this.calendar.previousMonth();
      });

    if (nextMonthBtn)
      nextMonthBtn.addEventListener("click", () => {
        this.calendar.nextMonth();
      });

    // Hamburger menu toggle
    const hamburger = document.getElementById("hamburger-btn");
    const headerTabs = document.getElementById("header-tabs");
    if (hamburger && headerTabs) {
      hamburger.addEventListener("click", (e) => {
        e.stopPropagation();
        hamburger.classList.toggle("open");
        headerTabs.classList.toggle("open");
      });
      // Close on outside click
      document.addEventListener("click", () => {
        hamburger.classList.remove("open");
        headerTabs.classList.remove("open");
      });
    }

    // Tab navigation
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Close hamburger when a tab is selected
        document.getElementById("hamburger-btn")?.classList.remove("open");
        document.getElementById("header-tabs")?.classList.remove("open");
        this.handleTabClick(btn);
      });
    });
  }

  handleTabClick(btn) {
    const tab = btn.dataset.tab;

    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".tab-content").forEach((content) => {
      content.classList.remove("active");
    });

    const tabContent = document.getElementById(`${tab}-tab`);
    if (tabContent) tabContent.classList.add("active");

    // Hide sidebars on non-calendar tabs
    const sidebar = document.querySelector(".sidebar");
    const timeslotsSidebar = document.querySelector(".timeslots-sidebar");
    const facilitySection = document.querySelector(".facility-section");
    const contentWrapper = document.querySelector(".content-wrapper");
    const mainContent = document.querySelector(".main-content");
    const isCalendar = tab === "calendar";
    const isMobile = window.innerWidth <= 768;

    if (sidebar) sidebar.style.display = isCalendar ? "" : "none";
    if (timeslotsSidebar)
      timeslotsSidebar.style.display = isCalendar ? "" : "none";
    if (facilitySection)
      facilitySection.style.display = isMobile && !isCalendar ? "none" : "";

    if (sidebar) sidebar.style.display = isCalendar ? "" : "none";
    if (timeslotsSidebar)
      timeslotsSidebar.style.display = isCalendar ? "" : "none";

    if (contentWrapper) {
      contentWrapper.style.gridTemplateColumns = isCalendar ? "" : "1fr";
    }
    if (mainContent) {
      const noScrollTabs = ["my-requests", "policy"];
      mainContent.classList.toggle(
        "fullscreen-tab",
        noScrollTabs.includes(tab),
      );
    }

    // Show/hide calendar header outer
    const calendarHeaderOuter = document.getElementById(
      "calendar-header-outer",
    );
    if (calendarHeaderOuter) {
      calendarHeaderOuter.style.display = isCalendar ? "" : "none";
    }

    // Show a timed loader for the calendar and keep the forecast loader until rendering finishes.
    if ((tab === "calendar" || tab === "forecast") && tabContent) {
      const loader = this._showTabLoader(tabContent, tab);
      if (tab === "forecast") {
        this.forecast.render().finally(() => loader?.remove());
      }
    }

    // Render My Requests when tab is clicked
    if (tab === "my-requests") {
      this.myRequests.render();
    }
  }

  _showTabLoader(tabContent, tab) {
    const existing = tabContent.querySelector(".tab-loader-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    const isForecast = tab === "forecast";
    overlay.className = `tab-loader-overlay${isForecast ? " forecast-tab-loader-overlay" : ""}`;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute(
      "aria-label",
      isForecast ? "Loading facility forecast" : "Loading calendar",
    );
    overlay.innerHTML = isForecast
      ? `
            <div class="tab-loader-inner forecast-tab-loader-inner">
                <div class="forecast-loader-chart" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span>
                </div>
                <strong>Preparing your forecast</strong>
                <span>Analyzing facility activity and predictions…</span>
            </div>
        `
      : `
            <div class="tab-loader-inner">
                <svg class="tab-loader-spinner" viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                </svg>
                <span>Loading calendar…</span>
            </div>
        `;
    tabContent.appendChild(overlay);

    if (!isForecast) {
      setTimeout(() => overlay.remove(), 1500);
    }

    return overlay;
  }

  /**
   * Setup auto-refresh when page regains focus
   * This updates the calendar when returning from admin panel
   */
  handleHashTab() {
    const hash = window.location.hash.replace("#", "");
    if (
      hash &&
      ["calendar", "my-requests", "forecast", "policy"].includes(hash)
    ) {
      const btn = document.querySelector(`.tab-btn[data-tab="${hash}"]`);
      if (btn) this.handleTabClick(btn);
    }
  }

  setupAutoRefresh() {
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      await loadData();
      this.calendar.render();
      this.timeSlots.render();
      refreshing = false;
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const app = new ReservationApp();
  app.init();
});
