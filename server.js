require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const createRequestsRouter = require('./routes/requests');
const createHistoryRouter = require('./routes/history');
const createForecastRouter = require('./routes/forecast');
const createNotificationRouter = require('./routes/notifications');
const createChatRouter = require('./routes/chat');

const app = express();
const configuredPort = process.env.PORT;
const PORT = configuredPort === undefined || configuredPort === '' ? 3000 : Number(configuredPort);
const dataDir = path.join(__dirname, 'data');

app.use(express.json());
app.use(cors());

if (fs.existsSync(dataDir)) app.use('/data', express.static(dataDir));

const srcPath = path.join(__dirname, 'user', 'src');
if (fs.existsSync(srcPath)) app.use('/src', express.static(srcPath));

const adminPath = path.join(__dirname, 'admin');
if (fs.existsSync(adminPath)) app.use('/admin', express.static(adminPath));

const scriptsPath = path.join(__dirname, 'scripts');
if (fs.existsSync(scriptsPath)) app.use('/scripts', express.static(scriptsPath));

app.use(express.static(path.join(__dirname, 'user', 'public')));

const history = createHistoryRouter({ dataDir });
const forecast = createForecastRouter({ dataDir, readHistory: history.readHistory });
const notifications = createNotificationRouter({ dataDir });

app.use(createRequestsRouter({
  dataDir,
  generateForecastFromData: forecast.generateForecastFromData,
  transporter: notifications.transporter
}));
app.use(history.router);
app.use(forecast.router);
app.use(notifications.router);
app.use(createChatRouter());

history.archivePastReservations();
setInterval(history.archivePastReservations, 60 * 60 * 1000);

function startServer(port = PORT, maxAttempts = 20) {
  const server = app.listen(port, () => {
    const activePort = server.address().port;

    notifications.checkAndSendReminders();
    setInterval(notifications.checkAndSendReminders, 24 * 60 * 60 * 1000);
    forecast.generateForecastFromData();
    setInterval(forecast.generateForecastFromData, 6 * 60 * 60 * 1000);
    const userUrl = `http://localhost:${activePort}/`;
    const adminUrl = `http://localhost:${activePort}/admin/admin.html`;
    console.log('\nBCHS Reservation Server Running!\n');
    console.log(`User booking page:\n${userUrl}\n`);
    console.log(`Admin panel:\n${adminUrl}\n`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      if (maxAttempts > 0) {
        console.warn('Port ' + port + ' is busy. Retrying on ' + nextPort + '...');
        startServer(nextPort, maxAttempts - 1);
        return;
      }
      console.error('No available port found starting from ' + PORT + '.');
    }
    throw error;
  });
}

startServer(PORT);
