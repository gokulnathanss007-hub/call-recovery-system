import { createServerSupabase } from "@/lib/supabase-server";

export default async function CallsPage() {
  const supabase = await createServerSupabase();
  const { data: calls } = await supabase
    .from("missed_calls")
    .select("id, patient_phone, call_status, call_timestamp")
    .order("call_timestamp", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Missed Calls</h1>
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {(calls ?? []).map((call) => (
              <tr key={call.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{call.patient_phone}</td>
                <td className="px-4 py-2 capitalize">{call.call_status}</td>
                <td className="px-4 py-2">{new Date(call.call_timestamp).toLocaleString()}</td>
              </tr>
            ))}
            {(calls?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  No missed calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
