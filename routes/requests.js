import express from "express";
import { createServiceRoleSupabaseClient } from "../services/supabaseClient.js";

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

export function createRequestsRouter() {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const { data, error } = await createServiceRoleSupabaseClient()
        .from("reservations")
        .select(RESERVATION_SELECT)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return res.json({ requests: (data || []).map(fromDbReservation) });
    } catch (error) {
      return handleSupabaseError(res, error, "load");
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
      return res.json({ request: fromDbReservation(data) });
    } catch (error) {
      return handleSupabaseError(res, error, "load");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const payload = toDbReservation(req.body || {});
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

      const changes = req.body || {};
      const payload = toDbReservationPatch(existing, changes);
      if (Object.hasOwn(changes, "date") && !payload.date) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid reservation date.",
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
      const { data, error } = await createServiceRoleSupabaseClient()
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
