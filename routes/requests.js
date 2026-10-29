import express from "express";
import { verifySessionToken } from "./auth.js";
import {
  createServiceRoleSupabaseClient,
  createSupabaseClient,
} from "../services/supabaseClient.js";

const INTERNAL_FIELDS = new Set([
  "_editedByUser",
  "_isEdit",
  "rescheduleOptionIndex",
]);

function nullableDate(value) {
  if (typeof value !== "string") return value ?? null;
  return value.trim() || null;
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
  const id = String(
    body.id ||
      body.reservationCode ||
      `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );
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

  return {
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
    payment_status: body.paymentStatus || body.payment_status || "pending",
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
}

export function fromDbReservation(row) {
  const facility = Array.isArray(row.facilities)
    ? row.facilities[0]
    : row.facilities;

  return {
    ...(row.request_data || {}),
    id: row.reservation_code || String(row.id),
    reservationCode: row.reservation_code || String(row.id),
    facilityId: row.request_data?.facilityId || row.facility_id || "global",
    facilityName:
      row.request_data?.facilityName || facility?.name || row.facility_id || "",
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
    paymentStatus: row.payment_status,
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

function handleSupabaseError(res, error, action) {
  console.error(`Could not ${action} reservation in Supabase:`, error);
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

  const { data: events, error: eventError } = await client
    .from("events")
    .select("id,facility_id,start_time,end_time")
    .eq("event_date", candidate.date);
  if (eventError) throw eventError;

  return (events || []).find((event) => {
    const sameFacility =
      candidate.facility_id === null ||
      event.facility_id === candidate.facility_id;
    const eventStart = timeToMinutes(event.start_time);
    const eventEnd = timeToMinutes(event.end_time);
    return sameFacility && eventStart < end && eventEnd > start;
  }) || null;
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
      const { data, error } = await createServiceRoleSupabaseClient()
        .from("reservations")
        .select(RESERVATION_SELECT)
        .order("submitted_at", { ascending: false });
      if (error) throw error;

      const isUserScoped = req.auth.kind === "user";
      const visible = isUserScoped
        ? (data || []).filter((row) => isRequestOwnedByUser(req.auth, row))
        : data || [];

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
        facilityId: row.request_data?.facilityId || row.facility_id || "global",
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
      const { data, error } = await createServiceRoleSupabaseClient()
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
      return res.json({ request: fromDbReservation(data) });
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
        payload.payment_status = isStaff ? "paid" : "pending";
        payload.down_payment_paid = false;
        payload.remaining_balance_paid = false;
        payload.appointment_date = null;
        payload.appointment_time = null;
        payload.block_reschedule_pending = false;
        payload.block_reschedule_reason = null;
        payload.admin_edit_snapshot = null;
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
          message: "That facility and time are already reserved. Choose another time.",
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

      const { data, error } = await client
        .from("reservations")
        .insert([payload])
        .select(RESERVATION_SELECT)
        .single();
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
      const { data: existing, error: findError } = await client
        .from("reservations")
        .select(RESERVATION_SELECT)
        .eq("reservation_code", req.params.id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      if (req.auth.kind === "user" && !isRequestOwnedByUser(req.auth, existing)) {
        return res.status(403).json({ success: false, message: "You do not have permission to update this request." });
      }

      const changes = req.body || {};
      let authorizedChanges = changes;
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
        authorizedChanges = Object.fromEntries(
          Object.entries(changes).filter(([key]) => allowedFields.has(key)),
        );
        if (authorizedChanges.status && authorizedChanges.status !== "cancelled") {
          authorizedChanges.status = existing.status;
        }
      }
      let effectiveChanges = authorizedChanges;
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
          ...authorizedChanges,
        };
        delete effectiveChanges.rescheduleOptionIndex;
        effectiveChanges.rescheduleOptions = undefined;
        const payload = toDbReservationPatch(existing, effectiveChanges);
        payload.request_data = requestData;
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
            message: "That alternate schedule is no longer available. Please contact the administration office.",
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
      if (Object.hasOwn(authorizedChanges, "date") && !payload.date) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid reservation date.",
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
          message: "That facility and time are already reserved. Choose another time.",
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
        .select("reservation_code, staff_id, guest_id, contact, email")
        .eq("reservation_code", req.params.id)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) {
        return res.status(404).json({ success: false, message: "Request not found." });
      }
      if (req.auth.kind === "user" && !isRequestOwnedByUser(req.auth, existing)) {
        return res.status(403).json({ success: false, message: "You do not have permission to delete this request." });
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
