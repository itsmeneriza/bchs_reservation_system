/**
 * Application State Management
 */

export const state = {
  facilitys: [],
  selectedRoom: null,
  selectedDate: new Date(),
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  reservations: [],
  chatMessages: [],
  isChatLoading: false,
  // Auth state
  isLoggedIn: localStorage.getItem("bchs_user_logged_in") === "true",
  user: JSON.parse(localStorage.getItem("bchs_user_data") || "null"),
};

export function setSelectedRoom(facility) {
  state.selectedRoom = facility;
}

export function setSelectedDate(date) {
  state.selectedDate = date;
}

export function setMonth(month, year) {
  state.currentMonth = month;
  state.currentYear = year;
}

export function addReservation(reservation) {
  state.reservations.push(reservation);
}

export function addChatMessage(message) {
  state.chatMessages.push(message);
}

export function setChatLoading(isLoading) {
  state.isChatLoading = isLoading;
}

export function setLoginState(isLoggedIn, userData = null) {
  state.isLoggedIn = isLoggedIn;
  state.user = userData;
  if (isLoggedIn) {
    localStorage.setItem("bchs_user_logged_in", "true");
    localStorage.setItem("bchs_user_data", JSON.stringify(userData));
  } else {
    localStorage.removeItem("bchs_user_logged_in");
    localStorage.removeItem("bchs_user_data");
  }
}
