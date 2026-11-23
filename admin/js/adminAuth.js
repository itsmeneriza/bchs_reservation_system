const SESSION_KEY = "bchs_admin_auth_session";
const ADMIN_SESSION_DURATION = 2 * 60 * 60;
const loginForm = document.getElementById("adminLoginForm");
const loginScreen = document.getElementById("adminLoginScreen");
const adminApp = document.getElementById("adminApp");
const errorBox = document.getElementById("adminLoginError");
const submitButton = loginForm.querySelector('button[type="submit"]');
const passwordInput = document.getElementById("adminPassword");
const passwordToggle = document.getElementById("toggleAdminPassword");

let supabaseConfigPromise;
let currentSession = readStoredSession();
let refreshTimer;
let sessionExpiryTimer;

function setPasswordVisibility(showPassword) {
  passwordInput.type = showPassword ? "text" : "password";
  passwordToggle.classList.toggle("is-visible", showPassword);
  passwordToggle.setAttribute("aria-pressed", String(showPassword));
  passwordToggle.setAttribute(
    "aria-label",
    showPassword ? "Hide password" : "Show password",
  );
  passwordToggle.title = showPassword ? "Hide password" : "Show password";
}

passwordToggle.addEventListener("click", () => {
  setPasswordVisibility(passwordInput.type === "password");
});

function readStoredSession() {
  try {
    const value =
      localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!value) return null;

    const session = JSON.parse(value);
    if (!session.admin_session_expires_at) {
      session.admin_session_expires_at =
        Math.floor(Date.now() / 1000) + ADMIN_SESSION_DURATION;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.removeItem(SESSION_KEY);
    return session;
  } catch (error) {
    console.error("Could not read the saved admin session:", error);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function isNetworkError(error) {
  return error instanceof TypeError || navigator.onLine === false;
}

async function getSupabaseConfig() {
  if (!supabaseConfigPromise) {
    supabaseConfigPromise = fetch("/api/admin/config")
      .then(async (response) => {
        const config = await response.json();
        if (!response.ok) {
          throw new Error(config.message || "Admin sign-in is not configured.");
        }
        return config;
      })
      .catch((error) => {
        supabaseConfigPromise = null;
        throw error;
      });
  }
  return supabaseConfigPromise;
}

async function requestSupabaseAuth(path, { accessToken, body } = {}) {
  const config = await getSupabaseConfig();
  const headers = {
    apikey: config.anonKey,
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      result.msg || result.message || result.error_description || "Supabase sign-in failed.",
    );
  }
  return result;
}

async function verifyAdminSession(accessToken) {
  const response = await fetch("/api/admin/session", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || "Could not verify administrator access.");
    error.status = response.status;
    throw error;
  }
  return result.user;
}

function saveSession(session) {
  currentSession = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem(SESSION_KEY);
  window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = window.setTimeout(() => {
    signOut({ revoke: false });
  }, Math.max(1000, session.admin_session_expires_at * 1000 - Date.now()));
  scheduleRefresh();
}

function clearSession() {
  currentSession = null;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  window.clearTimeout(refreshTimer);
  window.clearTimeout(sessionExpiryTimer);
}

function showLogin(message = "") {
  setPasswordVisibility(false);
  loginScreen.style.display = "flex";
  adminApp.style.display = "none";
  errorBox.textContent = message;
  errorBox.style.display = message ? "block" : "none";
  window.dispatchEvent(new CustomEvent("bchs:admin-logged-out"));
}

function showAdmin() {
  loginScreen.style.display = "none";
  adminApp.style.display = "block";
  errorBox.textContent = "";
  errorBox.style.display = "none";
  window.dispatchEvent(new CustomEvent("bchs:admin-authenticated"));
}

async function refreshSession() {
  if (
    !currentSession?.refresh_token ||
    currentSession.admin_session_expires_at * 1000 <= Date.now()
  ) {
    clearSession();
    showLogin("Your sign-in expired. Please sign in again.");
    return false;
  }

  try {
    const refreshed = await requestSupabaseAuth("token?grant_type=refresh_token", {
      body: { refresh_token: currentSession.refresh_token },
    });
    saveSession({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      admin_session_expires_at: currentSession.admin_session_expires_at,
    });
    return true;
  } catch (error) {
    console.error("Could not refresh the admin session:", error);
    if (isNetworkError(error)) {
      window.clearTimeout(refreshTimer);
      const remaining = currentSession.admin_session_expires_at * 1000 - Date.now();
      if (remaining > 0) {
        refreshTimer = window.setTimeout(refreshSession, Math.min(30_000, remaining));
      }
      return false;
    }
    clearSession();
    showLogin("Your sign-in expired. Please sign in again.");
    return false;
  }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  if (!currentSession?.expires_at) return;
  const refreshIn = Math.max(1000, Math.min(
    currentSession.expires_at * 1000 - Date.now() - 60_000,
    currentSession.admin_session_expires_at * 1000 - Date.now(),
  ));
  refreshTimer = window.setTimeout(refreshSession, refreshIn);
}

