/**
 * Admin Calendar
 * Renders the monthly calendar grid and handles day-click actions.
 */

// ─── Render ───────────────────────────────────────────────────────────────────

function renderCalendar() {
  const el = document.getElementById("calendar");
  const my = document.getElementById("currentMonthYear");
  if (!el) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  my.textContent = new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const active = requests.filter(
    (r) => r.status === "approved" || r.status === "blocked",
  );

  const currentRoomFilter = document.getElementById("facilityFilter").value;
  const currentRoomId =
    currentRoomFilter === "all" ? "global" : currentRoomFilter.toLowerCase();

  let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<div class="calendar-header-cell">${d}</div>`)
    .join("");

  for (let i = 0; i < first; i++)
    html += `<div class="calendar-day empty"></div>`;

  const todayStr = new Date().toISOString().split("T")[0];

  for (let d = 1; d <= days; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isPast = dateStr < todayStr;
    const dayEntries = active.filter((b) => b.date === dateStr);

    const isManuallyBlocked = dayEntries.some(
      (e) =>
        e.status === "blocked" &&
        (e.facilityId === currentRoomId || e.facilityId === "global") &&
        e.isFullDayBlock === true,
    );
    const hasOtherEntries = dayEntries.some(
      (e) =>
        e.status === "approved" ||
        (e.status === "blocked" && !e.isFullDayBlock),
    );
    const schoolEvents = dayEntries.filter((e) => e.isSchoolEvent);

    const allDots = dayEntries
      .map((e) => {
        if (e.isSchoolEvent)
          return `<span class="dot dot-event" title="${e.name}"></span>`;
        if (e.status === "blocked") return `<span class="dot dot-red"></span>`;
        return `<span class="dot"></span>`;
      })
      .join("");
    const dots = allDots
      ? `<div class="reservation-dots">${allDots}</div>`
      : "";

    html += `
            <div class="calendar-day
                ${isPast ? "is-past-day" : ""}
                ${hasOtherEntries ? "has-reservations" : ""}
                ${isManuallyBlocked ? "is-manually-blocked" : ""}
                ${schoolEvents.length ? "has-events" : ""}"
                ${isPast ? "" : `onclick="handleDayToggle('${dateStr}')"`}>
                <span class="day-number">${d}</span>
                ${dots}
            </div>`;
  }
  el.innerHTML = html;
}

// ─── Day Toggle Modal ─────────────────────────────────────────────────────────

let _pendingDayActionDate = null;

window.closeDayActionModal = () => {
  document.getElementById("dayActionModal").classList.remove("active");
  _pendingDayActionDate = null;
};

window._setPendingDayActionDate = (d) => {
  _pendingDayActionDate = d;
};
window._getPendingDayActionDate = () => _pendingDayActionDate;

async function handleDayToggle(dateStr) {
  _pendingDayActionDate = dateStr;
  document.getElementById("dayActionDateLabel").textContent =
    formatDateSimple(dateStr);

  const dayEvents = requests.filter(
    (r) => r.isSchoolEvent && r.date === dateStr,
  );
  const dayBlocks = requests.filter(
    (r) => r.status === "blocked" && r.isFullDayBlock && r.date === dateStr,
  );
  const dayReservations = requests.filter(
    (r) => r.status === "approved" && !r.isSchoolEvent && r.date === dateStr,
  );
  const existing = [...dayEvents, ...dayBlocks, ...dayReservations];

  const existingSection = document.getElementById("dayActionExisting");
  const existingList = document.getElementById("dayActionExistingList");

  if (existing.length > 0) {
    existingSection.style.display = "block";
    existingList.innerHTML = existing
      .map((entry) => {
        const isEvent = entry.isSchoolEvent;
        const isBlock = entry.status === "blocked";

        const label = isEvent
          ? entry.name
          : isBlock
            ? `Block — ${getRoomName(entry.facilityId)}`
            : entry.name;

        const sub = isEvent
          ? `${convertTo12Hour(entry.startTime)}–${convertTo12Hour(entry.endTime)} · ${getRoomName(entry.facilityId)}`
          : isBlock
            ? entry.purpose.replace("ADMIN MANUAL BLOCK: ", "")
            : `${convertTo12Hour(entry.startTime)}–${convertTo12Hour(entry.endTime)} · ${getRoomName(entry.facilityId)}`;

        const badgeStyle = isEvent
          ? "background:#fef3c7;color:#92400e;"
          : isBlock
            ? "background:#fee2e2;color:#991b1b;"
            : "background:#dbeafe;color:#1e40af;";
        const badgeText = isEvent ? "Event" : isBlock ? "Block" : "Reserved";

        const rawEvId = DateUtils.normalizeEventId(entry.id);

        const editBtn = isEvent
          ? `<button class="btn btn-outline btn-sm" onclick="closeDayActionModal();setTimeout(()=>openEditEventModal('${rawEvId}'),50)">Edit</button>`
          : isBlock
            ? `<button class="btn btn-outline btn-sm" onclick="closeDayActionModal();setTimeout(()=>openEditBlockModal('${entry.id}','${dateStr}'),50)">Edit</button>`
            : `<button class="btn btn-outline btn-sm" onclick="closeDayActionModal();setTimeout(()=>openEditModal('${entry.id}','FULL_EDIT'),50)">Manage</button>`;

        const removeBtn = isEvent
          ? `<button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;" onclick="closeDayActionModal();deleteEventFromSchedule('${rawEvId}')">Delete</button>`
          : isBlock
            ? `<button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;" onclick="closeDayActionModal();quickUnblock('${entry.id}','${dateStr}')">Unblock</button>`
            : "";

        return `
                <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;">
                    <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;flex-shrink:0;${badgeStyle}">${badgeText}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
                        <div style="font-size:11px;color:#64748b;">${sub}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">${editBtn}${removeBtn}</div>
                </div>`;
      })
      .join("");
  } else {
    existingSection.style.display = "none";
    existingList.innerHTML = "";
  }

  document.getElementById("dayActionModal").classList.add("active");
}
