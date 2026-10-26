import express from "express";
import {
  convertTo12Hour,
  formatDate,
  getWorkingDaysUntil,
} from "../user/src/utils/dateUtils.js";
import {
  buildEmailHtml,
  buildDetailTable,
} from "../scripts/EmailBuilder.js";
import transporter from "../services/mailer.js";
import { createServiceRoleSupabaseClient } from "../services/supabaseClient.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getRequestActor, isRequestOwnedByUser } from "./requests.js";

export function createNotificationRouter() {
  const router = express.Router();
  const otpStore = new Map();
  // --- Email Reminder Logic ----------------------------------------------------

  const formatDateOnly = (date) => formatDate(date) || date;

  async function checkAndSendReminders() {
    try {
      const client = createServiceRoleSupabaseClient();
      const { data: reservations, error } = await client
        .from("reservations")
        .select("*, facilities(name)")
        .eq("status", "approved");
      if (error) throw error;

      for (const row of reservations || []) {
        const requestData = row.request_data || {};
        const facility = Array.isArray(row.facilities)
          ? row.facilities[0]
          : row.facilities;
        const req = {
          ...requestData,
          id: row.reservation_code,
          name: row.name,
          email: row.email,
          facilityName: requestData.facilityName || facility?.name || "",
          date: row.date,
          startTime: row.start_time,
          endTime: row.end_time,
          paymentStatus: row.payment_status,
          totalAmount: Number(row.total_amount || 0),
        };
        if (!req.email || req.paymentStatus === "paid" || req.reminderSent)
          continue;

        const daysLeft = getWorkingDaysUntil(req.date);
        if (daysLeft > 5 || daysLeft < 0) continue;

        const amount = req.totalAmount
          ? `?${parseFloat(req.totalAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
          : "amount on file";

        const mailOptions = {
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: req.email,
          subject: `Payment Reminder: ${req.facilityName} reservation on ${formatDateOnly(req.date) || req.date}`,
          html: buildEmailHtml(
            "Payment Reminder",
            `<p>Dear <strong>${req.name}</strong>,</p>
             <p>This is a reminder that your reservation payment is due. Your event is in <strong>${daysLeft} working day${daysLeft !== 1 ? "s" : ""}</strong>.</p>
             ${buildDetailTable([
               { label: "Facility", value: req.facilityName },
               {
                 label: "Event Date",
                 value: formatDateOnly(req.date) || req.date,
               },
               { label: "Time", value: `${req.startTime} � ${req.endTime}` },
               { label: "Amount Due", value: amount, highlight: true },
             ])}
             <p>Please visit the <strong>Administration Office</strong> to settle your balance before your event.</p>`,
          ),
        };

        try {
          await transporter.sendMail(mailOptions);
        } catch (mailErr) {
          console.error(
            `Failed to send reminder to ${req.email}:`,
            mailErr.message,
          );
          continue;
        }

        const { error: updateError } = await client
          .from("reservations")
          .update({
            request_data: { ...requestData, reminderSent: true },
          })
          .eq("reservation_code", row.reservation_code);
        if (updateError) {
          console.error(
            `Could not save reminder state for ${req.id}:`,
            updateError,
          );
          continue;
        }
        console.log(`Reminder sent to ${req.email} for request ${req.id}`);
      }

    } catch (err) {
      console.error("Error in checkAndSendReminders:", err);
    }
  }

  // --- Appointment Visit Notification -----------------------------------------

  router.post("/api/notify-appointment", requireAdmin, async (req, res) => {
    const {
      email,
      name,
      facilityName,
      date,
      startTime,
      endTime,
      appointmentDate,
      appointmentTime,
    } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "No email provided" });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Confirmation Visit Scheduled: ${facilityName} on ${formatDateOnly(date) || date}`,
      html: buildEmailHtml(
        "Confirmation Visit Scheduled",
        `<p>Dear <strong>${name}</strong>,</p>
         <p>The administration has scheduled a confirmation visit for your reservation. Please come to the Administration Office on the date and time below.</p>
         ${buildDetailTable([
           { label: "Facility", value: facilityName },
           { label: "Event Date", value: formatDateOnly(date) || date },
           { label: "Event Time", value: `${startTime} � ${endTime}` },
           {
             label: "Visit Date",
             value: formatDateOnly(appointmentDate) || appointmentDate,
             highlight: true,
           },
           { label: "Visit Time", value: appointmentTime, highlight: true },
         ])}
         <p>Please bring a valid ID and any required documents. Visit the <strong>Administration Office</strong> at the scheduled time.</p>`,
      ),
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`? Appointment notice sent to ${email}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(
        `? Failed to send appointment notice to ${email}:`,
        err.message,
      );
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Block Cancellation Notification ----------------------------------------

  router.post("/api/notify-visit-options", requireAdmin, async (req, res) => {
    const {
      email,
      name,
      facilityName,
      date,
      startTime,
      endTime,
      visitOptions,
    } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "No email provided" });
    if (!Array.isArray(visitOptions) || visitOptions.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No visit options provided" });

    const optionRows = visitOptions
      .map(
        (opt, i) =>
          `<tr style="background:${i % 2 === 0 ? "#f8fafc" : "white"};">
         <td style="padding:8px 14px;font-weight:700;color:#1d4ed8;">Option ${i + 1}</td>
         <td style="padding:8px 14px;color:#1e293b;">${formatDateOnly(opt.date) || opt.date}</td>
         <td style="padding:8px 14px;color:#1e293b;">${opt.time}</td>
       </tr>`,
      )
      .join("");

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Please Choose a Visit Time � ${facilityName} on ${formatDateOnly(date) || date}`,
      html: buildEmailHtml(
        "Choose Your Confirmation Visit Slot",
        `<p>Dear <strong>${name}</strong>,</p>
         <p>The administration has scheduled a confirmation visit for your reservation. Please choose one of the available time slots below and reply or visit the Administration Office to confirm your preferred schedule.</p>
         ${buildDetailTable([
           { label: "Facility", value: facilityName },
           { label: "Event Date", value: formatDateOnly(date) || date },
           { label: "Event Time", value: `${startTime} � ${endTime}` },
         ])}
         <p style="font-weight:700;color:#1d4ed8;margin-top:16px;">Available Visit Slots:</p>
         <table style="width:100%;border-collapse:collapse;margin-bottom:16px;border-radius:6px;overflow:hidden;border:1px solid #e2e8f0;">
           <thead>
             <tr style="background:#1d4ed8;color:white;">
               <th style="padding:8px 14px;text-align:left;">Slot</th>
               <th style="padding:8px 14px;text-align:left;">Date</th>
               <th style="padding:8px 14px;text-align:left;">Time</th>
             </tr>
           </thead>
           <tbody>${optionRows}</tbody>
         </table>
         <p>You can also select your preferred slot directly from the <strong>My Requests</strong> section on the booking portal.</p>
         <p>If you have questions, please contact the Administration Office.</p>`,
      ),
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`? Visit options notice sent to ${email}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(
        `? Failed to send visit options notice to ${email}:`,
        err.message,
      );
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- User-Confirmed Visit Slot Notification -----------------------------------

  router.post("/api/notify-appointment-confirmed", async (req, res) => {
    const actor = await getRequestActor(req);
    if (!actor.ok) {
      return res.status(actor.status || 401).json({
        success: false,
        message: actor.message || "Authentication is required.",
      });
    }
    if (actor.kind !== "user") {
      return res.status(403).json({ success: false, message: "User access is required." });
    }
    if (typeof req.body?.requestId !== "string" || !req.body.requestId) {
      return res.status(400).json({ success: false, message: "A request ID is required." });
    }

    let reservation;
    try {
      const { data, error } = await createServiceRoleSupabaseClient()
        .from("reservations")
        .select("*, facilities(name)")
        .eq("reservation_code", req.body.requestId)
        .maybeSingle();
      if (error) throw error;
      reservation = data;
    } catch (error) {
      console.error("Could not load request for visit confirmation:", error);
      return res.status(500).json({ success: false, message: "Could not confirm the visit." });
    }
    if (!reservation || !isRequestOwnedByUser(actor, reservation)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to confirm this visit.",
      });
    }

    const facility = Array.isArray(reservation.facilities)
      ? reservation.facilities[0]
      : reservation.facilities;
    const email = reservation.email;
    const name = reservation.name;
    const facilityName = reservation.request_data?.facilityName || facility?.name || "";
    const date = reservation.date;
    const startTime = reservation.start_time;
    const endTime = reservation.end_time;
    const appointmentDate = reservation.appointment_date;
    const appointmentTime = reservation.appointment_time;
    if (!email)
      return res.status(400).json({ success: false, message: "No email is available for this request." });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Visit Confirmed: ${facilityName} on ${formatDateOnly(date) || date}`,
      html: buildEmailHtml(
        "Visit Slot Confirmed",
        `<p>Dear <strong>${name}</strong>,</p>
         <p>You have confirmed your visit slot for the reservation below. Please come to the Administration Office on the scheduled date and time.</p>
         ${buildDetailTable([
           { label: "Facility", value: facilityName },
           { label: "Event Date", value: formatDateOnly(date) || date },
           { label: "Event Time", value: `${startTime} � ${endTime}` },
           {
             label: "Your Visit Date",
             value: formatDateOnly(appointmentDate) || appointmentDate,
             highlight: true,
           },
           {
             label: "Your Visit Time",
             value: appointmentTime,
             highlight: true,
           },
         ])}
         <p>Please bring a valid ID and any required documents. If you need to change your schedule, contact the Administration Office as soon as possible.</p>`,
      ),
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`? Visit confirmation sent to ${email}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(
        `? Failed to send visit confirmation to ${email}:`,
        err.message,
      );
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Block Cancellation Notification (existing) ------------------------------

  router.post("/api/notify-cancellation", requireAdmin, async (req, res) => {
    const { email, name, facilityName, date, startTime, endTime, reason } =
      req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "No email provided" });

    // Convert 24h times to 12h for the email
    const timeDisplay = `${convertTo12Hour(startTime)} � ${convertTo12Hour(endTime)}`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Reservation Cancelled: ${facilityName} on ${formatDateOnly(date) || date}`,
      html: buildEmailHtml(
        "?? Reservation Cancelled by Administration",
        `<p>Dear <strong>${name}</strong>,</p>
         <p>We regret to inform you that your reservation has been <strong>cancelled</strong> due to a facility block applied by the administration.</p>
         ${buildDetailTable([
           { label: "Facility", value: facilityName },
           { label: "Date", value: formatDateOnly(date) || date },
           { label: "Time", value: timeDisplay },
           { label: "Reason", value: reason, highlight: true },
         ])}
         <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:13px;color:#92400e;">
           <strong>Next Steps:</strong> Please contact the Administration Office to reschedule your reservation at an available date.
         </div>`,
        { titleColor: "#991b1b" },
      ),
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`? Cancellation notice sent to ${email}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(
        `? Failed to send cancellation notice to ${email}:`,
        err.message,
      );
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Cancellation OTP � Send -------------------------------------------------

  router.post("/api/send-cancellation-otp", async (req, res) => {
    const actor = await getRequestActor(req);
    if (!actor.ok) {
      return res.status(actor.status || 401).json({
        success: false,
        message: actor.message || "Authentication is required.",
      });
    }
    const { requestId } = req.body || {};
    if (typeof requestId !== "string" || !requestId) {
      return res
        .status(400)
        .json({ success: false, message: "requestId is required" });
    }
    const { data: reservation, error: reservationError } =
      await createServiceRoleSupabaseClient()
        .from("reservations")
        .select("reservation_code,staff_id,guest_id,contact,email,name")
        .eq("reservation_code", requestId)
        .maybeSingle();
    if (reservationError) {
      console.error("Could not load request for cancellation verification:", reservationError);
      return res.status(500).json({ success: false, message: "Could not verify the request." });
    }
    if (
      !reservation ||
      actor.kind !== "user" ||
      !isRequestOwnedByUser(actor, reservation)
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to cancel this request.",
      });
    }
    const email = reservation.email;
    const name = reservation.name;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "No email is available for this request.",
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(requestId, {
      code,
      email,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: "Cancellation Verification Code � BCHS Reservation",
        html: buildEmailHtml(
          "Cancellation Verification Code",
          `<p>Dear <strong>${name || "Requester"}</strong>,</p>
           <p>You have requested to cancel a reservation. Please use the code below to verify your identity.</p>
           <p style="font-size:2em;font-weight:700;letter-spacing:0.3em;text-align:center;color:#800020;">${code}</p>
           <p>This code expires in <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>`,
        ),
      });
      console.log(`? OTP sent to ${email} for request ${requestId}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(`? Failed to send OTP to ${email}:`, err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Cancellation OTP � Verify -----------------------------------------------

  router.post("/api/verify-cancellation-otp", async (req, res) => {
    const actor = await getRequestActor(req);
    if (!actor.ok) {
      return res.status(actor.status || 401).json({
        success: false,
        message: actor.message || "Authentication is required.",
      });
    }
    const { requestId, code } = req.body || {};
    if (typeof requestId !== "string" || !requestId) {
      return res.status(400).json({ valid: false, message: "requestId is required." });
    }
    const { data: reservation, error } = await createServiceRoleSupabaseClient()
      .from("reservations")
      .select("reservation_code,staff_id,guest_id,contact,email")
      .eq("reservation_code", requestId)
      .maybeSingle();
    if (error) {
      console.error("Could not load request for cancellation verification:", error);
      return res.status(500).json({ valid: false, message: "Could not verify the request." });
    }
    if (
      actor.kind !== "user" ||
      !reservation ||
      !isRequestOwnedByUser(actor, reservation)
    ) {
      return res.status(403).json({ valid: false, message: "You do not have permission to cancel this request." });
    }
    const stored = otpStore.get(requestId);

    if (!stored || Date.now() > stored.expiresAt || stored.email !== reservation.email || stored.code !== code) {
      if (stored) {
        stored.attempts += 1;
        if (stored.attempts >= 5 || Date.now() > stored.expiresAt) {
          otpStore.delete(requestId);
        }
      }
      return res.status(200).json({ valid: false });
    }

    otpStore.delete(requestId);
    res.status(200).json({ valid: true });
  });

  // --- Rejection Notification --------------------------------------------------

  router.post("/api/notify-rejection", requireAdmin, async (req, res) => {
    const { email, name, facilityName, date, reason } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "No email provided" });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Reservation Request Rejected: ${facilityName} on ${formatDateOnly(date) || date}`,
      html: buildEmailHtml(
        "Reservation Request Rejected",
        `<p>Dear <strong>${name}</strong>,</p>
         <p>We regret to inform you that your reservation request has been <strong>rejected</strong>.</p>
         ${buildDetailTable([
           { label: "Facility", value: facilityName },
           { label: "Date", value: formatDateOnly(date) || date },
           { label: "Reason", value: reason, highlight: true },
         ])}
         <p>If you have questions, please contact the Administration Office.</p>`,
        { titleColor: "#991b1b" },
      ),
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`? Rejection notice sent to ${email}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(`? Failed to send rejection notice:`, err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });
  return { router, checkAndSendReminders };
}
