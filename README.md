# Facility Reservation System

A web-based facility reservation system built with Node.js and Express. Includes a user-facing booking interface and an admin panel for managing requests.

---

## Hardware Requirements Installation

Minimum specs to run this system on a dedicated machine (e.g. a school server or office PC):

| Component | Minimum                               | Recommended                    |
| --------- | ------------------------------------- | ------------------------------ |
| CPU       | Dual-core 1.6 GHz                     | Quad-core 2.0 GHz or better    |
| RAM       | 2 GB                                  | 4 GB or more                   |
| Storage   | 10 GB free space                      | 20 GB+ (for data growth)       |
| Network   | Wired or Wi-Fi connection             | Wired LAN (more stable)        |
| OS        | Windows 10, Ubuntu 20.04, or macOS 11 | Ubuntu 22.04 LTS (for servers) |

> The system is lightweight - it runs entirely on Node.js with no database engine required. Even older office computers can handle it.

### Setting Up on a Local School/Office Computer

If you want the system accessible to everyone on the same Wi-Fi or LAN network (without internet hosting):

1. Install the system on one dedicated computer (the "server machine")
2. Find that machine's local IP address:
   - Windows: open Command Prompt -> type `ipconfig` -> look for **IPv4 Address** (e.g. `192.168.1.10`)
   - Linux/macOS: open Terminal -> type `ip a` or `ifconfig`
3. Start the server normally with `npm start`
4. Other devices on the same network can access it at:
   ```
   http://192.168.1.10:3000
   ```
   Replace `192.168.1.10` with the actual IP of the server machine.

> For this to work reliably, give the server machine a **static (fixed) local IP** through your router settings so the address never changes.

---

## Software Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Gmail account (for email notifications)

---

## Installation

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd <repo-folder>
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create or edit `.env.local` in the repository root and add your private environment values (do NOT commit `.env.local`).
   ```
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASS=your_app_password
   EMAIL_FROM=BCHS Reservations <your_email@gmail.com>
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```
   > For `EMAIL_PASS`, use a Gmail **App Password**, not your regular password.
   > Generate one at: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   > Get a Gemini API key from Google AI Studio (or your Google Cloud project). The chatbot reads `GEMINI_API_KEY` from `.env.local`; keep this key private and do not commit it. The repository's `.gitignore` already excludes `.env*.local`.
   > If Gemini is not configured or temporarily unavailable, the chatbot will show saved reservation guidance instead.

---

## Running Locally

```bash
npm start
```

Then open in your browser:

- User app: [http://localhost:3000](http://localhost:3000)
- Admin panel: [http://localhost:3000/admin/admin.html](http://localhost:3000/admin/admin.html)

The server also prints these URLs in the terminal when it starts.

## Server Structure

`server.js` configures Express, serves the static frontends, mounts API routers, and listens for requests. API handlers are grouped by feature in `routes/`:

- `events.js` reads events from Supabase and protects event create, update, and delete operations with administrator authentication and RLS.
- `requests.js` reads and writes facility-user reservations in Supabase.
- `facilities.js` reads facility definitions from Supabase.
- `forecast.js` calculates forecasts from approved Supabase reservations.
- `notifications.js` sends email notifications and reads/writes reminder state in Supabase.
- `chat.js` handles the reservation assistant endpoint.

The shared email transport is configured in `services/mailer.js`; existing date, email-template, and forecast helpers remain in `scripts/`.

---

## Hosting on the Internet

### Option 1 - Railway (Recommended, free tier available)

1. Create a free account at [https://railway.app](https://railway.app)
2. Click **New Project -> Deploy from GitHub repo**
3. Select your repository
4. Go to your project's **Variables** tab and add:
   ```
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASS=your_app_password
   EMAIL_FROM=BCHS Reservations <your_email@gmail.com>
   ```
5. Railway will auto-detect the `npm start` script and deploy.
6. Once deployed, Railway gives you a public URL like `https://your-app.up.railway.app`

---

### Option 2 - Render (Free tier available)

1. Create an account at [https://render.com](https://render.com)
2. Click **New -> Web Service**
3. Connect your GitHub repository
4. Set the following:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment**, add your `EMAIL_USER`, `EMAIL_PASS`, and `EMAIL_FROM` variables
6. Click **Create Web Service** - Render will build and deploy automatically

---

### Option 3 - VPS / Cloud Server (e.g. AWS EC2, DigitalOcean)

1. SSH into your server
2. Install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Clone the repo and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd <repo-folder>
   npm install
   ```
4. Create your `.env.local` file with the required email credentials
5. Install PM2 to keep the server running:
   ```bash
   npm install -g pm2
   pm2 start server.js --name reservation-system
   pm2 save
   pm2 startup
   ```
6. (Optional) Point a domain to your server's IP and use Nginx as a reverse proxy on port 80/443

---

## Data Storage

Facility definitions, events, and current facility-user reservation requests
are stored in Supabase. Follow [REQUESTS_SUPABASE_STEPS.txt](./REQUESTS_SUPABASE_STEPS.txt)
to create the reservations table and configure the server. Events use
[EVENTS_SUPABASE_STEPS.txt](./EVENTS_SUPABASE_STEPS.txt).

The reservation JSON files are migration backups only; the running application
does not read or write them. Run `npm run migrate:reservations` once to import
legacy requests, approved reservations, and history into Supabase. The migration
skips reservation codes already present in Supabase. Keep the JSON files as
backups until the import has been verified.

| File              | Description                             |
| ----------------- | --------------------------------------- |
| `requests.json`   | One-time reservation migration source / backup |
| `accepted.json`   | One-time approved-reservation migration source / backup |
| `history.json`    | One-time history migration source / backup |
| `events.json`     | Source records for the one-time events import |
| `facilities.json` | Legacy facility definitions                   |
| `staff.json`      | Legacy staff records                          |
| `forecast.json`   | Legacy forecast cache; not used by the app    |
