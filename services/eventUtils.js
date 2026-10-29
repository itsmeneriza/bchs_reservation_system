export function parseTimeRange(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) return null;

  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  if (!start || !end || start >= end) return null;
  return { start, end };
}

function parseTime(value) {
  const normalized = value.trim();
  const twelveHour = normalized.match(
    /^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i,
  );
  if (twelveHour) {
    let hours = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") hours += 12;
    return `${String(hours).padStart(2, "0")}:${twelveHour[2]}:00`;
  }

  const twentyFourHour = normalized.match(
    /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/,
  );
  if (!twentyFourHour) return null;
  return `${twentyFourHour[1]}:${twentyFourHour[2]}:${twentyFourHour[3] || "00"}`;
}

function formatTime(value) {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${suffix}`;
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

export function isValidEventDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
