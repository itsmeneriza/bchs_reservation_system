import express from "express";
import { verifySessionToken } from "./auth.js";
import {
  createServiceRoleSupabaseClient,
  createSupabaseClient,
} from "../services/supabaseClient.js";
import { consumeCancellationOtp } from "../services/cancellationOtpStore.js";

const INTERNAL_FIELDS = new Set([
  "_editedByUser",
  "_isEdit",
  "rescheduleOptionIndex",
]);
const PENDING_USER_EDIT_LIMIT = 3;

function nullableDate(value) {
  if (typeof value !== "string") return value ?? null;
  return value.trim() || null;
}

function isGroundsFacilityId(value) {
  return String(value || "").trim().toLowerCase() === "grounds";
}

function isWeekendDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function getManilaDateParts(now = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
}

function getNextWeekMondayDate(now = new Date()) {
  const parts = getManilaDateParts(now);
  const todayUtc = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
    ),
  );
  const day = todayUtc.getUTCDay();
  const mondayOffset = ((day + 6) % 7);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - mondayOffset + 7);
  return [
    todayUtc.getUTCFullYear(),
    String(todayUtc.getUTCMonth() + 1).padStart(2, "0"),
    String(todayUtc.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function isBeforeNextWeek(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return true;
  }
  return value < getNextWeekMondayDate();
}

function getTimeMinutes(value) {
  if (typeof value !== "string") return null;
  const rangeStart = value.split(/\s*[–-]\s*/)[0].trim();
  const match = rangeStart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    const period = match[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

function isExpiredVisitSlot(row, now = new Date()) {
  // Forced-reschedule rows use a past appointment as an admin workflow marker.
  if (
    !row.appointment_date ||
    !row.appointment_time ||
    row.block_reschedule_pending
  ) {
    return false;
  }

  const date = String(row.appointment_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return false;
  }

  const visitMinutes = getTimeMinutes(row.appointment_time);
  if (visitMinutes === null) return false;
  const currentParts = getManilaDateParts(now);
  const currentDate = `${currentParts.year}-${currentParts.month}-${currentParts.day}`;
  if (date !== currentDate) return date < currentDate;

  return (
    visitMinutes <=
    Number(currentParts.hour) * 60 + Number(currentParts.minute)
  );
}

async function clearExpiredVisitSlot(client, row) {
  if (!isExpiredVisitSlot(row)) return row;

  const { data, error } = await client
    .from("reservations")
    .update({
      appointment_date: null,
      appointment_time: null,
    })
    .eq("reservation_code", row.reservation_code)
    .eq("appointment_date", row.appointment_date)
    .eq("appointment_time", row.appointment_time)
    .select(RESERVATION_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: current, error: reloadError } = await client
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("reservation_code", row.reservation_code)
    .maybeSingle();
  if (reloadError) throw reloadError;
  return current || row;
}

function daysUntilDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const eventDate = new Date(Date.UTC(year, month - 1, day));
  if (
    eventDate.getUTCFullYear() !== year ||
    eventDate.getUTCMonth() !== month - 1 ||
    eventDate.getUTCDate() !== day
  ) {
    return null;
  }

  const today = getManilaDateParts();
  const todayUtc = Date.UTC(
    Number(today.year),
    Number(today.month) - 1,
    Number(today.day),
  );
  return Math.round((eventDate.getTime() - todayUtc) / 86400000);
}

export function toDbReservation(payload = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const source = String(
    body.source ||
      (body.isStaff === true || body.is_staff === true ? "staff" : "guest"),
  )
    .trim()
    .toLowerCase();
  const userType =
    source === "staff" ||
    body.isStaff === true ||
    body.is_staff === true
      ? "staff"
      : "guest";
  const id = String(body.id || body.reservationCode || "");
  const requestData = Object.fromEntries(
    Object.entries(body).filter(([key]) => !INTERNAL_FIELDS.has(key)),
  );
  if (Object.hasOwn(requestData, "date")) {
    requestData.date = nullableDate(requestData.date);
  }
  if (Object.hasOwn(requestData, "appointmentDate")) {
    requestData.appointmentDate = nullableDate(requestData.appointmentDate);
  }
  if (Object.hasOwn(requestData, "appointment_date")) {
    requestData.appointment_date = nullableDate(
      requestData.appointment_date,
    );
  }

  const reservation = {
    reservation_code: String(body.reservationCode || id),
    facility_id:
      body.facilityId === "global" || body.facility_id === "global"
        ? null
        : body.facilityId || body.facility_id || null,
    user_type: userType,
    staff_id: body.staffId ?? body.staff_id ?? null,
    guest_id: body.guestId ?? body.guest_id ?? null,
    source: ["staff", "guest", "walk_in"].includes(source)
      ? source
      : userType,
    name: String(body.name || "Guest").trim(),
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    contact:
      (typeof (body.contact || body.phone) === "string"
        ? (body.contact || body.phone).trim()
        : "") || (source === "walk_in" ? "ADMIN" : ""),
    is_staff: userType === "staff",
    date: nullableDate(body.date),
    start_time: body.startTime || body.start_time || null,
    end_time: body.endTime || body.end_time || null,
    attendees: body.attendees ?? null,
    purpose: body.purpose || "",
    additional_notes: body.additionalNotes ?? body.additional_notes ?? null,
    status: body.status || "pending",
    payment_status:
      userType === "staff"
        ? "free"
        : body.paymentStatus || body.payment_status || "unpaid",
    appointment_date: nullableDate(
      body.appointmentDate ?? body.appointment_date,
    ),
    appointment_time: body.appointmentTime ?? body.appointment_time ?? null,
    total_amount: Number(body.totalAmount ?? body.total_amount ?? 0),
    down_payment_paid: Boolean(
      body.downPaymentPaid ?? body.down_payment_paid ?? false,
    ),
    remaining_balance_paid: Boolean(
      body.remainingBalancePaid ?? body.remaining_balance_paid ?? false,
    ),
    block_reschedule_pending: Boolean(
      body.blockReschedulePending ?? body.block_reschedule_pending ?? false,
    ),
    block_reschedule_reason:
      body.blockRescheduleReason ?? body.block_reschedule_reason ?? null,
    admin_edit_snapshot:
      body.adminEditSnapshot ?? body.admin_edit_snapshot ?? null,
    request_data: requestData,
    submitted_at: body.submittedAt || body.submitted_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Staff reservations are payment-exempt. Do not rely on the browser to
  // submit the correct amount or payment status.
  if (userType === "staff") {
    reservation.payment_status = "free";
    reservation.total_amount = 0;
    reservation.down_payment_paid = false;
    reservation.remaining_balance_paid = false;
  }

  return reservation;
}

export function fromDbReservation(row) {
  const facility = Array.isArray(row.facilities)
    ? row.facilities[0]
    : row.facilities;

  return {
    ...(row.request_data || {}),
    id: row.reservation_code || String(row.id),
    reservationCode: row.reservation_code || String(row.id),
    facilityId: row.facility_id || row.request_data?.facilityId || "global",
    facilityName:
      facility?.name || row.request_data?.facilityName || row.facility_id || "",
    source: row.source,
    userType: row.user_type,
    staffId: row.staff_id,
    guestId: row.guest_id,
    name: row.name,
    email: row.email,
    contact: row.contact,
    isStaff: row.is_staff,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    attendees: row.attendees,
    purpose: row.purpose,
    additionalNotes: row.additional_notes,
    status: row.status,
    paymentStatus:
      row.is_staff || row.user_type === "staff" || row.source === "staff"
        ? "free"
        : row.payment_status,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    totalAmount: Number(row.total_amount ?? 0),
    downPaymentPaid: row.down_payment_paid,
    remainingBalancePaid: row.remaining_balance_paid,
    blockReschedulePending: row.block_reschedule_pending,
    blockRescheduleReason: row.block_reschedule_reason,
    adminEditSnapshot: row.admin_edit_snapshot,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

const RESERVATION_SELECT = "*, facilities(name)";

const PATCH_FIELD_ALIASES = {
  facility_id: ["facilityId", "facility_id"],
  user_type: ["userType", "user_type", "isStaff", "is_staff", "source"],
  staff_id: ["staffId", "staff_id"],
  guest_id: ["guestId", "guest_id"],
  source: ["source"],
  name: ["name"],
  email: ["email"],
  contact: ["contact", "phone"],
  is_staff: ["isStaff", "is_staff", "source"],
  date: ["date"],
  start_time: ["startTime", "start_time"],
  end_time: ["endTime", "end_time"],
  attendees: ["attendees"],
  purpose: ["purpose"],
  additional_notes: ["additionalNotes", "additional_notes"],
  status: ["status"],
  payment_status: ["paymentStatus", "payment_status"],
  appointment_date: ["appointmentDate", "appointment_date"],
  appointment_time: ["appointmentTime", "appointment_time"],
  total_amount: ["totalAmount", "total_amount"],
  down_payment_paid: ["downPaymentPaid", "down_payment_paid"],
  remaining_balance_paid: [
    "remainingBalancePaid",
    "remaining_balance_paid",
  ],
  block_reschedule_pending: [
    "blockReschedulePending",
    "block_reschedule_pending",
  ],
  block_reschedule_reason: [
    "blockRescheduleReason",
    "block_reschedule_reason",
  ],
  admin_edit_snapshot: ["adminEditSnapshot", "admin_edit_snapshot"],
  submitted_at: ["submittedAt", "submitted_at"],
};

function toDbReservationPatch(existing, changes) {
  const merged = {
    ...fromDbReservation(existing),
    ...changes,
    id: existing.reservation_code || String(existing.id),
  };
  const reservation = toDbReservation(merged);
  const patch = {
    request_data: reservation.request_data,
    updated_at: new Date().toISOString(),
  };

  for (const [column, aliases] of Object.entries(PATCH_FIELD_ALIASES)) {
    if (aliases.some((alias) => Object.hasOwn(changes, alias))) {
      patch[column] = reservation[column];
    }
  }

  return patch;
}

function buildUserEditSnapshot(existing, payload) {
  const previous = fromDbReservation(existing);
  const next = {
    facilityName: payload.request_data.facilityName || previous.facilityName,
    date: payload.date ?? previous.date,
    startTime: payload.start_time ?? previous.startTime,
    endTime: payload.end_time ?? previous.endTime,
    attendees: payload.attendees ?? previous.attendees,
    purpose: payload.purpose ?? previous.purpose,
    additionalNotes: payload.additional_notes ?? previous.additionalNotes,
    totalAmount: payload.total_amount ?? previous.totalAmount,
  };
  const changes = {};

  for (const field of Object.keys(next)) {
    const before = previous[field] ?? null;
    const after = next[field] ?? null;
    const valuesMatch =
      field === "startTime" || field === "endTime"
        ? String(before ?? "").slice(0, 5) === String(after ?? "").slice(0, 5)
        : before === after;
    if (!valuesMatch) changes[field] = { before, after };
  }

  return { changedAt: new Date().toISOString(), changes };
}

function getReservationCodePrefix(payload) {
  return payload.is_staff ||
    payload.user_type === "staff" ||
    payload.source === "staff"
    ? "BCHS-I"
    : "BCHS-G";
}

async function allocateReservationCode(client, payload) {
  const prefix = getReservationCodePrefix(payload);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let nextNumber = 1;
  const { data, error } = await client
    .from("reservations")
    .select("reservation_code")
    .like("reservation_code", `${prefix}-%`);
  if (error) throw error;

  for (const row of data || []) {
    const match = String(row.reservation_code || "").match(pattern);
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
  }

  return `${prefix}-${nextNumber}`;
}

function handleSupabaseError(res, error, action) {
  console.error(`Could not ${action} reservation in Supabase:`, error);
  if (error.code === "P0001" && error.message === "visit_slot_unavailable") {
    return res.status(409).json({
      success: false,
      message: "That visit slot is no longer available. Please choose another option.",
    });
  }
  if (error.code === "P0001" && error.message === "reservation_time_conflict") {
    return res.status(409).json({
      success: false,
      message: "That facility and time are already reserved. Choose another time.",
    });
  }
  const status =
    error.code === "23505" ? 409 : error.code === "23503" ? 400 : 500;
  return res.status(error.status || status).json({
    success: false,
    message: `Could not ${action} reservation.`,
    error: error.message,
  });
}

function getCurrentIsoWeekRange() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

const ACTIVE_RESERVATION_STATUSES = ["pending", "approved", "accepted", "blocked"];

function timeToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

async function findReservationConflict(client, candidate, excludeCode = null) {
  if (!ACTIVE_RESERVATION_STATUSES.includes(candidate.status)) return null;
  if (candidate.status === "blocked") return null;

  const { data: events, error: eventError } = await client
    .from("events")
    .select("id,title")
    .lte("start_date", candidate.date)
    .gte("end_date", candidate.date);
  if (eventError) throw eventError;

  const schoolEvent = (events || [])[0];
  if (schoolEvent) return { ...schoolEvent, isSchoolEvent: true };

  let query = client
    .from("reservations")
    .select("reservation_code,facility_id,start_time,end_time")
    .eq("date", candidate.date)
    .in("status", ACTIVE_RESERVATION_STATUSES);
  if (excludeCode) query = query.neq("reservation_code", excludeCode);

  const { data, error } = await query;
  if (error) throw error;

  const start = timeToMinutes(candidate.start_time);
  const end = timeToMinutes(candidate.end_time);
  if (start === null || end === null) return null;

  const reservationConflict = (data || []).find((row) => {
    const sameFacility =
      candidate.facility_id === null ||
      row.facility_id === null ||
      row.facility_id === candidate.facility_id;
    const rowStart = timeToMinutes(row.start_time);
    const rowEnd = timeToMinutes(row.end_time);
    return sameFacility && rowStart < end && rowEnd > start;
  }) || null;
  if (reservationConflict) return reservationConflict;
  return null;
}

function getRequestOwnerMatches(actor) {
  if (!actor || actor.kind !== "user") return null;

  const user = actor.user || {};
  const matches = new Set();
  if (user.sub) matches.add(user.sub);
  if (user.id) matches.add(user.id);
  if (user.phone) matches.add(user.phone);
  if (user.mobile_number) matches.add(user.mobile_number);
  if (user.email) matches.add(user.email);
  return [...matches].filter(Boolean);
}

export function isRequestOwnedByUser(actor, row) {
  const matches = getRequestOwnerMatches(actor);
  if (!matches || !row) return false;

  const normalizedMatches = matches.map((value) => String(value));
  const contactValue = row.contact ? String(row.contact) : "";
  const emailValue = row.email ? String(row.email) : "";
  const staffId = row.staff_id ? String(row.staff_id) : "";
  const guestId = row.guest_id ? String(row.guest_id) : "";

  return (
    normalizedMatches.includes(staffId) ||
    normalizedMatches.includes(guestId) ||
    normalizedMatches.includes(contactValue) ||
    normalizedMatches.includes(emailValue)
  );
}

export async function getRequestActor(req) {
  const authHeader = req.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return { ok: false, status: 401, message: "Authentication is required." };
  }

  const appSession = verifySessionToken(accessToken);
  if (appSession) {
    return {
      ok: true,
      kind: "user",
      user: appSession,
    };
  }

  try {
    const { data, error } = await createSupabaseClient(accessToken)
      .auth.getUser(accessToken);
    if (error || !data?.user) {
      return { ok: false, status: 401, message: "Your sign-in is invalid or expired." };
    }
    if (data.user.app_metadata?.role !== "admin") {
      return { ok: false, status: 403, message: "User access is required." };
    }
    return {
      ok: true,
      kind: "admin",
      user: data.user,
    };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      message: "Your sign-in is invalid or expired.",
    };
  }
}

function requireRequestAuth() {
  return async function (req, res, next) {
    if (req.method === "GET" && req.path === "/availability") {
      return next();
    }
    const actor = await getRequestActor(req);
    if (!actor.ok) {
      return res.status(actor.status || 401).json({
        success: false,
        message: actor.message || "Authentication is required.",
      });
    }
    req.auth = actor;
    req.sessionUser = actor.user;
    return next();
  };
}

export function createRequestsRouter() {
  const router = express.Router();

  router.use(requireRequestAuth());

  router.get("/", async (req, res) => {
    try {
      const client = createServiceRoleSupabaseClient();
      const { data, error } = await client
        .from("reservations")
        .select(RESERVATION_SELECT)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      const currentRows = await Promise.all(
        (data || []).map((row) => clearExpiredVisitSlot(client, row)),
      );

      const isUserScoped = req.auth.kind === "user";
      const visible = isUserScoped
        ? currentRows.filter((row) => isRequestOwnedByUser(req.auth, row))
        : currentRows;

      return res.json({ requests: visible.map(fromDbReservation) });
    } catch (error) {
      return handleSupabaseError(res, error, "load");
    }
  });

  router.get("/availability", async (_req, res) => {
    try {
      const { data, error } = await createServiceRoleSupabaseClient()
        .from("reservations")
        .select("reservation_code,facility_id,date,start_time,end_time,status,request_data")
        .in("status", ACTIVE_RESERVATION_STATUSES);
      if (error) throw error;
      const reservations = (data || []).map((row) => ({
        id: row.reservation_code,
        facilityId: row.facility_id || row.request_data?.facilityId || "global",
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
        isFullDayBlock: row.request_data?.isFullDayBlock === true,
      }));
      return res.json({ reservations });
    } catch (error) {
      return handleSupabaseError(res, error, "load public availability");
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const client = createServiceRoleSupabaseClient();
      const { data, error } = await client
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("reservation_code", req.params.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      if (req.auth.kind === "user" && !isRequestOwnedByUser(req.auth, data)) {
        return res.status(403).json({ success: false, message: "You do not have access to this request." });
      }
      const current = await clearExpiredVisitSlot(client, data);
      return res.json({ request: fromDbReservation(current) });
    } catch (error) {
      return handleSupabaseError(res, error, "load");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const payload = toDbReservation(req.body || {});
      if (req.auth.kind === "user") {
        if (payload.request_data.facilityId === "global") {
          return res.status(403).json({
            success: false,
            message: "Only administrators can create facility blocks.",
          });
        }
        const isStaff = req.auth.user.isStaff === true;
        payload.source = isStaff ? "staff" : "guest";
        payload.user_type = payload.source;
        payload.is_staff = isStaff;
        payload.staff_id = isStaff ? req.auth.user.sub : null;
        payload.guest_id = isStaff ? null : req.auth.user.sub;
        payload.status = "pending";
        payload.payment_status = isStaff ? "free" : "unpaid";
        payload.down_payment_paid = false;
        payload.remaining_balance_paid = false;
        payload.appointment_date = null;
        payload.appointment_time = null;
        payload.block_reschedule_pending = false;
        payload.block_reschedule_reason = null;
        payload.admin_edit_snapshot = null;
        payload.request_data.pendingEditCount = 0;
        payload.submitted_at = new Date().toISOString();
        if (isStaff && req.body?.status === "blocked") {
          return res.status(403).json({
            success: false,
            message: "Only administrators can create facility blocks.",
          });
        }
      }
      if (!payload.facility_id && payload.request_data.facilityId !== "global") {
        return res.status(400).json({
          success: false,
          message: "Choose a valid facility.",
        });
      }
      if (
        !payload.date ||
        !payload.start_time ||
        !payload.end_time ||
        payload.start_time >= payload.end_time
      ) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid reservation date and time.",
        });
      }
      if (
        req.auth.kind === "user" &&
        isBeforeNextWeek(payload.date)
      ) {
        return res.status(400).json({
          success: false,
          message: "Reservations cannot be made for the current week.",
        });
      }
      if (
        isGroundsFacilityId(payload.facility_id) &&
        isWeekendDate(payload.date)
      ) {
        return res.status(400).json({
          success: false,
          message: "The Grounds are unavailable on Saturdays and Sundays.",
        });
      }
      if (!Number.isFinite(payload.total_amount) || payload.total_amount < 0) {
        return res.status(400).json({
          success: false,
          message: "The reservation amount must be a valid non-negative number.",
        });
      }
      if (!payload.contact) {
        return res.status(400).json({
          success: false,
          message: "A contact number is required to submit a reservation.",
        });
      }

      const client = createServiceRoleSupabaseClient();
      const conflict = await findReservationConflict(client, payload);
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: conflict.isSchoolEvent
            ? "A school event makes this date unavailable for reservations."
            : "That facility and time are already reserved. Choose another time.",
        });
      }
      if (payload.source !== "walk_in") {
        const { start, end } = getCurrentIsoWeekRange();
        let countQuery = client
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .gte("submitted_at", start)
          .lt("submitted_at", end);

        if (payload.staff_id) {
          countQuery = countQuery.eq("staff_id", payload.staff_id);
        } else if (payload.guest_id) {
          countQuery = countQuery.eq("guest_id", payload.guest_id);
        } else if (payload.contact) {
          countQuery = countQuery.eq("contact", payload.contact);
        } else {
          return res.status(400).json({
            success: false,
            message: "A signed-in facility user is required to submit a request.",
          });
        }

        const { count, error: countError } = await countQuery;
        if (countError) throw countError;
        if (count >= 3) {
          return res.status(429).json({
            success: false,
            limit: 3,
            action: "reservation",
            message: "Weekly reservation limit reached. You can submit up to 3 reservations per week.",
          });
        }
      }

      let data;
      let error;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        payload.reservation_code = await allocateReservationCode(client, payload);
        const inserted = await client
          .from("reservations")
          .insert([payload])
          .select(RESERVATION_SELECT)
          .single();
        data = inserted.data;
        error = inserted.error;
        if (!error) break;
        if (error.code !== "23505") break;
      }
      if (error) throw error;
      return res.status(201).json({
        success: true,
        message: "Request saved successfully",
        request: fromDbReservation(data),
      });
    } catch (error) {
      return handleSupabaseError(res, error, "save");
    }
  });

  router.patch("/:id", async (req, res) => {
    try {
      const client = createServiceRoleSupabaseClient();
      const { data: found, error: findError } = await client
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("reservation_code", req.params.id)
        .maybeSingle();
      if (findError) throw findError;
      if (!found) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      const existing = await clearExpiredVisitSlot(client, found);
      if (req.auth.kind === "user" && !isRequestOwnedByUser(req.auth, existing)) {
        return res.status(403).json({ success: false, message: "You do not have permission to update this request." });
      }

      const changes = req.body || {};
      let authorizedChanges = changes;
      let pendingUserEditFacility = null;
      let pendingUserEditCount = null;
      if (req.auth.kind === "user") {
        const allowedFields = new Set([
          "_editedByUser",
          "_isEdit",
          "rescheduleOptionIndex",
          "date",
          "startTime",
          "endTime",
          "attendees",
          "purpose",
          "additionalNotes",
          "appointmentDate",
          "appointmentTime",
          "status",
          "visitOptions",
          "rescheduleOptions",
          "rescheduleReason",
          "rescheduleRequestedAt",
          "rescheduledDate",
          "rescheduledStartTime",
          "rescheduledEndTime",
          "userEditReason",
          "cancellationReason",
          "cancellationRequestedAt",
        ]);
        const isPendingFacilityEdit =
          existing.status === "pending" &&
          Object.hasOwn(changes, "facilityId");
        const isPendingUserEdit =
          existing.status === "pending" &&
          ((changes._isEdit === true && changes._editedByUser === true) ||
            [
              "facilityId",
              "date",
              "startTime",
              "endTime",
              "attendees",
              "purpose",
              "additionalNotes",
            ].some((field) => Object.hasOwn(changes, field)));
        if (isPendingUserEdit) {
          const currentEditCount = Number(
            existing.request_data?.pendingEditCount,
          );
          const normalizedEditCount =
            Number.isInteger(currentEditCount) && currentEditCount >= 0
              ? currentEditCount
              : 0;
          if (normalizedEditCount >= PENDING_USER_EDIT_LIMIT) {
            return res.status(403).json({
              success: false,
              message:
                `You have used all ${PENDING_USER_EDIT_LIMIT} edits allowed while this reservation is pending.`,
            });
          }
          pendingUserEditCount = normalizedEditCount + 1;
        }
        if (isPendingFacilityEdit) allowedFields.add("facilityId");
        authorizedChanges = Object.fromEntries(
          Object.entries(changes).filter(([key]) => allowedFields.has(key)),
        );
        if (isPendingFacilityEdit) {
          const facilityId = authorizedChanges.facilityId;
          if (typeof facilityId !== "string" || !facilityId.trim()) {
            return res.status(400).json({
              success: false,
              message: "Choose a valid facility.",
            });
          }
          const { data: facility, error: facilityError } = await client
            .from("facilities")
            .select("id,name,price_per_hour")
            .eq("id", facilityId)
            .maybeSingle();
          if (facilityError) throw facilityError;
          if (!facility) {
            return res.status(400).json({
              success: false,
              message: "Choose a valid facility.",
            });
          }
          pendingUserEditFacility = facility;
          authorizedChanges.facilityId = facility.id;
          authorizedChanges.facilityName = facility.name;
        }
        if (
          ["approved", "accepted"].includes(existing.status) &&
          Object.hasOwn(changes, "additionalNotes")
        ) {
          const daysUntilEvent = daysUntilDate(existing.date);
          if (
            daysUntilEvent === null ||
            daysUntilEvent < 1 ||
            daysUntilEvent > 3
          ) {
            return res.status(403).json({
              success: false,
              message:
                "Utilities can only be edited within 3 days before the event.",
            });
          }
        }
        const isRescheduleSubmission =
          Object.hasOwn(changes, "rescheduleOptionIndex") ||
          (Object.hasOwn(changes, "rescheduleReason") &&
            typeof changes.rescheduleReason === "string" &&
            changes.rescheduleReason.trim()) ||
          (Object.hasOwn(changes, "rescheduledDate") &&
            typeof changes.rescheduledDate === "string" &&
            changes.rescheduledDate.trim());
        const isDirectScheduleChange =
          (Object.hasOwn(changes, "date") &&
            nullableDate(changes.date) !== existing.date) ||
          (Object.hasOwn(changes, "startTime") &&
            changes.startTime !== existing.start_time) ||
          (Object.hasOwn(changes, "endTime") &&
            changes.endTime !== existing.end_time);
        if (
          req.auth.kind === "user" &&
          existing.status !== "pending" &&
          !changes._isEdit &&
          (isRescheduleSubmission || isDirectScheduleChange) &&
          existing.block_reschedule_pending !== true
        ) {
          const daysUntilEvent = daysUntilDate(existing.date);
          if (daysUntilEvent === null || daysUntilEvent < 3) {
            return res.status(403).json({
              success: false,
              message:
                "Rescheduling requests must be submitted at least 3 days before the event.",
            });
          }
        }
        if (
          ["approved", "accepted"].includes(existing.status) &&
          changes._isEdit === true &&
          changes._editedByUser === true
        ) {
          const utilityEditFields = new Set([
            "_editedByUser",
            "_isEdit",
            "additionalNotes",
            "userEditReason",
          ]);
          authorizedChanges = Object.fromEntries(
            Object.entries(authorizedChanges).filter(([key]) =>
              utilityEditFields.has(key),
            ),
          );
        }
        if (authorizedChanges.status && authorizedChanges.status !== "cancelled") {
          authorizedChanges.status = existing.status;
        }
      }
      const requiresCancellationOtp =
        req.auth.kind === "user" &&
        authorizedChanges.status === "cancelled" &&
        existing.status !== "cancelled";
      if (requiresCancellationOtp) {
        const daysUntilEvent = daysUntilDate(existing.date);
        if (daysUntilEvent === null) {
          return res.status(400).json({
            success: false,
            message: "This reservation has no valid event date.",
          });
        }
        if (daysUntilEvent < 7) {
          return res.status(400).json({
            success: false,
            message: "Cancellations are not accepted within one week of the event date.",
          });
        }
      }
      let effectiveChanges = authorizedChanges;
      if (req.auth.kind !== "user") {
        if (
          Object.hasOwn(authorizedChanges, "visitOptions") &&
          (!Array.isArray(authorizedChanges.visitOptions) ||
            (authorizedChanges.visitOptions.length > 0 &&
              authorizedChanges.visitOptions.length < 5))
        ) {
          return res.status(400).json({
            success: false,
            message: "At least 5 visit options are required.",
          });
        }
        if (Object.hasOwn(authorizedChanges, "visitOptions")) {
          const eventDate = String(existing.date || "");
          const eventStartMinutes = getTimeMinutes(existing.start_time);
          const validOptions = authorizedChanges.visitOptions.every((option) => {
            if (!option || typeof option !== "object") return false;
            const visitDate = String(option.date || "").trim();
            const visitTime = String(option.startTime || option.time || "").trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return false;
            if (visitDate > eventDate) return false;
            if (visitDate < eventDate) return true;
            const visitStartMinutes = getTimeMinutes(visitTime);
            return (
              eventStartMinutes !== null &&
              visitStartMinutes !== null &&
              visitStartMinutes < eventStartMinutes
            );
          });
          if (
            Array.isArray(authorizedChanges.visitOptions) &&
            !validOptions
          ) {
            return res.status(400).json({
              success: false,
              message:
                "All visit options must be scheduled before the event date or start time.",
            });
          }
        }
        if (
          Object.hasOwn(authorizedChanges, "rescheduleOptions") &&
          (!Array.isArray(authorizedChanges.rescheduleOptions) ||
            (authorizedChanges.rescheduleOptions.length > 0 &&
              authorizedChanges.rescheduleOptions.length < 5))
        ) {
          return res.status(400).json({
            success: false,
            message: "At least 5 alternate schedules are required.",
          });
        }
      }
      if (
        req.auth.kind === "user" &&
        typeof changes.appointmentDate === "string" &&
        changes.appointmentDate.trim() &&
        typeof changes.appointmentTime === "string" &&
        changes.appointmentTime.trim() &&
        !Object.hasOwn(changes, "rescheduleOptionIndex")
      ) {
        const { error: confirmError } = await client.rpc("confirm_visit_slot", {
          p_reservation_code: req.params.id,
          p_visit_date: changes.appointmentDate.trim(),
          p_visit_time: changes.appointmentTime.trim(),
        });
        if (confirmError) throw confirmError;

        const { data, error } = await client
          .from("reservations")
          .select(RESERVATION_SELECT)
          .eq("reservation_code", req.params.id)
          .single();
        if (error) throw error;
        return res.json({
          success: true,
          message: "Visit slot confirmed successfully.",
          request: fromDbReservation(data),
        });
      }

      if (Object.hasOwn(authorizedChanges, "rescheduleOptionIndex")) {
        if (req.auth.kind !== "user") {
          return res.status(403).json({
            success: false,
            message: "Only the requester can choose an alternate schedule.",
          });
        }
        const optionIndex = Number(changes.rescheduleOptionIndex);
        const options = existing.request_data?.rescheduleOptions;
        if (
          !Number.isInteger(optionIndex) ||
          !Array.isArray(options) ||
          optionIndex < 0 ||
          optionIndex >= options.length
        ) {
          return res.status(400).json({
            success: false,
            message: "Choose a valid alternate schedule.",
          });
        }

        const option = options[optionIndex];
        const startTime = option.startTime || option.time;
        const endTime =
          option.endTime ||
          (timeToMinutes(startTime) === null
            ? null
            : (() => {
                const end = timeToMinutes(startTime) + 60;
                return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
              })());
        if (
          typeof option.date !== "string" ||
          timeToMinutes(startTime) === null ||
          timeToMinutes(endTime) === null ||
          timeToMinutes(startTime) >= timeToMinutes(endTime)
        ) {
          return res.status(400).json({
            success: false,
            message: "The selected alternate schedule is invalid.",
          });
        }

        const requestData = { ...(existing.request_data || {}) };
        delete requestData.rescheduleOptions;
        effectiveChanges = {
          date: option.date,
          startTime,
          endTime,
          rescheduleOptions: [],
          blockReschedulePending: false,
          blockRescheduleReason: null,
          rescheduleReason: null,
          rescheduleRequestedAt: null,
          rescheduledDate: null,
          rescheduledStartTime: null,
          rescheduledEndTime: null,
          adminRescheduleNote: null,
          ...authorizedChanges,
        };
        delete effectiveChanges.rescheduleOptionIndex;
        effectiveChanges.rescheduleOptions = undefined;
        const payload = toDbReservationPatch(existing, effectiveChanges);
        payload.request_data = requestData;
        if (
          req.auth.kind === "user" &&
          (payload.date || existing.date) !== existing.date &&
          isBeforeNextWeek(payload.date || existing.date)
        ) {
          return res.status(400).json({
            success: false,
            message: "Reservations cannot be made for the current week.",
          });
        }
        if (
          isGroundsFacilityId(payload.facility_id ?? existing.facility_id) &&
          isWeekendDate(payload.date || existing.date)
        ) {
          return res.status(400).json({
            success: false,
            message: "The Grounds are unavailable on Saturdays and Sundays.",
          });
        }
        const conflict = await findReservationConflict(
          client,
          {
            date: payload.date || existing.date,
            start_time: payload.start_time || existing.start_time,
            end_time: payload.end_time || existing.end_time,
            facility_id: payload.facility_id ?? existing.facility_id,
            status: payload.status || existing.status,
          },
          req.params.id,
        );
        if (conflict) {
          return res.status(409).json({
            success: false,
            message: conflict.isSchoolEvent
              ? "A school event makes this date unavailable for reservations."
              : "That alternate schedule is no longer available. Please contact the administration office.",
          });
        }

        if (
          requiresCancellationOtp &&
          !consumeCancellationOtp(req.params.id, existing.email)
        ) {
          return res.status(403).json({
            success: false,
            message: "Verify the cancellation code sent to your email before cancelling this request.",
          });
        }
        const { data, error } = await client
          .from("reservations")
          .update(payload)
          .eq("reservation_code", req.params.id)
          .select(RESERVATION_SELECT)
          .single();
        if (error) throw error;
        return res.json({
          success: true,
          message: "Alternate schedule selected successfully.",
          request: fromDbReservation(data),
        });
      }

      const payload = toDbReservationPatch(existing, authorizedChanges);
      if (
        req.auth.kind === "user" &&
        (payload.date || existing.date) !== existing.date &&
        isBeforeNextWeek(payload.date || existing.date)
      ) {
        return res.status(400).json({
          success: false,
          message: "Reservations cannot be made for the current week.",
        });
      }
      if (
        isGroundsFacilityId(payload.facility_id ?? existing.facility_id) &&
        isWeekendDate(payload.date || existing.date)
      ) {
        return res.status(400).json({
          success: false,
          message: "The Grounds are unavailable on Saturdays and Sundays.",
        });
      }
      if (pendingUserEditCount !== null) {
        payload.request_data.pendingEditCount = pendingUserEditCount;
      }
      if (pendingUserEditFacility) {
        const startMinutes = getTimeMinutes(
          authorizedChanges.startTime ?? existing.start_time,
        );
        const endMinutes = getTimeMinutes(
          authorizedChanges.endTime ?? existing.end_time,
        );
        if (
          startMinutes === null ||
          endMinutes === null ||
          endMinutes <= startMinutes
        ) {
          return res.status(400).json({
            success: false,
            message: "Choose a valid reservation time.",
          });
        }

        const durationHours = (endMinutes - startMinutes) / 60;
        const pricePerHour = Number(pendingUserEditFacility.price_per_hour);
        if (!Number.isFinite(pricePerHour) || pricePerHour < 0) {
          throw new Error("Facility has an invalid hourly rate.");
        }
        const additionalNotes = Object.hasOwn(
          authorizedChanges,
          "additionalNotes",
        )
          ? authorizedChanges.additionalNotes
          : existing.additional_notes;
        const hasUtilities =
          typeof additionalNotes === "string" && additionalNotes.trim();
        const isStaff =
          existing.is_staff === true || existing.user_type === "staff";
        const totalAmount = isStaff
          ? 0
          : pricePerHour * durationHours +
            (durationHours >= 8 ? 800 : 0) +
            (hasUtilities ? 800 : 0);

        payload.total_amount = totalAmount;
        payload.request_data.totalAmount = totalAmount;
      }
      if (
        req.auth.kind === "user" &&
        ["approved", "accepted"].includes(existing.status) &&
        changes._isEdit === true &&
        changes._editedByUser === true &&
        Object.hasOwn(authorizedChanges, "additionalNotes") &&
        !existing.is_staff
      ) {
        const hadUtilities = Boolean(existing.additional_notes?.trim());
        const hasUtilities = Boolean(
          authorizedChanges.additionalNotes?.trim(),
        );
        payload.total_amount =
          Number(existing.total_amount || 0) +
          (hasUtilities ? 800 : 0) -
          (hadUtilities ? 800 : 0);
      }
      if (Object.hasOwn(authorizedChanges, "date") && !payload.date) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid reservation date.",
        });
      }
      if (pendingUserEditFacility) {
        const userEditSnapshot = buildUserEditSnapshot(existing, payload);
        if (Object.keys(userEditSnapshot.changes).length > 0) {
          payload.request_data.userEditSnapshot = userEditSnapshot;
        }
      }

      const scheduleChanged =
        (Object.hasOwn(payload, "date") && payload.date !== existing.date) ||
        (Object.hasOwn(payload, "start_time") &&
          payload.start_time !== existing.start_time) ||
        (Object.hasOwn(payload, "end_time") &&
          payload.end_time !== existing.end_time) ||
        (Object.hasOwn(payload, "facility_id") &&
          payload.facility_id !== existing.facility_id);
      const statusChanged =
        Object.hasOwn(payload, "status") && payload.status !== existing.status;

      if (scheduleChanged || statusChanged) {
        const conflict = await findReservationConflict(
          client,
          {
            date: Object.hasOwn(payload, "date") ? payload.date : existing.date,
            start_time: Object.hasOwn(payload, "start_time")
              ? payload.start_time
              : existing.start_time,
            end_time: Object.hasOwn(payload, "end_time")
              ? payload.end_time
              : existing.end_time,
            facility_id: Object.hasOwn(payload, "facility_id")
              ? payload.facility_id
              : existing.facility_id,
            status: Object.hasOwn(payload, "status")
              ? payload.status
              : existing.status,
          },
          req.params.id,
        );
        if (conflict) {
          return res.status(409).json({
            success: false,
            message: conflict.isSchoolEvent
              ? "A school event makes this date unavailable for reservations."
              : "That facility and time are already reserved. Choose another time.",
          });
        }
      }
      if (
        requiresCancellationOtp &&
        !consumeCancellationOtp(req.params.id, existing.email)
      ) {
        return res.status(403).json({
          success: false,
          message: "Verify the cancellation code sent to your email before cancelling this request.",
        });
      }
      let updateQuery = client
        .from("reservations")
        .update(payload)
        .eq("reservation_code", req.params.id);
      if (pendingUserEditCount !== null) {
        updateQuery = updateQuery.eq("updated_at", existing.updated_at);
      }
      const { data, error } =
        pendingUserEditCount === null
          ? await updateQuery.select(RESERVATION_SELECT).single()
          : await updateQuery.select(RESERVATION_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(409).json({
          success: false,
          message:
            "This reservation changed while you were editing it. Reload your requests and try again.",
        });
      }
      return res.json({
        success: true,
        message: "Request updated successfully",
        request: fromDbReservation(data),
      });
    } catch (error) {
      return handleSupabaseError(res, error, "update");
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const client = createServiceRoleSupabaseClient();
      const { data: existing, error: findError } = await client
        .from("reservations")
        .select("reservation_code, staff_id, guest_id, contact, email, date, status")
        .eq("reservation_code", req.params.id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      if (req.auth.kind === "user" && !isRequestOwnedByUser(req.auth, existing)) {
        return res.status(403).json({ success: false, message: "You do not have permission to delete this request." });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isTodayOrFuture =
        new Date(`${existing.date}T00:00:00`) >= today;
      if (
        req.auth.kind === "user" &&
        isTodayOrFuture &&
        ACTIVE_RESERVATION_STATUSES.includes(existing.status) &&
        !consumeCancellationOtp(req.params.id, existing.email)
      ) {
        return res.status(403).json({
          success: false,
          message: "Verify the cancellation code sent to your email before cancelling this request.",
        });
      }

      const { data, error } = await client
        .from("reservations")
        .delete()
        .eq("reservation_code", req.params.id)
        .select("reservation_code")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      return res.json({ success: true, message: "Request deleted" });
    } catch (error) {
      return handleSupabaseError(res, error, "delete");
    }
  });

  return router;
}
