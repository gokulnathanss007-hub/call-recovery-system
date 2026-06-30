import { createServerSupabase } from "@/lib/supabase-server";
import { updateAppointmentStatus } from "./actions";

export default async function AppointmentsPage() {
  const supabase = await createServerSupabase();
  const { data: appointments } = await supabase
    .from("appointments")
    .select("id, requested_date, requested_time, notes, status, created_at, patients(phone, name)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Appointment Requests</h1>
      <div className="mt-6 space-y-3">
        {(appointments ?? []).map((appt) => (
          <div key={appt.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{appt.patients?.[0]?.phone ?? "Unknown patient"}</p>
                <p className="text-sm text-slate-500">
                  {appt.requested_date}
                  {appt.requested_time ? ` · ${appt.requested_time}` : ""}
                </p>
                {appt.notes && <p className="mt-1 text-sm text-slate-600">{appt.notes}</p>}
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize">
                {appt.status}
              </span>
            </div>
            {appt.status === "pending" && (
              <div className="mt-3 flex gap-2">
                <form action={updateAppointmentStatus.bind(null, appt.id, "confirmed")}>
                  <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
                    Confirm
                  </button>
                </form>
                <form action={updateAppointmentStatus.bind(null, appt.id, "cancelled")}>
                  <button className="rounded border border-slate-300 px-3 py-1 text-sm">
                    Cancel
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
        {(appointments?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">No appointment requests yet.</p>
        )}
      </div>
    </div>
  );
}
