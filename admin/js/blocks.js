/**
 * Admin Blocks Module
 * Facility availability blocking and unblocking.
 */

async function requestBlockApi(url, options, fallbackMessage) {
  const response = await window.adminFetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      result.message || `${fallbackMessage} (HTTP ${response.status}).`,
    );
  }
  return result;
}

// ─── Open Block Modal ─────────────────────────────────────────────────────────

async function openQuickBlock(dateStr) {
  document.getElementById("quickBlockDateLabel").textContent =
    formatDateSimple(dateStr);
  document.getElementById("quickBlockReason").value = "";

  const startSel = document.getElementById("quickBlockStartTime");
  const endSel = document.getElementById("quickBlockEndTime");
  const timeOpts = buildTimeOptions();
  startSel.innerHTML = timeOpts;
  endSel.innerHTML = timeOpts;
  startSel.value = "07:00";
  endSel.value = "18:00";

  // Reset checkboxes
  document.querySelectorAll('input[name="facilityBlock"]').forEach((cb) => {
    cb.checked = false;
    cb.disabled = false;
  });

  // Show / disable already-blocked facilities
  const dayBlocks = requests.filter(
    (r) =>
      r.status === "blocked" && r.date === dateStr && r.isFullDayBlock === true,
  );
  const existingSection = document.getElementById("existingBlocksList");
  const container = document.getElementById("blocksContainer");

  if (dayBlocks.length > 0) {
    existingSection.style.display = "block";
    container.innerHTML = dayBlocks
      .map(
        (b) => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:white;border:1px solid #e2e8f0;padding:8px 12px;border-radius:6px;margin-bottom:6px;">
                <div style="font-size:13px;">
                    <strong style="color:#b91c1c;">${getFacilityName(b.facilityId)}</strong>
                    <div style="font-size:11px;color:#64748b;">Reason: ${b.purpose.replace("ADMIN MANUAL BLOCK: ", "")}</div>
                </div>
                <button class="btn btn-outline btn-sm" onclick="quickUnblock('${b.id}','${dateStr}')">Open Slot</button>
            </div>`,
      )
      .join("");

    // Disable checkboxes for already-blocked facilities
    dayBlocks.forEach((b) => {
      const cb = document.querySelector(
        `input[name="facilityBlock"][value="${getFacilityName(b.facilityId)}"]`,
      );
      if (cb) {
        cb.disabled = true;
        cb.checked = true;
      }
      if (b.facilityId === "global") {
        const allCb = document.querySelector(
          'input[name="facilityBlock"][value="all"]',
        );
        if (allCb) {
          allCb.disabled = true;
          allCb.checked = true;
        }
      }
    });
  } else {
    existingSection.style.display = "none";
    container.innerHTML = "";
  }

  document.getElementById("quickBlockModal").classList.add("active");
}

// ─── Edit Existing Block ──────────────────────────────────────────────────────

window.openEditBlockModal = async (blockId, dateStr) => {
  const block = requests.find((r) => r.id === blockId);
  if (!block) return;
  if (
    !confirm(
      "Edit this block? The current block will be removed and you can re-apply with updated settings.",
    )
  )
    return;

  try {
    await requestBlockApi(
      `/api/requests/${blockId}`,
      { method: "DELETE" },
      "Could not remove the existing block.",
    );
  } catch (error) {
    showToast(error.message, "error");
    return;
  }

  await loadData();
  await openQuickBlock(dateStr);
  document.getElementById("quickBlockReason").value = block.purpose.replace(
    "ADMIN MANUAL BLOCK: ",
    "",
  );
};

// ─── Confirm Block ────────────────────────────────────────────────────────────

async function confirmQuickBlock() {
  const dateStr = document.getElementById("quickBlockDateLabel").textContent;
  const reason = document.getElementById("quickBlockReason").value.trim();

  if (!reason) {
    alert("Please provide a reason for the facility cancellation.");
    return;
  }

  const selectedFacilities = Array.from(
    document.querySelectorAll(
      'input[name="facilityBlock"]:checked:not(:disabled)',
    ),
  ).map((cb) => cb.value);

  if (selectedFacilities.length === 0) {
    alert("Please select at least one facility to block.");
    return;
  }

  const startTime =
    document.getElementById("quickBlockStartTime").value || "07:00";
  const endTime = document.getElementById("quickBlockEndTime").value || "18:00";

  if (startTime >= endTime) {
    alert("Start time must be earlier than end time.");
    return;
  }

  const isFullDay = startTime === "07:00" && endTime === "18:00";
  const newBlocks = selectedFacilities.map((facilityName) => ({
    id: "block_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    source: "walk_in",
    facilityId: facilityName === "all" ? "global" : facilityName.toLowerCase(),
    facilityName: facilityName === "all" ? "ALL FACILITIES" : facilityName,
    name: "ADMIN BLOCK",
    email: "admin@bchs.edu",
    date: dateStr,
    startTime,
    endTime,
    purpose: `ADMIN MANUAL BLOCK: ${reason}`,
    status: "blocked",
    isFullDayBlock: isFullDay,
    submittedAt: new Date().toISOString(),
  }));

  const createdBlocks = [];
  let blockCreationFailure = null;
  try {
    for (const block of newBlocks) {
      await requestBlockApi(
        "/api/requests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(block),
        },
        "Could not save the facility block.",
      );
      createdBlocks.push(block);
    }
  } catch (error) {
    blockCreationFailure = error;
  }
  if (createdBlocks.length === 0) {
    await loadData();
    showToast(
      `0 of ${newBlocks.length} facility block(s) saved. ${blockCreationFailure.message}`,
      "error",
    );
    return;
  }

  // Move conflicting reservations to Confirmed tab for rescheduling
  const rescheduledRequests = [];
  const updateFailures = [];
  const notificationFailures = [];
  for (const block of createdBlocks) {
    const conflicts = requests.filter((r) => {
      if (r.status !== "approved" && r.status !== "pending") return false;
      if (r.date !== block.date) return false;
      const isGlobal = block.facilityId === "global";
      if (!isGlobal && r.facilityId !== block.facilityId) return false;
      return r.startTime < block.endTime && r.endTime > block.startTime;
    });

    for (const conflict of conflicts) {
      // Set appointmentDate to today with a past time so getConfirmedEditMode → RESCHEDULE_OR_REJECT
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const pastHour = now.getHours() - 2;
      const pastTime = `${String(Math.max(0, pastHour)).padStart(2, "0")}:00`;

      try {
        await requestBlockApi(
          `/api/requests/${conflict.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "pending",
              appointmentDate: todayStr,
              appointmentTime: pastTime,
              blockReschedulePending: true,
              blockRescheduleReason: reason,
            }),
          },
          `Could not update conflicting reservation ${conflict.id}.`,
        );
      } catch (error) {
        updateFailures.push(error.message);
        continue;
      }

      if (conflict.email) {
        try {
          await requestBlockApi(
            "/api/notify-cancellation",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: conflict.email,
                name: conflict.name,
                facilityName: conflict.facilityName,
                date: conflict.date,
                startTime: conflict.startTime,
                endTime: conflict.endTime,
                reason,
              }),
            },
            `Could not notify ${conflict.email}.`,
          );
        } catch (error) {
          notificationFailures.push(error.message);
        }
      }
      rescheduledRequests.push(conflict);
    }
  }

  const summary = [
    blockCreationFailure
      ? `${createdBlocks.length} of ${newBlocks.length} facility block(s) saved. ${blockCreationFailure.message}`
      : "Facilities blocked successfully.",
    `${rescheduledRequests.length} conflicting reservation(s) moved to Confirmed for rescheduling.`,
    ...updateFailures,
    ...notificationFailures,
  ].join(" ");
  closeQuickBlock();
  await loadData();
  showToast(
    summary,
    blockCreationFailure || updateFailures.length || notificationFailures.length
      ? "error"
      : "success",
  );

  if (rescheduledRequests.length > 0) {
    window.activateTab("confirmed");
  }
}

// ─── Unblock ──────────────────────────────────────────────────────────────────

window.quickUnblock = async (id, dateStr) => {
  if (!confirm("Re-open this facility?")) return;
  try {
    await requestBlockApi(
      `/api/requests/${id}`,
      { method: "DELETE" },
      "Could not re-open this facility.",
    );
  } catch (error) {
    showToast(error.message, "error");
    return;
  }
  showToast("Facility re-opened", "success");
  closeQuickBlock(); // safe no-op if modal wasn't open
  await loadData();
};

window.closeQuickBlock = () => {
  document.getElementById("quickBlockModal").classList.remove("active");
};
