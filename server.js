import 'dotenv/config'; // load variables from hidden .env file
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import { createEventsRouter } from './routes/events.js';
import { createForecastRouter } from './routes/forecast.js';
import { createFacilitiesRouter } from './routes/facilities.js';
import createChatRouter from './routes/chat.js';
import { createNotificationRouter } from './routes/notifications.js';
import { createRequestsRouter } from './routes/requests.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { createServiceRoleSupabaseClient } from './services/supabaseClient.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

app.use('/src', express.static(path.join(projectDir, 'user', 'src')));
app.use('/admin', express.static(path.join(projectDir, 'admin')));
app.use(
  '/data/facility%20pics',
  express.static(path.join(projectDir, 'data', 'facility pics')),
);
app.get('/scripts/DateUtils.js', (_req, res) => {
  res.sendFile(path.join(projectDir, 'scripts', 'DateUtils.js'));
});
app.get('/scripts/FacilityUtils.js', (_req, res) => {
  res.sendFile(path.join(projectDir, 'scripts', 'FacilityUtils.js'));
});
app.get('/scripts/ForecastTab.js', (_req, res) => {
  res.sendFile(path.join(projectDir, 'scripts', 'ForecastTab.js'));
});
app.get('/admin', (_req, res) => {
  res.redirect('/admin/admin.html');
});
app.use(express.static(path.join(projectDir, 'user', 'public')));

app.use('/api/auth', authRouter);
app.use('/api/facilities', createFacilitiesRouter());
app.use('/api/requests', createRequestsRouter());
app.use('/api/forecast', createForecastRouter());
app.use(createChatRouter());
const notifications = createNotificationRouter();
app.use(notifications.router);
notifications.checkAndSendReminders();
setInterval(notifications.checkAndSendReminders, 60 * 60 * 1000);
app.get('/api/admin/config', (_req, res) => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return res.status(503).json({
      message: 'Admin sign-in is not configured on the server.',
    });
  }
  return res.json({ url, anonKey });
});
app.get('/api/admin/session', requireAdmin, (req, res) => {
  return res.json({
    user: {
      id: req.adminUser.id,
      email: req.adminUser.email,
      role: req.adminUser.app_metadata.role,
    },
  });
});
app.get('/api/admin/staff/:staffId', requireAdmin, async (req, res) => {
  const staffId = String(req.params.staffId || '').trim();
  if (!staffId) {
    return res.status(400).json({ message: 'Staff ID is required.' });
  }

  try {
    const client = createServiceRoleSupabaseClient();
    const { data, error } = await client
      .from('staffs')
      .select('id, staff_id, full_name, email')
      .eq('staff_id', staffId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ message: 'No staff record found for that ID.' });
    }
    return res.json({
      staff: {
        id: data.id,
        staffId: String(data.staff_id || ''),
        fullName: data.full_name,
        email: data.email,
      },
    });
  } catch (error) {
    console.error('Could not look up staff for manual reservation:', error);
    return res.status(error.status || 500).json({
      message: 'Could not look up staff details. Please try again.',
    });
  }
});
app.use('/api/events', createEventsRouter());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`User app: http://localhost:${PORT}/`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/admin.html`);
});