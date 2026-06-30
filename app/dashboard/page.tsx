import { createServerSupabase } from "@/lib/supabase-server";

export default async function DashboardOverviewPage() {
  const supabase = await createServerSupabase();

  const { data: missedCalls } = await supabase.from("missed_calls").select("id");
  const { data: sessions } = await supabase.from("whatsapp_sessions").select("id");
  const { data: repliedMessages } = await supabase
    .from("messages")
    .select("session_id")
    .eq("role", "user");
  const { count: pendingAppointments } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const missedCount = missedCalls?.length ?? 0;
  const sessionCount = sessions?.length ?? 0;
  const repliedSessionIds = new Set((repliedMessages ?? []).map((m) => m.session_id));
  const recoveryRate = missedCount > 0 ? Math.round((repliedSessionIds.size / missedCount) * 100) : 0;

  const stats = [
    { label: "Missed calls", value: missedCount },
    { label: "WhatsApp sessions started", value: sessionCount },
    { label: "Recovery rate", value: `${recoveryRate}%` },
    { label: "Pending appointment requests", value: pendingAppointments ?? 0 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
