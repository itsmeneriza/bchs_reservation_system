import express from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { createSupabaseClient } from "../services/supabaseClient.js";
import { formatTimeRange, parseTimeRange, isValidEventDate } from "../services/eventUtils.js";

const EVENT_SELECT =
  "id,title,event_date,start_time,end_time,facility_id,description,image,facilities(name)";

function getFacilityName(row) {
  const facility = Array.isArray(row.facilities)
    ? row.facilities[0]
    : row.facilities;
  return facility?.name || row.facility_id;
}

function toApiEvent(row) {
  return {
    id: String(row.id),
    title: row.title,
    date: row.event_date,
    time: formatTimeRange(row.start_time, row.end_time),
    facilityId: row.facility_id,
    location: getFacilityName(row),
    description: row.description,
    image: row.image || "",
  };
}

function validateEventInput(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return "Event details are required.";
  }
  if (typeof event.title !== "string" || !event.title.trim()) {
    return "An event title is required.";
  }
  if (!isValidEventDate(event.date)) {
    return "Enter a valid event date.";
  }
  if (typeof event.time !== "string" || !parseTimeRange(event.time)) {
    return "Enter a valid start and end time.";
  }
  if (
    (typeof event.location !== "string" || !event.location.trim()) &&
    (typeof event.facility_id !== "string" || !event.facility_id.trim())
  ) {
    return "Choose a facility for the event.";
  }
  if (
    event.facility_id !== undefined &&
    (typeof event.facility_id !== "string" || !event.facility_id.trim())
  ) {
    return "Choose a valid facility for the event.";
  }
  if (typeof event.description !== "string") {
    return "Enter an event description.";
  }
  if (event.image !== undefined && typeof event.image !== "string") {
    return "The event image must be text.";
  }
  return null;
}

async function getFacility(client, event) {
  const requestedFacility =
    typeof event.facility_id === "string" && event.facility_id.trim()
      ? event.facility_id
      : event.location;
  const id = requestedFacility.trim().toLowerCase();
  let { data, error } = await client
    .from("facilities")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    ({ data, error } = await client
      .from("facilities")
      .select("id,name")
      .ilike("name", requestedFacility.trim())
      .maybeSingle());
    if (error) throw error;
  }
  return data;
}

async function toDatabaseEvent(client, event, existing = null) {
  const times = parseTimeRange(event.time);
  const facility = await getFacility(client, event);
  if (!facility) {
    const error = new Error("The selected facility was not found in Supabase.");
    error.status = 400;
    throw error;
  }

  return {
    id: existing?.id || String(event.id || Date.now()),
    title: event.title.trim(),
    event_date: event.date,
    start_time: times.start,
    end_time: times.end,
    facility_id: facility.id,
    description: event.description.trim(),
    image: event.image === undefined
      ? existing?.image || ""
      : event.image,
    updated_at: new Date().toISOString(),
  };
}

function respondWithSupabaseError(res, error, action) {
  console.error(`Could not ${action} Supabase event:`, error);
  if (error.status) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error.code === "23505") {
    return res.status(409).json({ message: "An event with this ID already exists." });
  }
  if (error.code === "42501") {
    return res.status(403).json({ message: "Administrator access is required to manage events." });
  }
  return res.status(500).json({ message: `Could not ${action} event.` });
}

export function createEventsRouter() {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const { data, error } = await createSupabaseClient()
        .from("events")
        .select(EVENT_SELECT)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return res.json({ events: data.map(toApiEvent) });
    } catch (error) {
      console.error("Could not load Supabase events:", error);
      return res.status(error.status || 500).json({
        message: "Could not load events from Supabase. Check the events table and its read policy.",
      });
    }
  });

  router.post("/", requireAdmin, async (req, res) => {
    const validationMessage = validateEventInput(req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    try {
      const client = createSupabaseClient(req.accessToken);
      const eventToInsert = await toDatabaseEvent(client, req.body);
      const { data, error } = await client
        .from("events")
        .insert(eventToInsert)
        .select(EVENT_SELECT)
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, event: toApiEvent(data) });
    } catch (error) {
      return respondWithSupabaseError(res, error, "save");
    }
  });

  router.put("/:id", requireAdmin, async (req, res) => {
    const validationMessage = validateEventInput(req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    try {
      const client = createSupabaseClient(req.accessToken);
      const { data: existing, error: findError } = await client
        .from("events")
        .select("id,image")
        .eq("id", req.params.id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) {
        return res.status(404).json({ message: "Event not found." });
      }

      const eventToUpdate = await toDatabaseEvent(client, req.body, existing);
      const { data, error } = await client
        .from("events")
        .update(eventToUpdate)
        .eq("id", req.params.id)
        .select(EVENT_SELECT)
        .single();
      if (error) throw error;
      return res.json({ success: true, event: toApiEvent(data) });
    } catch (error) {
      return respondWithSupabaseError(res, error, "update");
    }
  });

  router.delete("/:id", requireAdmin, async (req, res) => {
    try {
      const { data, error } = await createSupabaseClient(req.accessToken)
        .from("events")
        .delete()
        .eq("id", req.params.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ message: "Event not found." });
      }
      return res.json({ success: true, message: "Event deleted successfully." });
    } catch (error) {
      return respondWithSupabaseError(res, error, "delete");
    }
  });

  return router;
}
