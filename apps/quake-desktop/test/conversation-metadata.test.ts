import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationMetadataService, normalizeSessionMetadataPath } from "../src/server/conversation-metadata.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ConversationMetadataService", () => {
  it("persists archive, pin and alias metadata across service restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quake-conversation-metadata-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "conversation-metadata.json");
    const session = join(directory, "Sessions", "chat.jsonl");
    const key = normalizeSessionMetadataPath(session);

    const first = new ConversationMetadataService(file);
    await first.patch({
      archivedSessionPaths: [session, session],
      pinnedSessionPaths: [session],
      sessionAliases: { [session]: "Kalıcı sohbet" },
    });

    const restored = await new ConversationMetadataService(file).read();
    expect(restored.archivedSessionPaths).toEqual([key]);
    expect(restored.pinnedSessionPaths).toEqual([key]);
    expect(restored.sessionAliases).toEqual({ [key]: "Kalıcı sohbet" });
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
  });

  it("keeps untouched fields when patching one metadata category", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quake-conversation-metadata-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "conversation-metadata.json");
    const service = new ConversationMetadataService(file);
    await service.patch({ archivedSessionPaths: [join(directory, "one.jsonl")] });
    const updated = await service.patch({ pinnedSessionPaths: [join(directory, "two.jsonl")] });

    expect(updated.archivedSessionPaths).toHaveLength(1);
    expect(updated.pinnedSessionPaths).toHaveLength(1);
  });
});
