// Run once to seed MongoDB with existing JSON data:
// node scripts/seed.js

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../data");

const client = new MongoClient(process.env.MONGODB_URI);

async function seed() {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "bchs");

  // Requests
  const { requests } = JSON.parse(
    readFileSync(join(dataDir, "requests.json"), "utf8"),
  );
  if (requests.length) {
    await db.collection("requests").deleteMany({});
    await db.collection("requests").insertMany(requests);
    console.log(`Seeded ${requests.length} requests`);
  }

  // Events
  const { events } = JSON.parse(
    readFileSync(join(dataDir, "events.json"), "utf8"),
  );
  if (events.length) {
    await db.collection("events").deleteMany({});
    await db.collection("events").insertMany(events);
    console.log(`Seeded ${events.length} events`);
  }

  // Rooms (static reference data)
  const { facilitys } = JSON.parse(
    readFileSync(join(dataDir, "facilitys.json"), "utf8"),
  );
  if (facilitys.length) {
    await db.collection("facilitys").deleteMany({});
    await db.collection("facilitys").insertMany(facilitys);
    console.log(`Seeded ${facilitys.length} facilitys`);
  }

  // Staff
  try {
    const { staff } = JSON.parse(
      readFileSync(join(dataDir, "staff.json"), "utf8"),
    );
    if (staff.length) {
      await db.collection("staff").deleteMany({});
      await db.collection("staff").insertMany(staff);
      console.log(`Seeded ${staff.length} staff`);
    }
  } catch {
    console.log("No staff.json found, skipping");
  }

  // Accepted
  try {
    const { accepted } = JSON.parse(
      readFileSync(join(dataDir, "accepted.json"), "utf8"),
    );
    if (accepted.length) {
      await db.collection("accepted").deleteMany({});
      await db.collection("accepted").insertMany(accepted);
      console.log(`Seeded ${accepted.length} accepted`);
    }
  } catch {
    console.log("No accepted.json found, skipping");
  }

  await client.close();
  console.log("Seed complete");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
