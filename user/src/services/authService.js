export function getSessionToken() {
    return localStorage.getItem('bchs_user_session') || '';
}

export function attachUserSessionToFetch() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const headers = new Headers(init.headers || {});
        const token = getSessionToken();
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return originalFetch(input, { ...init, headers });
    };
}

export async function loginUser({ isStaff, staffId, phone }) {

    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify( isStaff ? { isStaff, staffId } : { isStaff, phone })
    });

    const result = await response.json();
    
    if (!response.ok || !result.success || !result.user) {
        throw new Error(result.message || 'Login failed. Please try again.');
    }

    const profile = result.user;
    const guestPhone = profile.phone_number || profile.mobile_number;
    const sessionToken = result.sessionToken || '';

    return {
        ...profile,
        isStaff: result.isStaff,
        name: result.isStaff ? profile.full_name : (profile.full_name || guestPhone),
        phone: result.isStaff
            ? profile.phone_number || profile.staff_id
            : guestPhone,
        loginTime: new Date().toISOString(),
        sessionToken,
    };
    
}

export async function signupGuest({ fullName, phone }) {
    const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName, phone }),
    });

    const result = await response.json();

    if (!response.ok || !result.success || !result.user) {
        throw new Error(result.message || 'Unable to create your account. Please try again.');
    }

    const profile = result.user;
    return {
        ...profile,
        isStaff: false,
        name: profile.full_name || profile.mobile_number,
        phone: profile.mobile_number,
        email: profile.email || '',
        loginTime: new Date().toISOString(),
        sessionToken: result.sessionToken || '',
    };
}

export async function updateGuestProfile({ fullName, email, phone }) {
    const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName, email, phone }),
    });

    const result = await response.json();

    if (!response.ok || !result.success || !result.user) {
        throw new Error(result.message || 'Unable to update your profile. Please try again.');
    }

    const profile = result.user;
    return {
        ...profile,
        isStaff: false,
        name: profile.full_name,
        phone: profile.mobile_number,
        email: profile.email || '',
        loginTime: new Date().toISOString(),
    };
}