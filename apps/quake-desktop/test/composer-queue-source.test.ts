import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const queue = readFileSync(
  join(process.cwd(), "src/client/src/components/composer/ComposerQueue.tsx"),
  "utf8",
);
const queueStyles = readFileSync(
  join(process.cwd(), "src/client/src/components/composer/ComposerQueue.module.css"),
  "utf8",
);
const app = readFileSync(join(process.cwd(), "src/client/src/app/App.tsx"), "utf8");
const composer = readFileSync(
  join(process.cwd(), "src/client/src/components/composer/ChatComposer.tsx"),
  "utf8",
);

describe("composer queue source contract", () => {
  it("keeps busy-turn messages above the composer until routed or flushed", () => {
    expect(queue).not.toContain("Şimdi yönlendirildi");
    expect(queue).toContain("<span>Yönlendir</span>");
    expect(queue).toContain("onSendNow(item)");
    expect(composer).toContain("localQueue.length > 0");
    expect(composer).toContain("items={localQueue}");
    expect(app).toContain("if (shouldQueue)");
    expect(app).toContain("queueUserPrompt(outgoingDisplayMessage, images");
  });

  it("attaches the compact queue strip to the top edge", () => {
    expect(queueStyles).toContain("position: absolute");
    expect(queueStyles).toContain("bottom: calc(100% - 1px)");
    expect(queueStyles).toContain("grid-template-columns: 16px minmax(0, 1fr) auto");
  });
});
