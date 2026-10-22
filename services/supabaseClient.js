import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient(accessToken) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
        const error = new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured.');
        error.status = 503;
        throw error;
    }

    return createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(accessToken
            ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
            : {}),
    });
}