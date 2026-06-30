import { createServerSupabase } from "@/lib/supabase-server";

export default async function ConversationThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("id, patient_phone, status")
    .eq("id", id)
    .single();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: true });

  return (
    <div>
      <h1 className="text-2xl font-semibold">{session?.patient_phone ?? "Conversation"}</h1>
      <p className="text-sm capitalize text-slate-500">{session?.status}</p>

      <div className="mt-6 max-w-xl space-y-3">
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "max-w-md rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm"
                : "ml-auto max-w-md rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
            }
          >
            {m.content}
          </div>
        ))}
        {(messages?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">No messages yet.</p>
        )}
      </div>
    </div>
  );
}
