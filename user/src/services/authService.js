export async function loginUser({ isStaff, staffId, phone }) {
  let response;
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isStaff ? { isStaff, staffId } : { isStaff, phone })
    });
  } catch {
    throw new Error('Unable to connect to the login service. Please try again.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The login service returned an unexpected response.');
  }

  if (!result || typeof result !== 'object') {
    throw new Error('The login service returned an unexpected response.');
  }
  if (!response.ok || !result.success || !result.user ||
      typeof result.user !== 'object' || typeof result.isStaff !== 'boolean') {
    throw new Error(result.message || 'Login failed. Please try again.');
  }

  const profile = result.user;
  const guestPhone = profile.mobile_number || profile.phone_number;
  return {
    ...profile,
    isStaff: result.isStaff,
    name: result.isStaff ? profile.full_name : guestPhone,
    phone: result.isStaff ? profile.phone_number || profile.staff_id : guestPhone,
    loginTime: new Date().toISOString()
  };
}
