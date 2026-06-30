import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";

export default async function ConversationsPage() {
  const supabase = await createServerSupabase();
  const { data: sessions } = await supabase
    .from("whatsapp_sessions")
    .select("id, patient_phone, status, last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Conversations</h1>
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last message</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(sessions ?? []).map((session) => (
              <tr key={session.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{session.patient_phone}</td>
                <td className="px-4 py-2 capitalize">{session.status}</td>
                <td className="px-4 py-2">
                  {session.last_message_at
                    ? new Date(session.last_message_at).toLocaleString()
                    : "—"}
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={`/dashboard/conversations/${session.id}`}
                    className="text-slate-900 underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {(sessions?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  No conversations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
