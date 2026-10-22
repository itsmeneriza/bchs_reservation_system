import express from "express";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../middleware/requireAdmin.js";

export function createEventsRouter(eventsFilePath) {
  const router = express.Router();

  function readEvents() {
    if (!fs.existsSync(eventsFilePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(eventsFilePath, "utf8"));
    if (!Array.isArray(parsed.events)) {
      throw new Error("The events file must contain an events array.");
    }
    return parsed.events;
  }

  function writeEvents(events) {
    fs.writeFileSync(
      eventsFilePath,
      JSON.stringify({ events }, null, 2),
      "utf8",
    );
  }

  function validEvent(event) {
    return (
      event &&
      typeof event.title === "string" &&
      event.title.trim() &&
      typeof event.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
      typeof event.time === "string" &&
      event.time.trim() &&
      typeof event.location === "string" &&
      event.location.trim() &&
      typeof event.description === "string"
    );
  }

  router.get("/", (_req, res) => {
    try {
      return res.json({ events: readEvents() });
    } catch (error) {
      console.error("Could not read events:", error);
      return res.status(500).json({ message: "Could not load events." });
    }
  });

  router.post("/", requireAdmin, (req, res) => {
    if (!validEvent(req.body)) {
      return res.status(400).json({ message: "The event details are incomplete or invalid." });
    }

    try {
      const events = readEvents();
      const id = String(req.body.id || Date.now());
      if (events.some((event) => String(event.id) === id)) {
        return res.status(409).json({ message: "An event with this ID already exists." });
      }

      const event = {
        ...req.body,
        id,
        title: req.body.title.trim(),
        location: req.body.location.trim(),
        description: req.body.description.trim(),
        attendees: Number.isFinite(Number(req.body.attendees))
          ? Number(req.body.attendees)
          : 0,
        image: typeof req.body.image === "string" ? req.body.image : "",
      };
      events.push(event);
      writeEvents(events);
      return res.status(201).json({ success: true, event });
    } catch (error) {
      console.error("Could not save event:", error);
      return res.status(500).json({ message: "Could not save the event." });
    }
  });

  router.put("/:id", requireAdmin, (req, res) => {
    if (!validEvent(req.body)) {
      return res.status(400).json({ message: "The event details are incomplete or invalid." });
    }

    try {
      const events = readEvents();
      const index = events.findIndex(
        (event) => String(event.id) === String(req.params.id),
      );
      if (index === -1) {
        return res.status(404).json({ message: "Event not found." });
      }

      const event = {
        ...events[index],
        ...req.body,
        id: events[index].id,
        title: req.body.title.trim(),
        location: req.body.location.trim(),
        description: req.body.description.trim(),
        attendees: Number.isFinite(Number(req.body.attendees))
          ? Number(req.body.attendees)
          : 0,
        image: typeof req.body.image === "string" ? req.body.image : "",
      };
      events[index] = event;
      writeEvents(events);
      return res.json({ success: true, event });
    } catch (error) {
      console.error("Could not update event:", error);
      return res.status(500).json({ message: "Could not update the event." });
    }
  });

  router.delete("/:id", requireAdmin, (req, res) => {
    try {
      const events = readEvents();
      const remainingEvents = events.filter(
        (event) => String(event.id) !== String(req.params.id),
      );
      if (remainingEvents.length === events.length) {
        return res.status(404).json({ message: "Event not found." });
      }
      writeEvents(remainingEvents);
      return res.json({ success: true, message: "Event deleted successfully." });
    } catch (error) {
      console.error("Could not delete event:", error);
      return res.status(500).json({ message: "Could not delete the event." });
    }
  });

  return router;
}

export function getEventsFilePath(projectDir) {
  return path.join(projectDir, "data", "events.json");
}
