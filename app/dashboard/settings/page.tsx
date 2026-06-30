import { createServerSupabase } from "@/lib/supabase-server";
import { updateClinicSettings } from "./actions";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: clinic } = await supabase
    .from("clinics")
    .select("name, did, whatsapp_phone_number_id")
    .eq("owner_user_id", user?.id ?? "")
    .maybeSingle();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form action={updateClinicSettings} className="mt-6 max-w-md space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Clinic name</label>
          <input
            name="name"
            defaultValue={clinic?.name ?? ""}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Exotel DID</label>
          <input
            name="did"
            defaultValue={clinic?.did ?? ""}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            WhatsApp phone_number_id
          </label>
          <input
            name="whatsappPhoneNumberId"
            defaultValue={clinic?.whatsapp_phone_number_id ?? ""}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
      </form>
    </div>
  );
}
