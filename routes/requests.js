const express = require("express");
const fs = require("fs");
const path = require("path");
const { parseDateOnly, formatDateOnly } = require("../scripts/DateUtils");
const { buildEmailHtml, buildDiffTable } = require("../scripts/EmailBuilder");
const transporterDefault = require("../services/mailer");

module.exports = function createRequestsRouter({
  dataDir,
  generateForecastFromData,
  transporter = transporterDefault,
}) {
  const router = express.Router();
  const repoDataDir = dataDir;
  const WEEKLY_ACTION_LIMIT = 3;
  const DAILY_RESCHEDULE_LIMIT = 1;
  const WEEKLY_RESCHEDULE_LIMIT = 3;

  function getLocalDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().slice(0, 10);
  }

  function getISOWeekKey(value) {
    const date = parseDateOnly(value);
    if (Number.isNaN(date.getTime())) return null;

    const isoDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dayNumber = isoDate.getDay() || 7;
    isoDate.setDate(isoDate.getDate() + 4 - dayNumber);
    const isoYear = isoDate.getFullYear();
    const yearStart = new Date(isoYear, 0, 1);
    const daysIntoYear = Math.floor((isoDate - yearStart) / 86400000) + 1;
    const week = Math.ceil(daysIntoYear / 7);
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }

  function getRequestUserKey(request) {
    const value = request.userId || request.contact || request.email;
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function countWeeklyActions(requests, userKey, action, weekKey) {
    const timestampField =
      action === "reservation" ? "submittedAt" : "cancellationRequestedAt";
    return requests.filter(
      (request) =>
        getRequestUserKey(request) === userKey &&
        getISOWeekKey(request[timestampField]) === weekKey,
    ).length;
  }

  function countUserRescheduleRequests(requests, userKey, dateKey, weekKey) {
    const dailyCount = requests.filter((request) => {
      if (getRequestUserKey(request) !== userKey) return false;
      if (request.status === "cancelled") return false;
      if (!request.rescheduleRequestedAt) return false;
      return getLocalDateKey(request.rescheduleRequestedAt) === dateKey;
    }).length;

    const weeklyCount = requests.filter((request) => {
      if (getRequestUserKey(request) !== userKey) return false;
      if (request.status === "cancelled") return false;
      if (!request.rescheduleRequestedAt) return false;
      return getISOWeekKey(request.rescheduleRequestedAt) === weekKey;
    }).length;

    return { dailyCount, weeklyCount };
  }

  // API endpoint to save new requests to requests.json
  router.post("/api/requests", (req, res) => {
    try {
      const newRequest = req.body;
      // Read current requests.json from repository-level data folder
      const requestsPath = path.join(repoDataDir, "requests.json");
      let requestsData = { requests: [] };
      if (fs.existsSync(requestsPath)) {
        requestsData = JSON.parse(fs.readFileSync(requestsPath, "utf8"));
      }

      // Ensure array exists
      if (!Array.isArray(requestsData.requests)) requestsData.requests = [];

      const userKey = getRequestUserKey(newRequest);
      if (!userKey) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "A user phone number or email is required to submit a reservation.",
          });
      }

      const submittedAt = new Date().toISOString();
      const weekKey = getISOWeekKey(submittedAt);
      const reservationCount = countWeeklyActions(
        requestsData.requests,
        userKey,
        "reservation",
        weekKey,
      );
      if (reservationCount >= WEEKLY_ACTION_LIMIT) {
        return res.status(429).json({
          success: false,
          limit: WEEKLY_ACTION_LIMIT,
          action: "reservation",
          message: `Weekly reservation limit reached. You can submit up to ${WEEKLY_ACTION_LIMIT} reservations per week.`,
        });
      }

      newRequest.userId = userKey;
      newRequest.submittedAt = submittedAt;

      // Add new request to the end
      requestsData.requests.push(newRequest);

      // Save back to file (repo-level)
      fs.writeFileSync(
        requestsPath,
        JSON.stringify(requestsData, null, 2),
        "utf8",
      );

      console.log("? New request saved:", newRequest.id);
      generateForecastFromData();

      res.status(200).json({
        success: true,
        message: "Request saved successfully",
        request: newRequest,
      });
    } catch (error) {
      console.error("? Error saving request:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save request",
        error: error.message,
      });
    }
  });

  // API endpoint to serve facilities data
  router.get("/api/facilities", (_req, res) => {
    try {
      const facilitiesPath = path.join(repoDataDir, "facilities.json");
      if (!fs.existsSync(facilitiesPath))
        return res.status(200).json({ facilities: [] });
      const data = JSON.parse(fs.readFileSync(facilitiesPath, "utf8"));
      res.status(200).json(data);
    } catch (error) {
      console.error("? Error reading facilities:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to read facilities",
          error: error.message,
        });
    }
  });

  // API endpoint to get all events
  router.get("/api/events", (_req, res) => {
    try {
      const eventsPath = path.join(repoDataDir, "events.json");
      if (!fs.existsSync(eventsPath))
        return res.status(200).json({ events: [] });
      const eventsData = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
      res.status(200).json(eventsData);
    } catch (error) {
      console.error("? Error reading events:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to read events",
          error: error.message,
        });
    }
  });

  // API endpoint to save new events to events.json
  router.post("/api/events", (req, res) => {
    try {
      const newEvent = req.body;
      const eventsPath = path.join(repoDataDir, "events.json");
      let eventsData = { events: [] };
      if (fs.existsSync(eventsPath)) {
        eventsData = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
      }
      if (!Array.isArray(eventsData.events)) eventsData.events = [];
      eventsData.events.push(newEvent);
      fs.writeFileSync(eventsPath, JSON.stringify(eventsData, null, 2), "utf8");

      console.log("? New event saved:", newEvent.id);
      res
        .status(200)
        .json({
          success: true,
          message: "Event saved successfully",
          event: newEvent,
        });
    } catch (error) {
      console.error("? Error saving event:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to save event",
          error: error.message,
        });
    }
  });

  // API endpoint to update an existing event (PUT)
  router.put("/api/events/:id", (req, res) => {
    try {
      const eventId = req.params.id;
      const updatedEvent = req.body;
      const eventsPath = path.join(repoDataDir, "events.json");
      if (!fs.existsSync(eventsPath))
        return res
          .status(404)
          .json({ success: false, message: "Events file not found" });
      const eventsData = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
      const idx = eventsData.events.findIndex(
        (e) => String(e.id) === String(eventId),
      );
      if (idx === -1)
        return res
          .status(404)
          .json({ success: false, message: `Event not found: ${eventId}` });
      eventsData.events[idx] = {
        ...eventsData.events[idx],
        ...updatedEvent,
        id: eventsData.events[idx].id,
      };
      fs.writeFileSync(eventsPath, JSON.stringify(eventsData, null, 2), "utf8");
      console.log("? Event updated:", eventId);
      res
        .status(200)
        .json({
          success: true,
          message: "Event updated successfully",
          event: eventsData.events[idx],
        });
    } catch (error) {
      console.error("? Error updating event:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to update event",
          error: error.message,
        });
    }
  });

  // API endpoint to delete an event
  router.delete("/api/events/:id", (req, res) => {
    try {
      const eventId = req.params.id;
      const eventsPath = path.join(repoDataDir, "events.json");
      if (!fs.existsSync(eventsPath))
        return res
          .status(404)
          .json({ success: false, message: "Events file not found" });
      const eventsData = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
      const before = eventsData.events.length;
      eventsData.events = eventsData.events.filter(
        (e) => String(e.id) !== String(eventId),
      );
      if (eventsData.events.length === before)
        return res
          .status(404)
          .json({ success: false, message: "Event not found" });
      fs.writeFileSync(eventsPath, JSON.stringify(eventsData, null, 2), "utf8");
      console.log("? Event deleted:", eventId);
      res
        .status(200)
        .json({ success: true, message: "Event deleted successfully" });
    } catch (error) {
      console.error("? Error deleting event:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to delete event",
          error: error.message,
        });
    }
  });

  // API endpoint to get all requests
  router.get("/api/requests", (_req, res) => {
    try {
      const requestsPath = path.join(repoDataDir, "requests.json");
      if (!fs.existsSync(requestsPath)) {
        return res.status(200).json({ requests: [] });
      }
      const requestsData = JSON.parse(fs.readFileSync(requestsPath, "utf8"));
      res.status(200).json(requestsData);
    } catch (error) {
      console.error("? Error reading requests:", error);
      res.status(500).json({
        success: false,
        message: "Failed to read requests",
        error: error.message,
      });
    }
  });

  // API endpoint to save accepted reservations to accepted.json
  router.post("/api/accepted", (req, res) => {
    try {
      const entry = req.body;
      const acceptedPath = path.join(repoDataDir, "accepted.json");
      let acceptedData = { accepted: [] };
      if (fs.existsSync(acceptedPath)) {
        acceptedData = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
      }
      if (!Array.isArray(acceptedData.accepted)) acceptedData.accepted = [];
      // Avoid duplicates
      if (!acceptedData.accepted.find((r) => r.id === entry.id)) {
        acceptedData.accepted.push(entry);
      }
      fs.writeFileSync(
        acceptedPath,
        JSON.stringify(acceptedData, null, 2),
        "utf8",
      );
      console.log("? Accepted reservation saved:", entry.id);
      res
        .status(200)
        .json({ success: true, message: "Accepted reservation saved", entry });
    } catch (error) {
      console.error("? Error saving accepted reservation:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to save accepted reservation",
          error: error.message,
        });
    }
  });

  // GET accepted reservations
  router.get("/api/accepted", (_req, res) => {
    try {
      const acceptedPath = path.join(repoDataDir, "accepted.json");
      if (!fs.existsSync(acceptedPath))
        return res.status(200).json({ accepted: [] });
      const data = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
      res.status(200).json(data);
    } catch (error) {
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to read accepted",
          error: error.message,
        });
    }
  });

  // DELETE an accepted reservation by id
  router.delete("/api/accepted/:id", (req, res) => {
    try {
      const entryId = req.params.id;
      const acceptedPath = path.join(repoDataDir, "accepted.json");
      if (!fs.existsSync(acceptedPath))
        return res.status(404).json({ success: false, message: "Not found" });
      const data = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
      const before = (data.accepted || []).length;
      data.accepted = (data.accepted || []).filter((r) => r.id !== entryId);
      if (data.accepted.length === before)
        return res
          .status(404)
          .json({ success: false, message: "Entry not found" });
      fs.writeFileSync(acceptedPath, JSON.stringify(data, null, 2), "utf8");
      console.log("? Accepted entry removed:", entryId);
      res
        .status(200)
        .json({ success: true, message: "Accepted entry removed" });
    } catch (error) {
      console.error("? Error removing accepted entry:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to remove accepted entry",
          error: error.message,
        });
    }
  });

  // API endpoint to delete a request (used for unblocking)
  router.delete("/api/requests/:id", (req, res) => {
    try {
      const requestId = req.params.id;
      const requestsPath = path.join(repoDataDir, "requests.json");
      if (!fs.existsSync(requestsPath))
        return res.status(404).json({ success: false, message: "Not found" });
      const requestsData = JSON.parse(fs.readFileSync(requestsPath, "utf8"));
      const before = requestsData.requests.length;
      requestsData.requests = requestsData.requests.filter(
        (r) => r.id !== requestId,
      );
      if (requestsData.requests.length === before)
        return res
          .status(404)
          .json({ success: false, message: "Request not found" });
      fs.writeFileSync(
        requestsPath,
        JSON.stringify(requestsData, null, 2),
        "utf8",
      );
      console.log("? Request deleted:", requestId);
      res.status(200).json({ success: true, message: "Request deleted" });
    } catch (error) {
      console.error("? Error deleting request:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to delete request",
          error: error.message,
        });
    }
  });

  // API endpoint to update request status
  router.patch("/api/requests/:id", (req, res) => {
    try {
      const requestId = req.params.id;
      const updates = req.body;

      // Read current requests.json
      const requestsPath = path.join(repoDataDir, "requests.json");
      const requestsData = fs.existsSync(requestsPath)
        ? JSON.parse(fs.readFileSync(requestsPath, "utf8"))
        : { requests: [] };
      const requestIndex = requestsData.requests.findIndex(
        (r) => r.id === requestId,
      );

      // Strip internal flag before saving (hoisted so it's available throughout)
      const { _editedByUser, rescheduleOptionIndex, ...cleanUpdates } = updates;

      const hasRescheduleFields = [
        "rescheduleReason",
        "rescheduledDate",
        "rescheduledStartTime",
        "rescheduledEndTime",
      ].some(
        (field) =>
          Object.prototype.hasOwnProperty.call(updates, field) &&
          updates[field] !== null,
      );

      if (hasRescheduleFields) {
        const reason = String(updates.rescheduleReason ?? "").trim();
        const date = String(updates.rescheduledDate ?? "").trim();
        const startTime = String(updates.rescheduledStartTime ?? "").trim();
        const endTime = String(updates.rescheduledEndTime ?? "").trim();

        if (!reason || !date || !startTime || !endTime) {
          return res.status(400).json({
            success: false,
            message:
              "Please provide a reschedule reason and a new date and time.",
          });
        }

        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
          startTime >= endTime
        ) {
          return res.status(400).json({
            success: false,
            message: "Please select a valid reschedule time range.",
          });
        }

        if (requestIndex !== -1) {
          const existing = requestsData.requests[requestIndex];
          const userKey = getRequestUserKey(existing);
          if (userKey) {
            const todayKey = getLocalDateKey(new Date().toISOString());
            const currentWeekKey = getISOWeekKey(new Date().toISOString());
            const counts = countUserRescheduleRequests(
              requestsData.requests,
              userKey,
              todayKey,
              currentWeekKey,
            );
            const isSameRequest =
              existing.rescheduleRequestedAt &&
              existing.rescheduledDate === date &&
              existing.rescheduledStartTime === startTime &&
              existing.rescheduledEndTime === endTime;
            if (!isSameRequest && counts.dailyCount >= DAILY_RESCHEDULE_LIMIT) {
              return res.status(429).json({
                success: false,
                limit: DAILY_RESCHEDULE_LIMIT,
                action: "reschedule",
                message: `Daily reschedule limit reached. You can request rescheduling ${DAILY_RESCHEDULE_LIMIT} time per day.`,
              });
            }
            if (
              !isSameRequest &&
              counts.weeklyCount >= WEEKLY_RESCHEDULE_LIMIT
            ) {
              return res.status(429).json({
                success: false,
                limit: WEEKLY_RESCHEDULE_LIMIT,
                action: "reschedule",
                message: `Weekly reschedule limit reached. You can request rescheduling up to ${WEEKLY_RESCHEDULE_LIMIT} times per week.`,
              });
            }
          }
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(updates, "rescheduleOptionIndex")
      ) {
        if (requestIndex === -1) {
          return res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }

        const existing = requestsData.requests[requestIndex];
        if (!["approved", "accepted"].includes(existing.status)) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Only an accepted reservation can use an alternate event schedule.",
            });
        }
        const options = Array.isArray(existing.rescheduleOptions)
          ? existing.rescheduleOptions
          : [];
        const optionIndex = rescheduleOptionIndex;
        const selectedOption = Number.isInteger(optionIndex)
          ? options[optionIndex]
          : null;
        if (!selectedOption) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "That alternate schedule is no longer available. Refresh and choose an available option.",
            });
        }

        const { date, startTime, endTime } = selectedOption;
        const validDate =
          typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
        const validTime = (value) =>
          typeof value === "string" &&
          /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (
          !validDate ||
          !validTime(startTime) ||
          !validTime(endTime) ||
          startTime >= endTime
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "The selected alternate schedule is invalid. Please contact the administration office.",
            });
        }
        const scheduleStart = new Date(`${date}T${startTime}:00`);
        const normalizedStartDate = Number.isNaN(scheduleStart.getTime())
          ? ""
          : `${scheduleStart.getFullYear()}-${String(scheduleStart.getMonth() + 1).padStart(2, "0")}-${String(scheduleStart.getDate()).padStart(2, "0")}`;
        if (
          !normalizedStartDate ||
          normalizedStartDate !== date ||
          scheduleStart <= new Date()
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "That alternate schedule is invalid or has passed. Please contact the administration office for new options.",
            });
        }

        const conflict = requestsData.requests.some((r) => {
          if (
            r.id === requestId ||
            !["approved", "accepted", "pending", "blocked"].includes(r.status)
          )
            return false;
          if (
            r.date !== date ||
            (r.facilityId !== existing.facilityId &&
              !(r.status === "blocked" && r.facilityId === "global"))
          )
            return false;
          if (r.status === "blocked" && r.isFullDayBlock) return true;
          return r.startTime < endTime && r.endTime > startTime;
        });
        if (conflict) {
          return res.status(409).json({
            success: false,
            message:
              "That alternate schedule is no longer available because it conflicts with another reservation or facility block. Please contact the administration office.",
          });
        }

        Object.assign(cleanUpdates, {
          date,
          startTime,
          endTime,
          rescheduleOptions: [],
          rescheduleReason: null,
          rescheduleRequestedAt: null,
          rescheduledDate: null,
          rescheduledStartTime: null,
          rescheduledEndTime: null,
          rescheduleFinalizedAt: new Date().toISOString(),
        });
      }

      if (requestIndex !== -1 && hasRescheduleFields) {
        const existing = requestsData.requests[requestIndex];
        const facilityId = existing.facilityId || updates.facilityId;
        const date = String(
          updates.rescheduledDate ?? existing.date ?? "",
        ).trim();
        const startTime = String(
          updates.rescheduledStartTime ?? existing.startTime ?? "",
        ).trim();
        const endTime = String(
          updates.rescheduledEndTime ?? existing.endTime ?? "",
        ).trim();

        if (facilityId && date && startTime && endTime) {
          const conflict = requestsData.requests.some((r) => {
            if (r.id === requestId) return false;
            if (
              !["approved", "accepted", "pending", "blocked"].includes(r.status)
            )
              return false;
            if (
              (r.facilityId !== facilityId &&
                !(r.status === "blocked" && r.facilityId === "global")) ||
              r.date !== date
            )
              return false;
            if (r.status === "blocked" && r.isFullDayBlock) return true;
            return r.startTime < endTime && r.endTime > startTime;
          });

          if (conflict) {
            return res.status(409).json({
              success: false,
              message:
                "This reschedule conflicts with another approved or blocked reservation.",
            });
          }
        }
      }

      if (updates.status === "cancelled" && updates.cancellationRequestedAt) {
        if (requestIndex === -1) {
          return res
            .status(404)
            .json({ success: false, message: "Request not found" });
        }

        const existing = requestsData.requests[requestIndex];
        if (existing.status !== "cancelled") {
          const userKey = getRequestUserKey(existing);
          if (!userKey) {
            return res
              .status(400)
              .json({
                success: false,
                message: "Unable to identify the reservation owner.",
              });
          }

          const cancellationCount = countWeeklyActions(
            requestsData.requests,
            userKey,
            "cancellation",
            getISOWeekKey(new Date().toISOString()),
          );
          if (cancellationCount >= WEEKLY_ACTION_LIMIT) {
            return res.status(429).json({
              success: false,
              limit: WEEKLY_ACTION_LIMIT,
              action: "cancellation",
              message: `Weekly cancellation limit reached. You can cancel up to ${WEEKLY_ACTION_LIMIT} reservations per week.`,
            });
          }

          updates.cancellationRequestedAt = new Date().toISOString();
          cleanUpdates.cancellationRequestedAt =
            updates.cancellationRequestedAt;
        }
      }

      if (requestIndex === -1) {
        // Not in requests.json yet � insert as new entry with updates applied
        requestsData.requests.push({ id: requestId, ...cleanUpdates });
      } else {
        const existing = requestsData.requests[requestIndex];
        // Prevent downgrading payment tracking from PAID to a non-paid value
        if (
          existing.paymentStatus === "paid" &&
          cleanUpdates.paymentStatus !== undefined &&
          cleanUpdates.paymentStatus !== "paid"
        ) {
          return res
            .status(400)
            .json({
              success: false,
              message: "Cannot change payment tracking from PAID to non-paid.",
            });
        }
        const isUserEdit = updates._editedByUser === true;

        // Track changed fields
        const TRACKED_FIELDS = [
          "facilityId",
          "facilityName",
          "date",
          "startTime",
          "endTime",
          "attendees",
          "purpose",
          "appointmentDate",
          "appointmentTime",
          "totalAmount",
        ];
        // Fields where we compare case-insensitively (facility names can vary in casing)
        const CASE_INSENSITIVE = new Set(["facilityId", "facilityName"]);

        // Normalize a value to a canonical string for comparison.
        // Treats null, undefined, and "" as equivalent (all ? "").
        const normalize = (v) => {
          if (
            v === null ||
            v === undefined ||
            v === "null" ||
            v === "undefined"
          )
            return "";
          return String(v).trim();
        };

        const changed = {};
        TRACKED_FIELDS.forEach((field) => {
          if (cleanUpdates[field] === undefined) return;
          const newVal = normalize(cleanUpdates[field]);
          const oldVal = normalize(existing[field]);
          const isDifferent = CASE_INSENSITIVE.has(field)
            ? newVal.toLowerCase() !== oldVal.toLowerCase()
            : newVal !== oldVal;
          if (isDifferent) {
            changed[field] = {
              before: existing[field],
              after: cleanUpdates[field],
            };
          }
        });

        const changedAt = new Date().toISOString();

        // Normalize facilityName casing � if the incoming facilityName differs only in case
        // from the existing one, keep the existing casing to avoid spurious change detection.
        if (
          cleanUpdates.facilityName !== undefined &&
          String(cleanUpdates.facilityName).toLowerCase() ===
            String(existing.facilityName ?? "").toLowerCase()
        ) {
          cleanUpdates.facilityName = existing.facilityName;
        }
        if (
          cleanUpdates.facilityId !== undefined &&
          String(cleanUpdates.facilityId).toLowerCase() ===
            String(existing.facilityId ?? "").toLowerCase()
        ) {
          cleanUpdates.facilityId = existing.facilityId;
        }

        // User edit ? write userEditSnapshot, leave adminEditSnapshot untouched
        // Admin edit ? write adminEditSnapshot, leave userEditSnapshot untouched
        const userEditSnapshot =
          isUserEdit && Object.keys(changed).length > 0
            ? { changedAt, changes: changed }
            : existing.userEditSnapshot;

        const adminEditSnapshot =
          !isUserEdit && Object.keys(changed).length > 0
            ? { changedAt, changes: changed }
            : existing.adminEditSnapshot;

        // Normalize and deduplicate any reschedule options sent by the admin to avoid duplicated time entries
        if (Array.isArray(cleanUpdates.rescheduleOptions)) {
          const seen = new Set();
          cleanUpdates.rescheduleOptions =
            cleanUpdates.rescheduleOptions.filter((opt) => {
              const date = String(opt.date || "").trim();
              const start = String(opt.startTime || opt.time || "").trim();
              const end = String(opt.endTime || "").trim();
              const key = `${date}::${start}::${end}`;
              // Skip invalid entries
              if (!date || !start) return false;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
        }

        requestsData.requests[requestIndex] = {
          ...existing,
          ...cleanUpdates,
          userEditSnapshot,
          adminEditSnapshot,
        };

        // Send email notification if trackable fields changed and user has an email
        // Send email notification only for admin edits (not user self-edits)
        if (!isUserEdit && Object.keys(changed).length > 0 && existing.email) {
          const updatedReq = { ...existing, ...cleanUpdates };
          const LABELS = {
            facilityName: "Facility",
            date: "Event Date",
            startTime: "Start Time",
            endTime: "End Time",
            appointmentDate: "Visit Date",
            appointmentTime: "Visit Time",
            totalAmount: "Total Amount",
          };
          const fmt = (field, val) => {
            if (!val && val !== 0) return "�";
            if (field === "totalAmount")
              return `?${parseFloat(val).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
            if (field === "date" || field === "appointmentDate")
              return formatDateOnly(val) || val;
            return val;
          };
          const editRows = Object.entries(changed)
            .filter(([f]) => f !== "facilityId")
            .map(([field, { before, after }]) => ({
              field,
              before: fmt(field, before),
              after: fmt(field, after),
            }));
          if (editRows.length) {
            transporter
              .sendMail({
                from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
                to: existing.email,
                subject: `Your Reservation Was Updated: ${updatedReq.facilityName || "Facility"} on ${formatDateOnly(updatedReq.date || existing.date) || updatedReq.date || existing.date}`,
                html: buildEmailHtml(
                  "Reservation Updated by Admin",
                  `<p>Dear <strong>${existing.name || "Requester"}</strong>,</p>
                 <p>The administration has made changes to your reservation for <strong>${updatedReq.facilityName || "Facility"}</strong> on <strong>${formatDateOnly(updatedReq.date || existing.date) || updatedReq.date || existing.date}</strong>.</p>
                 ${buildDiffTable(editRows, LABELS)}
                 <p>If you have questions, please contact the Administration Office.</p>`,
                ),
              })
              .then(() =>
                console.log(`? Edit notice sent to ${existing.email}`),
              )
              .catch((e) =>
                console.warn(
                  `[WARN] Edit notice failed for ${existing.email}:`,
                  e.message,
                ),
              );
          }
        }
      }

      fs.writeFileSync(
        requestsPath,
        JSON.stringify(requestsData, null, 2),
        "utf8",
      );

      // If status is being set to approved, also save to accepted.json
      const saved = requestsData.requests.find((r) => r.id === requestId);
      if (saved && ["approved", "accepted"].includes(saved.status)) {
        const acceptedPath = path.join(repoDataDir, "accepted.json");
        let acceptedData = { accepted: [] };
        if (fs.existsSync(acceptedPath)) {
          acceptedData = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
        }
        if (!Array.isArray(acceptedData.accepted)) acceptedData.accepted = [];
        const existingIdx = acceptedData.accepted.findIndex(
          (r) => r.id === requestId,
        );
        if (existingIdx === -1) acceptedData.accepted.push(saved);
        else acceptedData.accepted[existingIdx] = saved;
        fs.writeFileSync(
          acceptedPath,
          JSON.stringify(acceptedData, null, 2),
          "utf8",
        );
        console.log(
          "? Request approved and saved to accepted.json:",
          requestId,
        );
      }

      console.log("? Request updated:", requestId);
      generateForecastFromData();

      res.status(200).json({
        success: true,
        message: "Request updated successfully",
        request: saved,
      });
    } catch (error) {
      console.error("? Error updating request:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update request",
        error: error.message,
      });
    }
  });
  return router;
};
