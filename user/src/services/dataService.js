/**
 * Data Service
 * Loads and manages all application data
 */

import { parseEventTime } from "../utils/dateUtils.js";

export class DataService {
  constructor() {
    this.facilities = [];
    this.reservations = [];
    this.forecast = null;

    this.facilityImages = {
      auditorium: [
        "/data/facility pics/Auditorium from stage view.jpg",
        "/data/facility pics/Auditorium_stage.jpg",
        "/data/facility pics/Auditorium from the back.jpg",
      ],
      library: [
        "/data/facility pics/Library full.jpg",
        "/data/facility pics/Library from right look to left.jpg",
        "/data/facility pics/Library right side.jpg",
      ],
      grounds: [
        "/data/facility pics/Grounds from stage.jpg",
        "/data/facility pics/Grounds_fromtopstage.jpg",
      ],
      avr: [
        "/data/facility pics/AVR_from entrance.jpg",
        "/data/facility pics/AVR_from stage.jpg",
      ],
      gym: ["/data/facility pics/gym from back.jpg"],
    };
  }

  async loadAllData() {
    try {
      // Load facilities, reservations in parallel — skip forecast (deferred)
      await Promise.all([this.loadFacilities(), this.loadReservations()]);
      return true;
    } catch (error) {
      console.error("Could not load reservation data:", error);
      return false;
    }
  }

  async loadAllDataWithForecast() {
    await this.loadForecast();
  }

  async loadFacilities() {
    const response = await fetch("/api/facilities");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Facilities API returned ${response.status}.`);
    }
    if (!Array.isArray(data.facilities) || data.facilities.length === 0) {
      throw new Error("No facilities are available in the Supabase facilities table.");
    }
    this.facilities = data.facilities;
  }

  async loadReservations() {
    const [requestsRes, eventsRes] = await Promise.all([
      fetch("/api/requests/availability"),
      fetch("/api/events"),
    ]);

    // Exclude linked event reservations (id starts with 'event_')
    // Those are already represented via the /api/events fetch as 'evt_' entries.
    let apiRequests = [];
    if (requestsRes.ok) {
      const data = await requestsRes.json();
      apiRequests = (data.reservations || []).filter((r) => {
        const id = typeof r?.id === "string" ? r.id : "";
        return !id.startsWith("event_") && !id.startsWith("evt_");
      });
    } else {
      throw new Error(`Availability API returned ${requestsRes.status}.`);
    }

    // Events
    let eventReservations = [];
    if (eventsRes.ok) {
      const data = await eventsRes.json();
      eventReservations = (data.events || []).map((ev) => {
        const [start, end] = this._parseEventTime(ev.time);
        const facilityId = ev.facilityId || ev.location.toLowerCase();
        return {
          id: "evt_" + ev.id,
          facilityId,
          facilityName: ev.location,
          name: ev.title,
          contact: "School Event",
          email: "admin@bchs.edu",
          date: ev.date,
          startTime: start,
          endTime: end,
          purpose: ev.description || ev.title,
          status: "approved",
          paymentStatus: "paid",
          totalAmount: 0,
          isSchoolEvent: true,
          submittedAt: ev.date + "T00:00:00.000Z",
        };
      });
    }

    // Merge event entries with the canonical Supabase reservations.
    const merged = [...apiRequests];
    eventReservations.forEach((entry) => {
      if (!merged.find((b) => b.id === entry.id)) merged.push(entry);
    });

    this.reservations = merged;
  }

  /**
   * Parse "9:00 AM - 4:00 PM" → ["09:00", "16:00"]
   * Delegates to shared parseEventTime from dateUtils.js.
   */
  _parseEventTime(timeStr) {
    return parseEventTime(timeStr);
  }

  async loadForecast() {
    try {
      const response = await fetch("/api/forecast");
      const data = await response.json();
      this.forecast = data.forecast;
    } catch (e) {
      this.forecast = null;
    }
  }

  getFacilities() {
    return this.facilities;
  }
  getReservations() {
    return this.reservations;
  }
  getForecast() {
    return this.forecast;
  }

  getFacilityImage(facilityId, index = 0) {
    const images = this.facilityImages[facilityId];
    if (!images || images.length === 0)
      return "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=1200&auto=format&fit=crop";
    return images[index] || images[0];
  }

  getFacilityImageCount(facilityId) {
    return this.facilityImages[facilityId]?.length || 0;
  }

  getReservationsForFacility(facilityId) {
    return this.reservations.filter((b) => b.facilityId === facilityId);
  }
}

export const dataService = new DataService();
