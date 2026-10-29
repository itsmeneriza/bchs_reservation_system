/**
 * Admin Payments Module
 * Payment management: rendering, status cycling, down payment & balance tracking.
 */

// ─── Filter / Clear ───────────────────────────────────────────────────────────

function filterPayments() {
  const name = (
    document.getElementById("payment-search-name")?.value || ""
  ).toLowerCase();
  const facility =
    document.getElementById("payment-filter-facility")?.value || "";
  const status = document.getElementById("payment-filter-status")?.value || "";

  document.querySelectorAll("#paidTableBody tr[data-id]").forEach((row) => {
    const matchName =
      !name || (row.dataset.name || "").toLowerCase().includes(name);
    const matchFacility = !facility || row.dataset.facility === facility;
    const matchStatus = !status || row.dataset.status === status;
    row.style.display = matchName && matchFacility && matchStatus ? "" : "none";
  });
}

function clearPaymentFilters() {
  [
    "payment-search-name",
    "payment-filter-facility",
    "payment-filter-status",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  filterPayments();
}

// ─── Render Payments Tab ──────────────────────────────────────────────────────

function renderPayments() {
  const body = document.getElementById("paidTableBody");
  if (!body) return;

  const approved = requests.filter(
    (r) => r.status === "approved" && !r.isSchoolEvent,
  );

  // ── Collect payment totals ────────────────────────────────────────────────
  // For each approved booking we track:
  //   amountCollected  — what has actually been paid so far
  //   amountOutstanding — what is still owed
  // Staff bookings (free) are excluded from the financial totals entirely.

  let totalCollected = 0;
  let totalOutstanding = 0;

  approved.forEach((b) => {
    const isStaff = isStaffRequest(b);
    if (isStaff) return; // free — nothing to collect or track

    const total = parseFloat(b.totalAmount) || 0;
    if (total === 0) return; // zero-amount entries don't affect the rate

    const downAmt = computeDownPayment(total);
    const remainingAmt = Math.max(0, total - downAmt);
    const downPaid = b.downPaymentPaid || false;
    const remainingPaid = b.remainingBalancePaid || false;

    // Use the checkbox flags as the source of truth for what's actually paid.
    // Fall back to paymentStatus when flags aren't set (older records).
    let collected = 0;
    if (b.paymentStatus === "paid" || (downPaid && remainingPaid)) {
      collected = total;
    } else if (downPaid) {
      collected = downAmt;
    } else if (b.paymentStatus === "pending") {
      // paymentStatus 'pending' means a partial payment exists —
      // treat as down payment collected when checkbox isn't set.
      collected = downAmt;
    }
    // 'unpaid' → collected stays 0

    totalCollected += collected;
    totalOutstanding += total - collected;
  });

  const totalInvoiced = totalCollected + totalOutstanding;
  const collectionRate =
    totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  document.getElementById("totalCollectedValue").textContent =
    `₱${totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  document.getElementById("totalPendingValue").textContent =
    `₱${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  document.getElementById("collectionRateValue").textContent =
    `${collectionRate}%`;

  body.innerHTML = approved.length
    ? approved
        .map((b) => {
          const isStaff = isStaffRequest(b);
          const downPaid = isStaff || b.downPaymentPaid || false;
          const remainingPaid = isStaff || b.remainingBalancePaid || false;
          const totalAmount = parseFloat(b.totalAmount) || 0;
          const downPaymentAmount = computeDownPayment(totalAmount);
          const remainingBalance = Math.max(0, totalAmount - downPaymentAmount);
          const effectiveStatus = isStaff
            ? "paid"
            : b.paymentStatus || "pending";

          return `
        <tr data-id="${b.id}" data-name="${b.name.toLowerCase()}" data-facility="${b.facilityId}" data-status="${effectiveStatus}">
            <td><strong>${b.name}</strong></td>
            <td><span class="badge badge-secondary">${getFacilityName(b.facilityId)}</span></td>
            <td>${formatDateSimple(b.date)}</td>
            <td><strong>₱${totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
            <td>
                <div style="display:flex;gap:6px;margin-bottom:6px;">
                    <button class="btn btn-sm ${downPaid ? "btn-success" : "btn-outline"}"
                            onclick="${isStaff ? "" : `toggleDownPayment('${b.id}',${!downPaid})`}"
                            ${isStaff ? "disabled" : ""}
                            style="flex:1;font-size:11px;padding:6px 8px;${downPaid ? "background:#22c55e;color:white;border-color:#22c55e;" : ""}">
                        ${downPaid ? "Paid" : "Unpaid"} Down (₱${downPaymentAmount.toLocaleString("en-PH", { minimumFractionDigits: 0 })})
                    </button>
                    <button class="btn btn-sm ${remainingPaid ? "btn-success" : "btn-outline"}"
                            onclick="${isStaff ? "" : `toggleRemainingBalance('${b.id}',${!remainingPaid})`}"
                            ${isStaff ? "disabled" : ""}
                            style="flex:1;font-size:11px;padding:6px 8px;${remainingPaid ? "background:#22c55e;color:white;border-color:#22c55e;" : ""}">
                        ${remainingPaid ? "Paid" : "Unpaid"} Balance (₱${remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 0 })})
                    </button>
                </div>
            </td>
            <td>
                <span class="badge badge-interactive ${getPaymentBadgeClass(effectiveStatus)}"
                      onclick="${isStaff ? "" : `cyclePaymentStatus('${b.id}','${effectiveStatus}')`}"
                      style="${isStaff ? "cursor:default;opacity:0.85;" : ""}">
                    ${isStaff ? "PAID (Staff)" : effectiveStatus.toUpperCase()}
                </span>
            </td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="openEditModal('${b.id}','VIEW_ONLY')" style="font-size:11px;padding:4px 8px;width:100%;">
                    View Details
                </button>
            </td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="7" style="text-align:center;padding:30px;color:#6b7280;">No approved reservations found</td></tr>';
}

function getPaymentBadgeClass(status) {
  if (status === "paid") return "badge-paid";
  if (status === "unpaid") return "badge-unpaid";
  return "badge-pending";
}

// ─── Payment Cycle ────────────────────────────────────────────────────────────

window.cyclePaymentStatus = async (id, currentStatus) => {
  const req = requests.find((r) => r.id === id);
  if (!req) return;
  // Do not allow changing overall tracking once it's marked fully paid
  if (req.paymentStatus === "paid") {
    showToast("Payment already marked PAID and cannot be changed", "error");
    return;
  }
  const map = { pending: "paid", unpaid: "pending" }; // prevent paid->unpaid transition
  const next = map[currentStatus || req.paymentStatus || "pending"] || "pending";
  const saved = await patchRequest(id, { paymentStatus: next });
  if (!saved) {
    showToast("Could not update payment status. Please try again.", "error");
    return;
  }
  await loadData();
  showToast(`Payment marked as ${next}`, "success");
};

window.toggleDownPayment = async (id, newState) => {
  const req = requests.find((r) => r.id === id);
  if (!req) return;
  // Prevent reversing payment flags when the overall payment tracking is already fully paid
  if (req.paymentStatus === "paid" && !newState) {
    showToast(
      "Cannot reverse down payment: payment already marked PAID",
      "error",
    );
    return;
  }
  const remainingPaid = req.remainingBalancePaid || false;
  const paymentStatus =
    !newState && !remainingPaid
      ? "unpaid"
      : newState && remainingPaid
        ? "paid"
        : "pending";
  const saved = await patchRequest(id, {
    downPaymentPaid: newState,
    paymentStatus,
  });
  if (!saved) {
    showToast("Could not update payment status. Please try again.", "error");
    return;
  }
  await loadData();
  showToast(
    newState ? "Down payment marked as paid" : "Down payment reversed",
    newState ? "success" : "info",
  );
};

window.toggleRemainingBalance = async (id, newState) => {
  const req = requests.find((r) => r.id === id);
  if (!req) return;
  // Prevent reversing remaining balance when overall payment tracking is already fully paid
  if (req.paymentStatus === "paid" && !newState) {
    showToast(
      "Cannot reverse remaining balance: payment already marked PAID",
      "error",
    );
    return;
  }
  const downPaid = req.downPaymentPaid || false;
  const paymentStatus =
    !downPaid && !newState
      ? "unpaid"
      : downPaid && newState
        ? "paid"
        : "pending";
  const saved = await patchRequest(id, {
    remainingBalancePaid: newState,
    paymentStatus,
  });
  if (!saved) {
    showToast("Could not update payment status. Please try again.", "error");
    return;
  }
  await loadData();
  showToast(
    newState
      ? "Remaining balance marked as paid"
      : "Remaining balance reversed",
    newState ? "success" : "info",
  );
};

window.updateInlinePayment = async (id, amount) => {
  const saved = await patchRequest(id, {
    totalAmount: parseFloat(amount) || 0,
  });
  if (!saved) {
    showToast("Could not update payment amount. Please try again.", "error");
    return;
  }
  await loadData();
  showToast("Amount updated", "success");
};
