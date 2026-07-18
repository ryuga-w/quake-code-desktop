import * as _bundledPiAgentCore from "@mrquake/quakecode-agent-core";
import * as _bundledPiAi from "@mrquake/quakecode-ai";
import * as _bundledPiAiOauth from "@mrquake/quakecode-ai/oauth";
import * as _bundledPiTui from "@mrquake/quakecode-tui";
import * as _bundledTypebox from "@sinclair/typebox";
import * as _bundledPiCodingAgent from "../../index.js";

export const VIRTUAL_MODULES: Record<string, unknown> = {
	"@sinclair/typebox": _bundledTypebox,
	"@mrquake/quakecode-agent-core": _bundledPiAgentCore,
	"@mrquake/quakecode-tui": _bundledPiTui,
	"@mrquake/quakecode-ai": _bundledPiAi,
	"@mrquake/quakecode-ai/oauth": _bundledPiAiOauth,
	"@mrquake/quakecode-cli": _bundledPiCodingAgent,
};
