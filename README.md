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

## Server Structure

`server.js` configures Express, serves the static frontends, mounts the API routers, starts scheduled jobs, and listens for requests. API handlers are grouped by feature in `routes/`:

- `requests.js` handles reservations, facilitys, events, and accepted reservations.
- `history.js` handles archived reservations and periodic archiving.
- `forecast.js` handles forecast calculation, caching, and refresh.
- `notifications.js` handles email notifications, reminders, and cancellation OTPs.
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

All data is stored as JSON files in the `data/` folder:

| File             | Description                             |
| ---------------- | --------------------------------------- |
| `requests.json`  | Pending and active reservation requests |
| `accepted.json`  | Approved reservations                   |
| `history.json`   | Archived past reservations              |
| `events.json`    | Scheduled events                        |
| `facilitys.json` | Facility/facility definitions           |
| `staff.json`     | Staff accounts                          |
| `forecast.json`  | Cached usage forecast                   |

> When hosting on platforms like Railway or Render, note that the file system is **ephemeral** - data resets on redeploy. For persistent storage, consider migrating to a database like MongoDB Atlas or PostgreSQL.
