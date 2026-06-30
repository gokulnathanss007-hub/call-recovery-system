"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase-server";

export async function updateAppointmentStatus(
  appointmentId: string,
  status: "confirmed" | "cancelled"
) {
  const supabase = await createServerSupabase();
  await supabase.from("appointments").update({ status }).eq("id", appointmentId);
  revalidatePath("/dashboard/appointments");
}
