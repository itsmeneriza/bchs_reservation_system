import express from "express";
import { createSupabaseClient } from "../services/supabaseClient.js";

export function createFacilitiesRouter() {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const { data, error } = await createSupabaseClient()
        .from("facilities")
        .select("id,name,capacity,price_per_hour,min_pax")
        .order("name", { ascending: true });

      if (error) throw error;

      const facilities = data.map((facility) => ({
        id: facility.id,
        name: facility.name,
        capacity: facility.capacity,
        pricePerHour: Number(facility.price_per_hour),
        minPax: facility.min_pax,
      }));
      return res.json({ facilities });
    } catch (error) {
      console.error("Could not load facilities from Supabase:", error);
      return res.status(error.status || 500).json({
        message: "Could not load facilities from Supabase.",
      });
    }
  });

  return router;
}