async function getValidAccessToken() {
  if (!currentSession?.access_token) {
    throw new Error("Please sign in as an administrator.");
  }
  if (currentSession.admin_session_expires_at * 1000 <= Date.now()) {
    clearSession();
    showLogin("Your sign-in expired. Please sign in again.");
    throw new Error("Your sign-in expired. Please sign in again.");
  }
  if (currentSession.expires_at * 1000 - Date.now() < 60_000) {
    if (!(await refreshSession())) {
      throw new Error("Could not refresh your sign-in. Check your connection and try again.");
    }
  }
  return currentSession.access_token;
}

async function signOut({ revoke = true } = {}) {
  const accessToken = currentSession?.access_token;
  clearSession();
  showLogin();

  if (revoke && accessToken) {
    try {
      await requestSupabaseAuth("logout", { accessToken });
    } catch (error) {
      console.error("Supabase could not revoke the admin session:", error);
    }
  }
}

window.adminFetch = async (input, options = {}) => {
  const accessToken = await getValidAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  try {
    let response = await fetch(input, { ...options, headers });

    if (response.status === 401 && currentSession) {
      const refreshed = await refreshSession();
      if (refreshed) {
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set("Authorization", `Bearer ${currentSession.access_token}`);
        response = await fetch(input, { ...options, headers: retryHeaders });
      } else if (!navigator.onLine) {
        throw new Error("Connection unavailable. Your sign-in is still active.");
      }
    }

    if (response.status === 401) {
      await signOut({ revoke: false });
      throw new Error("Your sign-in expired. Please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("Your account does not have administrator access.");
    }
    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      throw new Error("Connection unavailable. Your sign-in is still active.");
    }
    throw error;
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  errorBox.style.display = "none";
  submitButton.disabled = true;
  submitButton.textContent = "Signing in...";

  try {
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value;
    const signedIn = await requestSupabaseAuth("token?grant_type=password", {
      body: { email, password },
    });

    saveSession({
      access_token: signedIn.access_token,
      refresh_token: signedIn.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + signedIn.expires_in,
      admin_session_expires_at:
        Math.floor(Date.now() / 1000) + ADMIN_SESSION_DURATION,
    });

    await verifyAdminSession(signedIn.access_token);
    loginForm.reset();
    showAdmin();
  } catch (error) {
    clearSession();
    console.error("Admin sign-in failed:", error);
    errorBox.textContent =
      error.status === 403
        ? "This account is not an administrator. Contact the system owner."
        : error.status === 503
          ? "Admin sign-in is not configured on the server yet."
          : "Could not sign in. Check your email and password, then try again.";
    errorBox.style.display = "block";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Login";
  }
});

document.getElementById("logoutAdminBtn").addEventListener("click", () => {
  void signOut();
});

window.addEventListener("bchs:admin-logged-out", () => {
  adminApp.style.display = "none";
});

async function restoreAdminSession() {
  if (!currentSession?.access_token) {
    showLogin();
    return;
  }

  if (currentSession.admin_session_expires_at * 1000 <= Date.now()) {
    clearSession();
    showLogin("Your sign-in expired. Please sign in again.");
    return;
  }

  try {
    if (currentSession.expires_at * 1000 - Date.now() < 60_000) {
      if (!(await refreshSession())) {
        if (currentSession) showAdmin();
        return;
      }
    }
    await verifyAdminSession(currentSession.access_token);
    showAdmin();
  } catch (error) {
    console.error("Could not restore the admin session:", error);
    if (isNetworkError(error) && currentSession) {
      showAdmin();
      return;
    }
    if (error.status === 401 && currentSession) {
      if (await refreshSession()) {
        try {
          await verifyAdminSession(currentSession.access_token);
          showAdmin();
          return;
        } catch (retryError) {
          if (isNetworkError(retryError) || retryError.status === 503) {
            showAdmin();
            return;
          }
        }
      } else if (currentSession) {
        showAdmin();
        return;
      }
    }
    clearSession();
    showLogin(
      error.status === 503
        ? "Admin sign-in is temporarily unavailable. Check the server configuration."
        : "Please sign in with an administrator account.",
    );
  }
}

window.addEventListener("online", () => {
  if (currentSession) void restoreAdminSession();
});

void restoreAdminSession();
