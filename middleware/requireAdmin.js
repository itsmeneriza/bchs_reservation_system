import { createClient } from "@supabase/supabase-js";

let authClient;

function getAuthClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be configured.");
  }

  if (!authClient) {
    authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authClient;
}

export async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return res.status(401).json({ message: "Administrator sign-in is required." });
  }

  try {
    const { data, error } = await getAuthClient().auth.getUser(accessToken);
    if (error) {
      if (error.status === 401) {
        return res.status(401).json({ message: "Your sign-in has expired. Please sign in again." });
      }
      console.error("Could not verify the Supabase access token:", error.message);
      return res.status(503).json({ message: "Administrator access could not be verified." });
    }

    if (!data.user || data.user.app_metadata?.role !== "admin") {
      return res.status(403).json({ message: "Administrator access is required." });
    }

    req.adminUser = data.user;
    req.accessToken = accessToken;
    return next();
  } catch (error) {
    console.error("Could not verify administrator access:", error);
    return res.status(503).json({ message: "Administrator access could not be verified." });
  }
}
