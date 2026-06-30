"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import { supabase as adminSupabase } from "@/lib/supabase";

export async function signup(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const clinicName = formData.get("clinicName") as string;
  const did = (formData.get("did") as string) || null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    redirect(`/signup?error=${encodeURIComponent(error?.message ?? "Signup failed")}`);
  }

  const { error: clinicError } = await adminSupabase.from("clinics").insert({
    name: clinicName,
    did,
    owner_user_id: data.user.id,
  });

  if (clinicError) {
    redirect(`/signup?error=${encodeURIComponent(clinicError.message)}`);
  }

  redirect("/dashboard");
}
