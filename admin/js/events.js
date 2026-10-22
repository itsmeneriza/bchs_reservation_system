/**
 * Admin Events Module
 * School event creation, editing, deletion, and list rendering.
 */

// ─── Open / Close Modal ───────────────────────────────────────────────────────

function openAddEventModal(date) {
  const modal = document.getElementById("addEventModal");
  const timeOptions = buildTimeOptions();
  document.getElementById("eventDate").value =
    date || new Date().toISOString().split("T")[0];
  document.getElementById("eventStartTime").innerHTML = timeOptions;
  document.getElementById("eventEndTime").innerHTML = timeOptions;
  document.getElementById("eventStartTime").value = "08:00";
  document.getElementById("eventEndTime").value = "10:00";
  modal.classList.add("active");
  ["eventStartTime", "eventEndTime"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener("change", refreshEventConflicts);
      el.addEventListener("change", refreshEventConflicts);
    }
  });
  refreshEventConflicts();
}

window.closeAddEventModal = () => {
  const modal = document.getElementById("addEventModal");
  const saveBtn = document.getElementById("saveEventBtn");
  modal.querySelector(".modal-header h2").textContent = "Post New School Event";
  saveBtn.textContent = "Post Event";
  saveBtn.onclick = saveNewEvent;
  delete saveBtn._editingId;
  modal.classList.remove("active");
};

// ─── Save (Create / Update) ───────────────────────────────────────────────────

async function saveNewEvent() {
  const title = document.getElementById("eventTitle").value.trim();
  const date = document.getElementById("eventDate").value;
  const startVal = document.getElementById("eventStartTime").value;
  const endVal = document.getElementById("eventEndTime").value;
  const location = document.getElementById("eventLocation").value;
  const description = document.getElementById("eventDescription").value.trim();
  const imageUrl = document.getElementById("eventImageUrl").value.trim();

  if (!title || !date || !startVal || !endVal || !description) {
    alert(
      "Please fill in all required fields (Title, Date, Time, Description).",
    );
    return;
  }
  if (startVal >= endVal) {
    alert("Start time must be earlier than end time.");
    return;
  }

  // Hard conflict check — block save if time overlaps any existing reservation
  const facilityId = location.toLowerCase();
  const saveBtn = document.getElementById("saveEventBtn");
  const excludeId = saveBtn._editingId ? "event_" + saveBtn._editingId : null;
  const existingConflict = adminCheckConflict(
    facilityId,
    date,
    startVal,
    endVal,
    excludeId,
  );
  if (existingConflict) {
    const isBlock = existingConflict.status === "blocked";
    showToast(
      isBlock
        ? `Cannot save: facility is blocked for this time slot.`
        : `Cannot save: time conflicts with "${existingConflict.name}" (${existingConflict.startTime}–${existingConflict.endTime}).`,
      "error",
    );
    return;
  }

  const time = `${convertTo12Hour(startVal)} - ${convertTo12Hour(endVal)}`;

  const editingId = saveBtn._editingId;

  if (editingId) {
    const saved = await _updateEvent(editingId, {
      title,
      date,
      time,
      location,
      description,
      imageUrl,
      startVal,
      endVal,
    });
    if (!saved) return;
  } else {
    const saved = await _createEvent({
      title,
      date,
      time,
      location,
      description,
      imageUrl,
      startVal,
      endVal,
    });
    if (!saved) return;
  }

  saveBtn.textContent = "Post Event";
  delete saveBtn._editingId;

  closeAddEventModal();
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventDescription").value = "";
  document.getElementById("eventImageUrl").value = "";

  if (editingId) {
    await loadData();
  } else {
    renderCalendar();
    renderAdminEvents();
    renderUpcoming();
  }
}

async function _updateEvent(
  editingId,
  { title, date, time, location, description, imageUrl, startVal, endVal },
) {
  const updatedEvent = {
    title,
    date,
    time,
    location,
    attendees: 0,
    description,
    image: imageUrl || randomGradient(),
  };
  try {
    const res = await window.adminFetch(`/api/events/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedEvent),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.message || `PUT failed: ${res.status}`);
    }
  } catch (e) {
    showToast("Failed to update event: " + e.message, "error");
    return false;
  }

  // Sync the linked reservation entry
  const linkedReqId = "event_" + editingId;
  try {
    await fetch(`/api/requests/${linkedReqId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: title,
        date,
        startTime: startVal,
        endTime: endVal,
        purpose: description,
        facilityId: location.toLowerCase(),
        facilityName: location,
      }),
    });
  } catch (_) {}

  // Update in-memory
  const idx = adminEvents.findIndex(
    (e) => e.id === editingId || e.id === String(editingId),
  );
  if (idx !== -1)
    adminEvents[idx] = {
      ...adminEvents[idx],
      title,
      date,
      time,
      location,
      description,
      image: imageUrl || adminEvents[idx].image,
    };

  showToast("Event updated successfully!", "success");
  return true;
}

