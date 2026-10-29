import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const userId = '45515bc7-a424-4ff6-8576-f9abfbef0874';
const { data, error } = await supabase.auth.admin.updateUserById(userId, {
  app_metadata: { role: 'admin' }
});

if (error) throw error;
console.log(`Administrator role assigned to ${data.user.email}`);
