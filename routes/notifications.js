const express = require("express");
const fs = require("fs");
const path = require("path");
const { getWorkingDaysUntil, formatDateOnly } = require("../scripts/DateUtils");
const { buildEmailHtml, buildDetailTable } = require("../scripts/EmailBuilder");

module.exports = function createNotificationRouter({ dataDir }) {
  const router = express.Router();
  const repoDataDir = dataDir;
  const otpStore = new Map();
  // --- Email Reminder Logic ----------------------------------------------------

  const transporter = require("../services/mailer");

  // getWorkingDaysUntil is imported from ./scripts/DateUtils

  async function checkAndSendReminders() {
    try {
      const requestsPath = path.join(repoDataDir, "requests.json");
      if (!fs.existsSync(requestsPath)) return;

      const data = JSON.parse(fs.readFileSync(requestsPath, "utf8"));
      if (!Array.isArray(data.requests)) return;

      let changed = false;

      for (const req of data.requests) {
        if (req.status !== "approved") continue;
        if (req.paymentStatus === "paid") continue;
        if (req.reminderSent) continue;

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
          req.reminderSent = true;
          changed = true;
          console.log(`Reminder sent to ${req.email} for request ${req.id}`);
        } catch (mailErr) {
          console.error(
            `Failed to send reminder to ${req.email}:`,
            mailErr.message,
          );
        }
      }

      if (changed) {
        fs.writeFileSync(requestsPath, JSON.stringify(data, null, 2), "utf8");
      }
    } catch (err) {
      console.error("Error in checkAndSendReminders:", err.message);
    }
  }

  // --- Appointment Visit Notification -----------------------------------------

  router.post("/api/notify-appointment", async (req, res) => {
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

  router.post("/api/notify-visit-options", async (req, res) => {
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

  router.post("/api/notify-cancellation", async (req, res) => {
    const { email, name, facilityName, date, startTime, endTime, reason } =
      req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "No email provided" });

    // Convert 24h times to 12h for the email
    const { convertTo12Hour } = require("./scripts/DateUtils");
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
    const { requestId, email, name } = req.body;
    if (!requestId || !email) {
      return res
        .status(400)
        .json({ success: false, message: "requestId and email are required" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(requestId, { code, expiresAt: Date.now() + 10 * 60 * 1000 });

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

  router.post("/api/verify-cancellation-otp", (req, res) => {
    const { requestId, code } = req.body;
    const stored = otpStore.get(requestId);

    if (!stored || Date.now() > stored.expiresAt || stored.code !== code) {
      return res.status(200).json({ valid: false });
    }

    otpStore.delete(requestId);
    res.status(200).json({ valid: true });
  });

  // --- Rejection Notification --------------------------------------------------

  router.post("/api/notify-rejection", async (req, res) => {
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
  return { router, transporter, checkAndSendReminders };
};
