import { supabase } from '../user/src/services/supabaseClient.js'; 
import { createServiceRoleSupabaseClient } from '../services/supabaseClient.js';

export class AuthService {
    //staff login via staff_id
    static async staffLogin(staffId) {
        const { data: staff, error } = await supabase
            .from('staffs')
            .select('id, full_name, staff_id, email')
            .eq('staff_id', staffId)
            .single();

        if (error || !staff) {
            throw new Error('Staff ID not found or invalid.');
        }

        return { user: staff, isStaff: true };
    }

    // Guest login is limited to accounts that have already been registered.
    static async loginGuest(phoneNumber) {
        const client = createServiceRoleSupabaseClient();
        const { data: guest, error } = await client
            .from('guests')
            .select('id, mobile_number')
            .eq('mobile_number', phoneNumber)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (guest) return { user: guest, isStaff: false };

        const notFoundError = new Error('No account found for this phone number. Please sign up first.');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }

    static async signupGuest(fullName, phoneNumber) {
        const client = createServiceRoleSupabaseClient();
        const { data: guest, error } = await client
            .from('guests')
            .insert([{ full_name: fullName, mobile_number: phoneNumber }])
            .select('id, full_name, email, mobile_number')
            .single();

        if (error?.code === '23505') {
            const duplicateError = new Error('An account with this phone number already exists. Please log in.');
            duplicateError.statusCode = 409;
            throw duplicateError;
        }

        if (error) throw new Error(error.message);
        return { user: guest, isStaff: false };
    }

    static async updateGuestProfile(guestId, profile) {
        const client = createServiceRoleSupabaseClient();
        const { data: guest, error } = await client
            .from('guests')
            .update({
                full_name: profile.fullName,
                email: profile.email,
                mobile_number: profile.phone,
            })
            .eq('id', guestId)
            .select('id, full_name, email, mobile_number')
            .maybeSingle();

        if (error?.code === '23505') {
            const duplicateError = new Error('An account with this phone number already exists.');
            duplicateError.statusCode = 409;
            throw duplicateError;
        }

        if (error) throw new Error(error.message);
        if (!guest) {
            const notFoundError = new Error('User profile was not found.');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }

        return guest;
    }
}