async function _createEvent({
  title,
  date,
  time,
  location,
  description,
  imageUrl,
  startVal,
  endVal,
}) {
  const newEvent = {
    id: Date.now().toString(),
    title,
    date,
    time,
    location,
    attendees: 0,
    description,
    image: imageUrl || randomGradient(),
  };

  try {
    const res = await window.adminFetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEvent),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.message || `POST failed: ${res.status}`);
    }
  } catch (e) {
    showToast("Failed to save event: " + e.message, "error");
    return false;
  }

  // Create a linked approved reservation to block the slot on the calendar
  const reservation = {
    id: "event_" + newEvent.id,
    facilityId: location.toLowerCase(),
    facilityName: location,
    name: title,
    contact: "School Event",
    email: "admin@bchs.edu",
    date,
    startTime: startVal,
    endTime: endVal,
    purpose: description,
    attendees: 0,
    status: "approved",
    paymentStatus: "paid",
    totalAmount: 0,
    isSchoolEvent: true,
    submittedAt: new Date().toISOString(),
  };
  try {
    await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reservation),
    });
  } catch (e) {
    console.warn(
      "[WARN] Event saved but reservation slot could not be created.",
    );
  }

  showToast("New school event posted successfully!", "success");
  return true;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

window.deleteEvent = async function (id) {
  if (!confirm("Delete this event? This cannot be undone.")) return;
  try {
    const res = await window.adminFetch(`/api/events/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Server returned " + res.status);
    const linkedReqId = "event_" + id;
    try {
      await fetch(`/api/requests/${linkedReqId}`, { method: "DELETE" });
    } catch (_) {}
    requests = requests.filter(
      (r) => r.id !== "evt_" + id && r.id !== linkedReqId,
    );
    adminEvents = adminEvents.filter((e) => e.id !== id && e.id !== String(id));
  } catch (e) {
    showToast("Failed to delete event. Is the server running?", "error");
    return;
  }
  showToast("Event deleted successfully", "success");
  renderCalendar();
  renderAdminEvents();
  renderUpcoming();
};

window.deleteEventFromSchedule = async (id) => {
  if (!confirm("Delete this event? This cannot be undone.")) return;
  const linkedReqId = "event_" + id;
  try {
    const res = await window.adminFetch(`/api/events/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Server returned " + res.status);
    try {
      await fetch(`/api/requests/${linkedReqId}`, { method: "DELETE" });
    } catch (_) {}
  } catch (e) {
    showToast("Failed to delete event: " + e.message, "error");
    return;
  }
  requests = requests.filter(
    (r) => r.id !== "evt_" + id && r.id !== linkedReqId && r.id !== id,
  );
  adminEvents = adminEvents.filter((e) => e.id !== id && e.id !== String(id));
  renderCalendar();
  renderAdminEvents();
  renderUpcoming();
  showToast("Event deleted successfully", "success");
};

// ─── Edit Modal ───────────────────────────────────────────────────────────────

window.openEditEventModal = (id) => {
  const rawId = DateUtils.normalizeEventId(id);
  const ev = adminEvents.find((e) => e.id === rawId || e.id === String(rawId));
  if (!ev) return;

  const timeOptions = buildTimeOptions();
  document.getElementById("eventStartTime").innerHTML = timeOptions;
  document.getElementById("eventEndTime").innerHTML = timeOptions;
  document.getElementById("eventTitle").value = ev.title || "";
  document.getElementById("eventDate").value = ev.date || "";
  document.getElementById("eventDescription").value = ev.description || "";
  document.getElementById("eventImageUrl").value = ev.image || "";
  document.getElementById("eventLocation").value = ev.location || "Auditorium";

  const [start, end] = parseEventTime(ev.time);
  document.getElementById("eventStartTime").value = start;
  document.getElementById("eventEndTime").value = end;

  const saveBtn = document.getElementById("saveEventBtn");
  saveBtn.textContent = "Update Event";
  saveBtn._editingId = rawId;
  saveBtn.onclick = saveNewEvent;

  document
    .getElementById("addEventModal")
    .querySelector(".modal-header h2").textContent = "Edit School Event";
  document.getElementById("addEventModal").classList.add("active");
  ["eventStartTime", "eventEndTime"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener("change", refreshEventConflicts);
      el.addEventListener("change", refreshEventConflicts);
    }
  });
  refreshEventConflicts();
};

// ─── List Render ──────────────────────────────────────────────────────────────

function renderAdminEvents() {
  const container = document.getElementById("admin-events-list");
  const countEl = document.getElementById("events-count");
  if (!container) return;

  if (countEl)
    countEl.textContent = `${adminEvents.length} event${adminEvents.length !== 1 ? "s" : ""}`;

  if (adminEvents.length === 0) {
    container.innerHTML =
      '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px 0;">No events posted yet.</p>';
    return;
  }

  const sorted = [...adminEvents].sort((a, b) => a.date.localeCompare(b.date));
  container.innerHTML = sorted
    .map((ev) => {
      const isPast = new Date(ev.date) < new Date(new Date().toDateString());
      return `
        <div class="event-list-card" onclick="openEditEventModal('${ev.id}')"
             style="display:flex;justify-content:space-between;align-items:center;background:${isPast ? "#f8fafc" : "#fff"};border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;gap:12px;cursor:pointer;transition:background 0.15s;">
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-weight:700;font-size:14px;color:#1e293b;">${ev.title}</span>
                    ${
                      isPast
                        ? '<span style="font-size:11px;background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:999px;">Past</span>'
                        : '<span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;">Upcoming</span>'
                    }
                </div>
                <div style="font-size:12px;color:#64748b;margin-top:3px;">${formatDateSimple(ev.date)} &bull; ${ev.time} &bull; ${ev.location}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ev.description}</div>
            </div>
            <button class="event-delete-btn" data-id="${ev.id}"
                style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                Delete
            </button>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".event-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteEvent(btn.dataset.id);
    });
  });
}
