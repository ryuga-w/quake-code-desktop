import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractNetworkTargets } from "./extract.js";
import { normalizeHost, hostMatches } from "./normalize.js";
import { NetworkPolicyStore, sessionNetworkPolicy } from "./policy.js";
import {
	allowDurableHost,
	configureDurableNetworkHostsPath,
	denyDurableHost,
	flushDurableNetworkHostsWrites,
	listDurableNetworkHosts,
	loadDurableNetworkHosts,
	removeDurableHost,
	resetDurableNetworkHostsForTests,
	saveDurableNetworkHosts,
} from "./durable-hosts.js";

afterEach(() => {
	sessionNetworkPolicy.clear();
	resetDurableNetworkHostsForTests();
});

describe("network-policy extract + store", () => {
	it("extracts host from curl https URL", () => {
		const t = extractNetworkTargets('curl -s "https://api.github.com/repos/x"');
		expect(t.some((x) => x.host === "api.github.com")).toBe(true);
		expect(t.find((x) => x.host === "api.github.com")?.protocol).toBe("https");
	});

	it("extracts from git clone", () => {
		const t = extractNetworkTargets("git clone https://github.com/foo/bar.git");
		expect(t.some((x) => x.host === "github.com")).toBe(true);
	});

	it("extracts from go get module path", () => {
		const t = extractNetworkTargets("go get golang.org/x/tools/gopls@latest");
		expect(t.some((x) => x.host === "golang.org")).toBe(true);
	});

	it("extracts from docker pull with registry host", () => {
		const t = extractNetworkTargets("docker pull ghcr.io/org/image:tag");
		expect(t.some((x) => x.host === "ghcr.io")).toBe(true);
	});

	it("returns empty for local commands", () => {
		expect(extractNetworkTargets("ls -la")).toEqual([]);
	});

	it("normalizeHost strips port", () => {
		expect(normalizeHost("Example.COM:443")).toBe("example.com");
	});

	it("hostMatches supports suffix rules", () => {
		expect(hostMatches("api.github.com", "*.github.com")).toBe(true);
		expect(hostMatches("evil.com", "*.github.com")).toBe(false);
	});

	it("session store allow/deny", () => {
		const s = new NetworkPolicyStore();
		expect(s.evaluateHost("api.example.com")).toBe("ask");
		s.allowHost("api.example.com");
		expect(s.evaluateHost("api.example.com")).toBe("allow");
		s.denyHost("bad.example.com");
		expect(s.evaluateHost("bad.example.com")).toBe("deny");
		expect(s.evaluateHosts(["api.example.com", "bad.example.com"])).toBe("deny");
	});
});

describe("durable network hosts (S-NET.1)", () => {
	it("allow survives load/save cycle", async () => {
		const dir = await mkdtemp(join(tmpdir(), "quake-net-hosts-"));
		const path = join(dir, "network-hosts.json");
		configureDurableNetworkHostsPath({ path, resetMemory: true });
		await loadDurableNetworkHosts(path);

		allowDurableHost("registry.npmjs.org");
		allowDurableHost("Example.COM:443");
		await flushDurableNetworkHostsWrites();

		const onDisk = JSON.parse(await readFile(path, "utf8")) as {
			version: number;
			allowed: string[];
			denied: string[];
		};
		expect(onDisk.version).toBe(1);
		expect(onDisk.allowed).toContain("registry.npmjs.org");
		expect(onDisk.allowed).toContain("example.com");

		// Fresh memory + reload
		resetDurableNetworkHostsForTests();
		configureDurableNetworkHostsPath({ path, resetMemory: true });
		const loaded = await loadDurableNetworkHosts(path);
		expect(loaded.allowed).toEqual(expect.arrayContaining(["registry.npmjs.org", "example.com"]));
		expect(sessionNetworkPolicy.evaluateHost("registry.npmjs.org")).toBe("allow");
		expect(sessionNetworkPolicy.evaluateHost("example.com")).toBe("allow");
	});

	it("durable deny hard-blocks and survives session clear", async () => {
		const dir = await mkdtemp(join(tmpdir(), "quake-net-hosts-"));
		const path = join(dir, "network-hosts.json");
		await loadDurableNetworkHosts(path);

		denyDurableHost("evil.example.com");
		await flushDurableNetworkHostsWrites();

		expect(sessionNetworkPolicy.evaluateHost("evil.example.com")).toBe("deny");
		sessionNetworkPolicy.clear();
		expect(sessionNetworkPolicy.evaluateHost("evil.example.com")).toBe("deny");

		// reload cycle
		resetDurableNetworkHostsForTests();
		await loadDurableNetworkHosts(path);
		expect(sessionNetworkPolicy.evaluateHost("evil.example.com")).toBe("deny");
	});

	it("durable allow skips ask; session deny still wins over durable allow", async () => {
		const dir = await mkdtemp(join(tmpdir(), "quake-net-hosts-"));
		await loadDurableNetworkHosts(join(dir, "network-hosts.json"));

		allowDurableHost("api.github.com");
		expect(sessionNetworkPolicy.evaluateHost("api.github.com")).toBe("allow");

		sessionNetworkPolicy.denyHost("api.github.com");
		expect(sessionNetworkPolicy.evaluateHost("api.github.com")).toBe("deny");
	});

	it("remove + list + save API", async () => {
		const dir = await mkdtemp(join(tmpdir(), "quake-net-hosts-"));
		const path = join(dir, "network-hosts.json");
		await loadDurableNetworkHosts(path);

		allowDurableHost("a.example");
		denyDurableHost("b.example");
		expect(listDurableNetworkHosts()).toEqual({
			allowed: ["a.example"],
			denied: ["b.example"],
		});
		expect(removeDurableHost("a.example")).toBe(true);
		expect(listDurableNetworkHosts().allowed).toEqual([]);
		await saveDurableNetworkHosts();
		const reloaded = await loadDurableNetworkHosts(path);
		expect(reloaded).toEqual({ allowed: [], denied: ["b.example"] });
	});
});
