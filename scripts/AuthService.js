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

    // Guest login by mobile number; create an account when the number is new.
    static async loginGuest(phoneNumber) {
        const client = createServiceRoleSupabaseClient();
        const { data: guest, error } = await client
            .from('guests')
            .select('id, mobile_number')
            .eq('mobile_number', phoneNumber)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (guest) return { user: guest, isStaff: false };

        const { data: newGuest, error: createError } = await client
            .from('guests')
            .insert([{ mobile_number: phoneNumber }])
            .select('id, mobile_number')
            .single();

        if (!createError) {
            return { user: newGuest, isStaff: false };
        }

        if (createError.code === '23505') {
            const { data: existingGuest, error: lookupError } = await client
                .from('guests')
                .select('id, mobile_number')
                .eq('mobile_number', phoneNumber)
                .maybeSingle();

            if (lookupError) throw new Error(lookupError.message);
            if (existingGuest) return { user: existingGuest, isStaff: false };
        }

        throw new Error(createError.message);
    }
}