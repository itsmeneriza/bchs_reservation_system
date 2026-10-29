/**
 * Chat Component
 * AI-powered assistant using the Gemini API via /api/chat.
 * All BCHS-specific knowledge is handled server-side via a system prompt.
 */

import { state, addChatMessage, setChatLoading } from "../core/state.js";

// Default suggestion chips shown after every assistant reply
const DEFAULT_CHIPS = [
  "How to reserve?",
  "Facility prices",
  "Facility capacity",
  "How to cancel?",
  "Check availability",
];
const CHAT_REQUEST_TIMEOUT_MS = 55000;
const OUT_OF_SCOPE_REPLY =
  "I can only help with BCHS facility reservations, including availability, pricing, policies, and booking procedures. What reservation question can I help with?";
const OFFLINE_FACILITIES = [
  { id: "auditorium", name: "Auditorium", capacity: 700, pricePerHour: 1800 },
  { id: "gym", name: "Gymnasium", capacity: 300, pricePerHour: 1000 },
  { id: "library", name: "Library", capacity: 100, pricePerHour: 1000 },
  { id: "grounds", name: "School Grounds", capacity: 180, pricePerHour: 700 },
  { id: "avr", name: "Audio-Visual Facility (AVR)", capacity: 150, pricePerHour: 500 },
];

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const stripHtmlTags = (value = "") =>
  String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|b|em|i|p|ul|ol|li|span)>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getOfflineReply = (question) => {
  const normalized = String(question || "").toLowerCase();
  const reservationKeywords = [
    "reserve",
    "reservation",
    "facility",
    "facilities",
    "availability",
    "available",
    "price",
    "pricing",
    "cost",
    "rate",
    "fee",
    "payment",
    "pay",
    "cancel",
    "cancellation",
    "refund",
    "facility",
    "gym",
    "auditorium",
    "library",
    "grounds",
    "avr",
    "date",
    "time",
    "slot",
    "booking",
    "admin office",
    "down payment",
    "capacity",
  ];

  if (!reservationKeywords.some((keyword) => normalized.includes(keyword))) {
    return OUT_OF_SCOPE_REPLY;
  }

  const facilities = state.facilities?.length
    ? state.facilities
    : OFFLINE_FACILITIES;
  const mentionedFacility = facilities.find((facility) => {
    const name = facility.name.toLowerCase();
    return (
      normalized.includes(name) ||
      (facility.id === "gym" && normalized.includes("gymnasium")) ||
      (facility.id === "avr" && normalized.includes("audio-visual"))
    );
  });
  const asksPrice = /price|pricing|cost|rate|how much/.test(normalized);
  const asksCapacity = /capacit|how many|people|pax|attendee/.test(normalized);

  if (/cancel|cancellation|refund/.test(normalized)) {
    return "To cancel, select your reservation in the Daily Schedule and follow the email verification steps. Cancellations are not accepted within 2 weeks of the event, and the required down payment is non-refundable. Contact the Administration Office for help.";
  }

  if (/payment|pay|down payment|deposit|balance/.test(normalized)) {
    return "A down payment is required for non-staff reservations. The amount depends on the reservation total and is confirmed after approval. It is non-refundable and due at the Admin Office within 3 working days of approval. The remaining balance is due at least 3 working days before the event. Payments are made in person.";
  }

  if (
    /availability|available|free slot|open date|check.*date/.test(normalized)
  ) {
    return "I can’t confirm live availability while offline. When your connection returns, select a facility and check its calendar for the date and time you want.";
  }

  if (/reserve|reservation|booking|book/.test(normalized)) {
    return "To reserve: select a facility, double-click an available calendar date, complete the form and time slots, accept the facility usage policy, then follow the payment instructions after approval. A down payment is required for non-staff reservations; the amount is confirmed after approval and is due within 3 working days.";
  }

  if (asksPrice || asksCapacity || mentionedFacility) {
    const relevantFacilities = mentionedFacility ? [mentionedFacility] : facilities;
    const details = relevantFacilities.map((facility) => {
      const facts = [];
      if (asksCapacity || mentionedFacility)
        facts.push(`capacity: ${facility.capacity} people`);
      if (asksPrice || mentionedFacility)
        facts.push(
          `₱${Number(facility.pricePerHour).toLocaleString("en-PH")}/hour`,
        );
      return `${facility.name}: ${facts.join(", ")}`;
    });

    if (details.length) {
      const feeNote = asksPrice
        ? "\nAn ₱800 utility fee applies to reservations of 8 hours or more."
        : "";
      return `Saved facility information:\n${details.join("\n")}${feeNote}`;
    }
  }

  return "I can help with saved facility prices and capacities, reservation steps, payments, and cancellation rules. I can’t verify live availability while offline. For details not covered here, contact the Administration Office (Monday-Friday, 8:00 AM-5:00 PM).";
};

export class Chat {
  constructor() {
    this.container = document.getElementById("chat-messages");
    this.input = document.getElementById("chat-input");
    this.sendBtn = document.getElementById("chat-send");
    this.listenersAttached = false;
  }

