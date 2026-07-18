import type { ExtensionCommandContext } from "@mrquake/quakecode-cli";
import { buildLeaderProtocolPrompt } from "./prompts.js";
import { createRoom, getStatus, listRooms, updateRoomPhase } from "./store.js";

export async function handleRoomCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const trimmed = args.trim();
	if (trimmed) {
		const goal = trimmed;
		const name = goal.length > 48 ? `${goal.slice(0, 45)}…` : goal;
		const sessionId = safeSessionId(ctx);
		const room = createRoom(ctx.cwd, {
			name,
			goal,
			leaderSessionId: sessionId,
			phase: "plan",
		});
		updateRoomPhase(ctx.cwd, room.id, "plan");
		ctx.ui.notify(
			[
				`Ajan Odası açıldı: ${room.name} (${room.id})`,
				"Lider sensin — görevleri planla, agent_room_dispatch ile uzman ata, bitince agent_room_finalize ile birleştir.",
			].join("\n"),
			"info",
		);
		return;
	}

	const rooms = listRooms(ctx.cwd);
	const options = [
		"Yeni oda aç (hedef sor)",
		"Lider protokolünü göster",
		...(rooms.length > 0 ? [`Odalar (${rooms.length})`] : []),
	];

	const choice = await ctx.ui.select("Ajan Odası — Lider", options);
	if (!choice) return;

	if (choice === "Yeni oda aç (hedef sor)") {
		const goal = await ctx.ui.input("Oda hedefi", "Örn: Auth modülünü session tabanlı yapıya taşı");
		if (!goal?.trim()) return;
		const nameInput = await ctx.ui.input("Oda adı (opsiyonel)", goal.slice(0, 48));
		const room = createRoom(ctx.cwd, {
			id: nameInput?.trim() || undefined,
			name: nameInput?.trim() || goal.slice(0, 48),
			goal: goal.trim(),
			leaderSessionId: safeSessionId(ctx),
			phase: "plan",
		});
		ctx.ui.notify(`Oda hazır: ${room.id}. Plan moduna geç — görev ekle, dependsOn tanımla, dispatch et.`, "success");
		return;
	}

	if (choice === "Lider protokolünü göster") {
		ctx.ui.notify(buildLeaderProtocolPrompt(), "info");
		return;
	}

	if (choice.startsWith("Odalar (")) {
		const labels = rooms.map(
			(summary) =>
				`${summary.room.name} [${summary.room.phase || "brief"}] — ${summary.activeTaskCount} aktif / ${summary.taskCount} görev`,
		);
		const picked = await ctx.ui.select("Oda seç", labels);
		if (!picked) return;
		const index = labels.indexOf(picked);
		const summary = rooms[index];
		if (!summary) return;
		const status = getStatus(ctx.cwd, summary.room.id);
		const taskLines = status.recentTasks
			.map((task) => `${task.id} [${task.status}] ${task.title}${task.dependsOn?.length ? ` ← ${task.dependsOn.join(", ")}` : ""}`)
			.join("\n");
		ctx.ui.notify(
			[
				`${status.room.name} (${status.room.id})`,
				`Hedef: ${status.room.goal}`,
				`Faz: ${status.room.phase || "brief"} | Lider: ${status.room.leaderSessionId?.slice(0, 8) || "atanmadı"}…`,
				`Mesaj: ${status.messageCount} | Görev: ${status.taskCount} | Artifact: ${status.artifactCount}`,
				taskLines ? `Görevler:\n${taskLines}` : "Görev yok.",
			].join("\n\n"),
			"info",
		);
	}
}

function safeSessionId(ctx: ExtensionCommandContext): string | undefined {
	try {
		return ctx.sessionManager.getSessionId();
	} catch {
		return undefined;
	}
}