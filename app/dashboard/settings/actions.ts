"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase-server";

export async function updateClinicSettings(formData: FormData) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const name = formData.get("name") as string;
  const did = (formData.get("did") as string) || null;
  const whatsappPhoneNumberId = (formData.get("whatsappPhoneNumberId") as string) || null;

  await supabase
    .from("clinics")
    .update({ name, did, whatsapp_phone_number_id: whatsappPhoneNumberId })
    .eq("owner_user_id", user.id);

  revalidatePath("/dashboard/settings");
}
