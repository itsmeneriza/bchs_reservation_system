const SESSION_KEY = "bchs_admin_auth_session";
const loginForm = document.getElementById("adminLoginForm");
const loginScreen = document.getElementById("adminLoginScreen");
const adminApp = document.getElementById("adminApp");
const errorBox = document.getElementById("adminLoginError");
const submitButton = loginForm.querySelector('button[type="submit"]');

let supabaseConfigPromise;
let currentSession = readStoredSession();
let refreshTimer;

function readStoredSession() {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error("Could not read the saved admin session:", error);
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
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
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  scheduleRefresh();
}

function clearSession() {
  currentSession = null;
  sessionStorage.removeItem(SESSION_KEY);
  window.clearTimeout(refreshTimer);
}

function showLogin(message = "") {
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
  if (!currentSession?.refresh_token) {
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
    });
    return true;
  } catch (error) {
    console.error("Could not refresh the admin session:", error);
    clearSession();
    showLogin("Your sign-in expired. Please sign in again.");
    return false;
  }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  if (!currentSession?.expires_at) return;
  const refreshIn = Math.max(
    1000,
    currentSession.expires_at * 1000 - Date.now() - 60_000,
  );
  refreshTimer = window.setTimeout(refreshSession, refreshIn);
}

async function getValidAccessToken() {
  if (!currentSession?.access_token) {
    throw new Error("Please sign in as an administrator.");
  }
  if (currentSession.expires_at * 1000 - Date.now() < 60_000) {
    if (!(await refreshSession())) {
      throw new Error("Your sign-in expired. Please sign in again.");
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

  const response = await fetch(input, { ...options, headers });
  if (response.status === 401) {
    await signOut({ revoke: false });
    throw new Error("Your sign-in expired. Please sign in again.");
  }
  if (response.status === 403) {
    throw new Error("Your account does not have administrator access.");
  }
  return response;
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

  try {
    if (currentSession.expires_at * 1000 - Date.now() < 60_000) {
      if (!(await refreshSession())) return;
    }
    await verifyAdminSession(currentSession.access_token);
    showAdmin();
  } catch (error) {
    console.error("Could not restore the admin session:", error);
    clearSession();
    showLogin(
      error.status === 503
        ? "Admin sign-in is temporarily unavailable. Check the server configuration."
        : "Please sign in with an administrator account.",
    );
  }
}

void restoreAdminSession();
