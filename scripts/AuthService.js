import { supabase } from '../user/src/services/supabaseClient.js'; 

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

    //guest login via mobile phone_number
    static async loginGuest(phoneNumber) {
        let { data: guest, error } = await supabase
        .from('guests')
        .select('id, phone_number')
        .eq('phone_number', phoneNumber)
        .maybeSingle();

        if (error) throw new Error(error.message);

        if (!guest) {
        const { data: newGuest, error: createError } = await supabase
            .from('guests')
            .insert([{ phone_number: phoneNumber }])
            .select('id, phone_number')
            .single();

        if (createError) throw new Error(createError.message);
        guest = newGuest;
        }

        return { user: guest, isStaff: false };
    }
    }