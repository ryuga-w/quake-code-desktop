import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const fetchMock = vi.fn<() => Promise<FetchResponse>>();

function bridgeJson(body: Record<string, unknown>, ok = true): FetchResponse {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}

describe("BridgePage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.QUAKE_BROWSER_BRIDGE_PORT;
    delete process.env.QUAKE_CDP_HOST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadBridgePage() {
    return import("../src/bundled/extensions/quake-browser-tools/bridge-page.js");
  }

  it("hover posts target to the electron bridge", async () => {
    fetchMock.mockResolvedValue(
      bridgeJson({ ok: true, url: "https://example.com", title: "Example" }),
    );
    const { BridgePage } = await loadBridgePage();
    const page = new BridgePage();
    await page.locator("ref=e12").hover();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/agent-browser/hover",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "ref=e12" }),
      }),
    );
  });

  it("selectOption resolves string values", async () => {
    fetchMock.mockResolvedValue(
      bridgeJson({ ok: true, url: "https://example.com", title: "Example" }),
    );
    const { BridgePage } = await loadBridgePage();
    const page = new BridgePage();
    await page.locator("ref=e3").selectOption("alpha");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/agent-browser/select-option",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "ref=e3", value: "alpha" }),
      }),
    );
  });

  it("selectOption prefers value over label on object payloads", async () => {
    fetchMock.mockResolvedValue(
      bridgeJson({ ok: true, url: "https://example.com", title: "Example" }),
    );
    const { BridgePage } = await loadBridgePage();
    const page = new BridgePage();
    await page.locator("ref=e4").selectOption({ value: "v1", label: "Visible label" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/agent-browser/select-option",
      expect.objectContaining({
        body: JSON.stringify({ target: "ref=e4", value: "v1" }),
      }),
    );
  });

  it("selectOption falls back to label when value is absent", async () => {
    fetchMock.mockResolvedValue(
      bridgeJson({ ok: true, url: "https://example.com", title: "Example" }),
    );
    const { BridgePage } = await loadBridgePage();
    const page = new BridgePage();
    await page.locator("ref=e5").selectOption({ label: "Option B" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/agent-browser/select-option",
      expect.objectContaining({
        body: JSON.stringify({ target: "ref=e5", value: "Option B" }),
      }),
    );
  });

  it("uses custom bridge host and port from env", async () => {
    process.env.QUAKE_BROWSER_BRIDGE_PORT = "9333";
    process.env.QUAKE_CDP_HOST = "10.0.0.5";
    fetchMock.mockResolvedValue(
      bridgeJson({ ok: true, url: "https://example.com", title: "Example" }),
    );
    const { BridgePage } = await loadBridgePage();
    const page = new BridgePage();
    await page.locator("ref=e9").hover();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.0.0.5:9333/agent-browser/hover",
      expect.any(Object),
    );
  });
});