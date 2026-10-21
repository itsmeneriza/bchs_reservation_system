export async function loginUser({ isStaff, staffId, phone }) {

    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify( isStaff ? { isStaff, staffId } : { isStaff, phone })
    });

    const result = await response.json();
    
    if (!response.ok || !result.success || !result.data) {
        throw new Error(result.message || 'Login failed. Please try again.');
    }

    const profile = result.user;
    const guestPhone = profile.mobile_number || profile.phone_number;

    return {
        ...profile,
        isStaff: result.isStaff,
        name: result.isStaff ? profile.full_name : guestPhone,
        phone: result.isStaff
            ? profile.phone_number || profile.staff_id
            : guestPhone,
        loginTime: new Date().toISOString(),
    };
    
}