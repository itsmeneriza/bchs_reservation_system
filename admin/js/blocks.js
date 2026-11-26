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

function formatBlockRescheduleReason(reason) {
  const detail = String(reason || "facility unavailable").replace(
    /^BLOCKED:\s*/i,
    "",
  );
  return `BLOCKED: ${detail}`;
}

// ─── Open Block Modal ─────────────────────────────────────────────────────────

async function openQuickBlock(dateStr) {
  const dateLabel = document.getElementById("quickBlockDateLabel");
  dateLabel.textContent = formatDateSimple(dateStr);
  dateLabel.dataset.isoDate = dateStr;
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
                    <strong style="color:#b91c1c;">${escapeAdminText(getFacilityName(b.facilityId))}</strong>
                    <div style="font-size:11px;color:#64748b;">Reason: ${escapeAdminText(b.purpose.replace("ADMIN MANUAL BLOCK: ", ""))}</div>
                </div>
                <button class="btn btn-outline btn-sm" onclick="quickUnblock(${escapeAdminJsArgument(b.id)},${escapeAdminJsArgument(dateStr)})">Open Slot</button>
            </div>`,
      )
      .join("");

    // Disable checkboxes for already-blocked facilities
    dayBlocks.forEach((b) => {
      if (b.facilityId === "global") {
        document
          .querySelectorAll('input[name="facilityBlock"]')
          .forEach((checkbox) => {
            checkbox.disabled = true;
            checkbox.checked = true;
          });
        return;
      }
      const facilityCheckbox = Array.from(
        document.querySelectorAll(
          'input[name="facilityBlock"]:not([value="all"])',
        ),
      ).find((checkbox) => {
        const facility = facilities.find(
          (item) =>
            String(item.name).trim().toLowerCase() ===
              checkbox.value.trim().toLowerCase() ||
            String(item.id).trim().toLowerCase() ===
              checkbox.value.trim().toLowerCase(),
        );
        return (
          facility &&
          adminFacilitiesMatch(
            b.facilityId,
            b.facilityName,
            facility.id,
            facility.name,
          )
        );
      });
      if (facilityCheckbox) {
        facilityCheckbox.disabled = true;
        facilityCheckbox.checked = true;
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

async function rescheduleBlockConflicts(blocks) {
  const rescheduledRequests = [];
  const updateFailures = [];
  const notificationFailures = [];
  const processedConflictIds = new Set();

  for (const block of blocks) {
    const reason = formatBlockRescheduleReason(
      String(block.purpose || "").replace("ADMIN MANUAL BLOCK: ", ""),
    );
    const conflicts = requests.filter((r) => {
      if (!["approved", "accepted", "pending"].includes(r.status)) return false;
      if (r.blockReschedulePending === true || r.isSchoolEvent) return false;
      if (r.date !== block.date) return false;
      if (
        !adminFacilitiesMatch(
          block.facilityId,
          block.facilityName,
          r.facilityId,
          r.facilityName,
        )
      ) {
        return false;
      }
      if (block.isFullDayBlock) return true;
      return r.startTime < block.endTime && r.endTime > block.startTime;
    });

    for (const conflict of conflicts) {
      if (processedConflictIds.has(conflict.id)) continue;
      processedConflictIds.add(conflict.id);

      try {
        await requestBlockApi(
          `/api/requests/${conflict.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blockReschedulePending: true,
              blockRescheduleReason: formatBlockRescheduleReason(reason),
            }),
          },
          `Could not update conflicting reservation ${conflict.id}.`,
        );
      } catch (error) {
        updateFailures.push(error.message);
        continue;
      }

      conflict.blockReschedulePending = true;
      conflict.blockRescheduleReason = formatBlockRescheduleReason(reason);

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
                reason: conflict.blockRescheduleReason,
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

  return { rescheduledRequests, updateFailures, notificationFailures };
}

async function reconcileExistingFacilityBlocks() {
  const reasonUpdateFailures = [];
  let normalizedReasonCount = 0;
  for (const request of requests) {
    if (
      request.blockReschedulePending !== true ||
      !request.blockRescheduleReason ||
      /^BLOCKED:\s*/i.test(request.blockRescheduleReason)
    ) {
      continue;
    }

    const reason = formatBlockRescheduleReason(request.blockRescheduleReason);
    try {
      await requestBlockApi(
        `/api/requests/${request.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockRescheduleReason: reason }),
        },
        `Could not update the block reason for reservation ${request.id}.`,
      );
      request.blockRescheduleReason = reason;
      normalizedReasonCount++;
    } catch (error) {
      reasonUpdateFailures.push(error.message);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const existingBlocks = requests.filter(
    (request) =>
      request.status === "blocked" &&
      request.source === "walk_in" &&
      request.purpose?.startsWith("ADMIN MANUAL BLOCK: ") &&
      request.date >= today,
  );
  const result = await rescheduleBlockConflicts(existingBlocks);
  const { rescheduledRequests, updateFailures, notificationFailures } = result;

  if (rescheduledRequests.length > 0 || normalizedReasonCount > 0) {
    renderAll();
  }

  const failures = [
    ...reasonUpdateFailures,
    ...updateFailures,
    ...notificationFailures,
  ];
  if (rescheduledRequests.length > 0 || failures.length > 0) {
    showToast(
      `${rescheduledRequests.length} existing block conflict(s) moved to Rescheduling Requests. ${failures.join(" ")}`,
      failures.length > 0 ? "error" : "success",
    );
  }
}

// ─── Confirm Block ────────────────────────────────────────────────────────────

async function confirmQuickBlock() {
  const dateStr = document.getElementById("quickBlockDateLabel").dataset.isoDate;
  const reason = document.getElementById("quickBlockReason").value.trim();

  if (!dateStr) {
    showToast(
      "Could not determine the date to block. Please reopen the block dialog.",
      "error",
    );
    return;
  }

  if (!reason) {
    alert("Please provide a reason for blocking the facility.");
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
  const newBlocks = selectedFacilities.map((facilityName) => {
    const facility =
      facilityName === "all"
        ? null
        : facilities.find(
            (item) =>
              String(item.name).trim().toLowerCase() ===
                facilityName.trim().toLowerCase() ||
              String(item.id).trim().toLowerCase() ===
                facilityName.trim().toLowerCase(),
          );
    return {
      id:
        "block_" +
        Date.now() +
        "_" +
        Math.random().toString(36).substr(2, 5),
      source: "walk_in",
      facilityId: facilityName === "all" ? "global" : facility?.id,
      facilityName:
        facilityName === "all"
          ? "ALL FACILITIES"
          : facility?.name || facilityName,
      name: "ADMIN BLOCK",
      email: "admin@bchs.edu",
      date: dateStr,
      startTime,
      endTime,
      purpose: `ADMIN MANUAL BLOCK: ${reason}`,
      status: "blocked",
      isFullDayBlock: isFullDay,
      submittedAt: new Date().toISOString(),
    };
  });
  if (newBlocks.some((block) => !block.facilityId)) {
    showToast(
      "A selected facility is no longer available. Refresh and try again.",
      "error",
    );
    return;
  }

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

  const { rescheduledRequests, updateFailures, notificationFailures } =
    await rescheduleBlockConflicts(createdBlocks);

  const summary = [
    blockCreationFailure
      ? `${createdBlocks.length} of ${newBlocks.length} facility block(s) saved. ${blockCreationFailure.message}`
      : "Facilities blocked successfully.",
    `${rescheduledRequests.length} conflicting reservation(s) moved to Rescheduling Requests.`,
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
    window.activateTab("rescheduling");
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
