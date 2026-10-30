const otpStore = new Map();
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export function clearCancellationOtp(requestId) {
  otpStore.delete(requestId);
}

export function storeCancellationOtp(requestId, code, email) {
  otpStore.set(requestId, {
    code,
    email,
    expiresAt: Date.now() + OTP_LIFETIME_MS,
    attempts: 0,
    verified: false,
  });
}

export function verifyCancellationOtp(requestId, code, email) {
  const stored = otpStore.get(requestId);
  if (!stored) return false;

  if (Date.now() > stored.expiresAt || stored.email !== email) {
    otpStore.delete(requestId);
    return false;
  }

  if (stored.verified) return false;
  if (stored.code !== code) {
    stored.attempts += 1;
    if (stored.attempts >= MAX_OTP_ATTEMPTS) otpStore.delete(requestId);
    return false;
  }

  stored.verified = true;
  stored.code = null;
  return true;
}

export function consumeCancellationOtp(requestId, email) {
  const stored = otpStore.get(requestId);
  if (!stored) return false;

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(requestId);
    return false;
  }

  if (!stored.verified || stored.email !== email) return false;
  otpStore.delete(requestId);
  return true;
}
