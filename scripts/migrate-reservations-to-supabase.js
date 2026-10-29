import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServiceRoleSupabaseClient } from "../services/supabaseClient.js";
import { toDbReservation } from "../routes/requests.js";

const dataDirectory = join(process.cwd(), "data");

function readRecords(fileName, propertyName) {
  const filePath = join(dataDirectory, fileName);
  if (!existsSync(filePath)) {
    console.log(`Skipping ${fileName}; file not found.`);
    return [];
  }

  const data = JSON.parse(readFileSync(filePath, "utf8"));
  const records = Array.isArray(data) ? data : data[propertyName];
  if (!Array.isArray(records)) {
    throw new Error(`${fileName} does not contain a ${propertyName} array.`);
  }
  return records;
}

function stableCode(record, group, index) {
  const code = String(record.reservationCode || record.id || "").trim();
  const fallback = `legacy_${group}_${index + 1}`;
  const resolved = code || fallback;
  if (resolved.length > 50) {
    throw new Error(`Reservation code exceeds 50 characters: ${resolved}`);
  }
  return resolved;
}

function loadLegacyReservations() {
  const records = new Map();
  const sources = [
    ["requests.json", "requests", "requests"],
    ["accepted.json", "accepted", "accepted"],
    ["history.json", "history", "history"],
  ];

  for (const [fileName, propertyName, group] of sources) {
    const entries = readRecords(fileName, propertyName);
    entries.forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        console.warn(`Skipping invalid ${fileName} entry at index ${index}.`);
        return;
      }
      const id = stableCode(record, group, index);
      const normalized = {
        ...record,
        id,
        reservationCode: id,
      };
      if (group === "accepted" || (group === "history" && !record.status)) {
        normalized.status = "approved";
      }
      records.set(id, normalized);
    });
  }
  return [...records.values()];
}

function validateReservation(payload) {
  if (
    !payload.date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
    !payload.start_time ||
    !payload.end_time ||
    payload.start_time >= payload.end_time
  ) {
    return "missing or invalid date/time";
  }
  if (!payload.contact || payload.contact.length > 20) {
    return "missing or overlong contact";
  }
  if (!payload.facility_id && payload.request_data.facilityId !== "global") {
    return "missing facility";
  }
  return null;
}

async function migrate() {
  const reservations = loadLegacyReservations();
  const client = createServiceRoleSupabaseClient();
  let imported = 0;
  let skipped = 0;
  const failures = [];

  for (const reservation of reservations) {
    const payload = toDbReservation(reservation);
    const validationError = validateReservation(payload);
    if (validationError) {
      skipped++;
      console.warn(
        `Skipping ${payload.reservation_code}: ${validationError}.`,
      );
      continue;
    }

    const { data, error } = await client
      .from("reservations")
      .upsert(payload, {
        onConflict: "reservation_code",
        ignoreDuplicates: true,
      })
      .select("reservation_code")
      .maybeSingle();
    if (error) {
      skipped++;
      failures.push({ id: payload.reservation_code, message: error.message });
      console.error(`Could not migrate ${payload.reservation_code}:`, error);
      continue;
    }
    if (data) imported++;
    else skipped++;
  }

  console.log(
    `Reservation migration finished: ${imported} imported, ${skipped} skipped (including existing rows).`,
  );
  if (failures.length) {
    console.error("Migration failures:", failures);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  migrate().catch((error) => {
    console.error("Reservation migration failed:", error);
    process.exitCode = 1;
  });
}