  init() {
    if (state.chatMessages.length === 0) {
      addChatMessage({
        sender: "assistant",
        text: "Hello! I'm your <strong>BCHS Reservation Assistant</strong>.<br><br>I can help you with:<br>• Pricing &amp; payment information<br>• Facility capacity and recommendations<br>• Checking availability<br>• Reservation procedures<br>• Cancellation &amp; refund policies<br>• Facility details and features<br><br>What would you like to know?",
        chips: DEFAULT_CHIPS,
      });
    }

    if (!this.listenersAttached) {
      this.attachEventListeners();
    }

    this.render();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = state.chatMessages
      .map(
        (msg) => `
            <div class="message ${msg.sender}">
                <div class="message-bubble">${escapeHtml(stripHtmlTags(msg.text)).replace(/\n/g, "<br>")}</div>
            </div>
        `,
      )
      .join("");

    if (this.sendBtn) {
      this.sendBtn.disabled = state.isChatLoading;
    }

    if (this.input) {
      this.input.disabled = state.isChatLoading;
    }

    // Typing indicator
    if (state.isChatLoading) {
      const typing = document.createElement("div");
      typing.className = "message assistant";
      typing.innerHTML = `<div class="message-bubble" style="display:flex;align-items:center;gap:8px;"><div class="spinner-small"></div>Assistant is thinking...</div>`;
      this.container.appendChild(typing);
    }

    // Suggestion chips after the last assistant message
    const lastMsg = state.chatMessages[state.chatMessages.length - 1];
    if (lastMsg && lastMsg.sender === "assistant" && lastMsg.chips) {
      const chipRow = document.createElement("div");
      chipRow.className = "chat-chips";
      lastMsg.chips.forEach((label) => {
        const btn = document.createElement("button");
        btn.className = "chat-chip";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          if (state.isChatLoading) return;
          this.input.value = label;
          this.sendMessage();
        });
        chipRow.appendChild(btn);
      });
      this.container.appendChild(chipRow);
    }

    this.container.scrollTop = this.container.scrollHeight;
  }

  addMessage(sender, text, chips = null) {
    addChatMessage({ sender, text, chips });
    this.render();
  }

  async sendMessage() {
    if (state.isChatLoading) return;

    const text = this.input?.value.trim() ?? "";
    if (!text) return;

    this.addMessage("user", text);
    if (this.input) {
      this.input.value = "";
    }
    setChatLoading(true);
    this.render();

    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        this.addMessage(
          "assistant",
          `I’m using saved guidance because your connection is offline.\n\n${getOfflineReply(text)}`,
          DEFAULT_CHIPS,
        );
        return;
      }

      // Send the full conversation history so Gemini has context for multi-turn replies.
      // Filter out the welcome message's static intro to keep history clean —
      // only include real back-and-forth messages (skip the very first assistant greeting).
      const history = state.chatMessages.slice(1).map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CHAT_REQUEST_TIMEOUT_MS,
      );
      let response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await response.json().catch(() => ({}));

      if (response.ok && (data.success || typeof data.reply === "string")) {
        this.addMessage(
          "assistant",
          data.reply ||
            "I can help with BCHS reservation questions about facility availability, pricing, booking steps, and cancellation policies.",
          DEFAULT_CHIPS,
        );
      } else if (
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429
      ) {
        const reason =
          response.status === 503
            ? "The AI assistant is not configured. Showing saved guidance:"
            : "The assistant is temporarily unavailable, so here’s saved guidance:";
        this.addMessage(
          "assistant",
          `${reason}\n\n${getOfflineReply(text)}`,
          DEFAULT_CHIPS,
        );
      } else {
        const errText =
          data.message || "Something went wrong. Please try again.";
        this.addMessage("assistant", errText, DEFAULT_CHIPS);
      }
    } catch (err) {
      console.error("Chat fetch error:", err);
      this.addMessage(
        "assistant",
        `The assistant couldn’t be reached${err?.name === "AbortError" ? " in time" : ""}, so here’s saved guidance:\n\n${getOfflineReply(text)}`,
        DEFAULT_CHIPS,
      );
    } finally {
      setChatLoading(false);
      this.render();
      this.input?.focus();
    }
  }

  attachEventListeners() {
    if (this.listenersAttached) return;

    this.sendBtn?.addEventListener("click", () => this.sendMessage());
    this.input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const fab = document.getElementById("chat-fab");
    const popup = document.getElementById("chat-popup");
    const closeBtn = document.getElementById("chat-close-btn");

    fab?.addEventListener("click", () => popup?.classList.toggle("open"));

    // Jump animation after 3 seconds to draw attention
    if (fab) {
      setTimeout(() => {
        fab.classList.add("jumping");
        fab.addEventListener(
          "animationend",
          () => fab.classList.remove("jumping"),
          { once: true },
        );
      }, 3000);
    }

    // Nudge bubble after 2 minutes of no interaction
    if (fab) {
      let nudgeTimer;
      const nudge = document.createElement("div");
      nudge.id = "chat-nudge";
      nudge.textContent = "Do you have questions?";
      document.body.appendChild(nudge);

      const showNudge = () => {
        nudge.classList.add("visible");
        setTimeout(() => nudge.classList.remove("visible"), 2000);
      };

      const resetNudge = () => {
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(showNudge, 2 * 60 * 1000);
      };

      ["click", "mousemove", "keydown", "scroll", "touchstart"].forEach((evt) =>
        document.addEventListener(evt, resetNudge, { passive: true }),
      );

      resetNudge();
    }

    closeBtn?.addEventListener("click", () => popup?.classList.remove("open"));
    this.listenersAttached = true;
  }
}
