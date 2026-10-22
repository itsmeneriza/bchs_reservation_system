import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseTimeRange, isValidEventDate } from "../services/eventUtils.js";

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const eventsPath = path.join(projectDir, "data", "events.json");
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the project .env file.");
}

if (!fs.existsSync(eventsPath)) {
  throw new Error(`Could not find the existing events file: ${eventsPath}`);
}

const source = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
if (!Array.isArray(source.events)) {
  throw new Error("data/events.json must contain an events array.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: facilities, error: facilitiesError } = await supabase
  .from("facilities")
  .select("id,name");
if (facilitiesError) {
  throw new Error(`Could not read facilities from Supabase: ${facilitiesError.message}`);
}

const facilitiesByName = new Map();
for (const facility of facilities) {
  facilitiesByName.set(facility.id.toLowerCase(), facility);
  facilitiesByName.set(facility.name.trim().toLowerCase(), facility);
}

const rows = source.events.map((event) => {
  const facility = facilitiesByName.get(String(event.location || "").trim().toLowerCase());
  const time = parseTimeRange(event.time);
  if (!facility) {
    throw new Error(`Event "${event.title}" has an unknown facility: "${event.location}".`);
  }
  if (!isValidEventDate(event.date)) {
    throw new Error(`Event "${event.title}" has an invalid date: "${event.date}".`);
  }
  if (!time) {
    throw new Error(`Event "${event.title}" has an invalid time range: "${event.time}".`);
  }

  return {
    id: String(event.id),
    title: String(event.title).trim(),
    event_date: event.date,
    start_time: time.start,
    end_time: time.end,
    facility_id: facility.id,
    description: typeof event.description === "string" ? event.description : "",
    image: typeof event.image === "string" ? event.image : "",
  };
});

const { data: existingEvents, error: existingError } = await supabase
  .from("events")
  .select("id");
if (existingError) {
  throw new Error(`Could not check the Supabase events table: ${existingError.message}`);
}
if (existingEvents.length) {
  throw new Error(
    `The Supabase events table already contains ${existingEvents.length} row(s). ` +
    "Import stopped to avoid overwriting data. Resolve existing rows before running this script.",
  );
}

if (rows.length) {
  const { error } = await supabase.from("events").insert(rows);
  if (error) {
    throw new Error(`Could not import events: ${error.message}`);
  }
}

console.log(`Imported ${rows.length} event(s) from data/events.json into Supabase.`);
