export type VideoFailureCategory =
	| "content_moderation"
	| "quota_exceeded"
	| "authentication"
	| "invalid_request"
	| "server_error"
	| "job_failed"
	| "timeout"
	| "unknown";

export interface VideoFailureReport {
	category: VideoFailureCategory;
	httpStatus?: number;
	apiMessage?: string;
	apiCode?: string;
	summary: string;
	agentExplanation: string;
	userSuggestion: string;
	rawExcerpt: string;
	endpoint?: string;
}

function extractApiError(body: string): { message?: string; code?: string } {
	const trimmed = body.trim();
	if (!trimmed) return {};

	try {
		const json = JSON.parse(trimmed) as Record<string, unknown>;
		const err = json.error;
		if (typeof err === "string") return { message: err };
		if (err && typeof err === "object") {
			const rec = err as Record<string, unknown>;
			return {
				message:
					(typeof rec.message === "string" && rec.message) ||
					(typeof rec.error === "string" && rec.error) ||
					undefined,
				code: (typeof rec.code === "string" && rec.code) || (typeof rec.type === "string" && rec.type) || undefined,
			};
		}
		for (const key of ["message", "detail", "failure_reason", "error_message", "reason"] as const) {
			if (typeof json[key] === "string") return { message: json[key] };
		}
	} catch {
		// plain text body
	}

	return { message: trimmed.slice(0, 600) || undefined };
}

export function classifyVideoFailure(httpStatus: number, bodyText: string, endpoint?: string): VideoFailureReport {
	const { message: apiMessage, code: apiCode } = extractApiError(bodyText);
	const haystack = `${apiMessage || ""} ${apiCode || ""} ${bodyText}`.toLowerCase();

	let category: VideoFailureCategory = "unknown";
	if (
		/moderat|content.?policy|safety|nsfw|inappropriate|blocked|reject|violat|harmful|sexual|nudity|explicit|not allowed|disallowed|policy|unsafe|adult content|cannot generate/i.test(
			haystack,
		)
	) {
		category = "content_moderation";
	} else if (
		httpStatus === 429 ||
		/quota|rate.?limit|usage.?limit|limit exceeded|too many requests|resource_exhausted|capacity|exceeded.*limit/i.test(
			haystack,
		)
	) {
		category = "quota_exceeded";
	} else if (
		httpStatus === 401 ||
		httpStatus === 403 ||
		/unauthorized|forbidden|invalid.*token|auth/i.test(haystack)
	) {
		category = "authentication";
	} else if (httpStatus >= 500) {
		category = "server_error";
	} else if (httpStatus === 400 || /invalid|bad request/i.test(haystack)) {
		category = "invalid_request";
	} else if (/failed|failure|error|canceled|cancelled/i.test(haystack)) {
		category = "job_failed";
	}

	const summaries: Record<VideoFailureCategory, string> = {
		content_moderation: "Video isteği içerik moderasyonu / güvenlik filtresi tarafından reddedildi.",
		quota_exceeded: "Video kotası veya hız limiti aşıldı.",
		authentication: "Grok video API kimlik doğrulaması başarısız.",
		invalid_request: "Video API isteği geçersiz veya desteklenmiyor.",
		server_error: "Video API sunucu hatası döndü.",
		job_failed: "Video işi oluşturuldu ama üretim aşamasında başarısız oldu.",
		timeout: "Video üretimi zaman aşımına uğradı (URL hazır olmadı).",
		unknown: "Video üretimi bilinmeyen bir nedenle başarısız oldu.",
	};

	const explanations: Record<VideoFailureCategory, string> = {
		content_moderation:
			"Prompt xAI/Grok güvenlik kurallarına takıldı (çıplaklık, cinsel içerik, şiddet vb.). Bu bir teknik arıza değil; API kasıtlı olarak üretmiyor.",
		quota_exceeded: "Hesabın video üretim kotası dolmuş veya çok sık istek atılmış olabilir. Moderasyon reddi değil.",
		authentication: "~/.grok/auth.json token'ı geçersiz, süresi dolmuş veya video yetkisi yok.",
		invalid_request: "Gönderilen parametreler (süre, aspect ratio, model) API tarafından reddedildi.",
		server_error: "xAI tarafında geçici sunucu sorunu olabilir; tekrar denenebilir.",
		job_failed: "İş kuyruğa alındı fakat render aşamasında hata/iptal döndü — genelde prompt veya politika kaynaklı.",
		timeout:
			"Tüm endpoint'ler denendi veya poll tamamlandı ama indirilebilir video URL'si gelmedi. Kotayı veya sessiz moderasyon reddini kontrol et.",
		unknown: "API ayrıntılı hata vermedi; ham yanıt aşağıda.",
	};

	const suggestions: Record<VideoFailureCategory, string> = {
		content_moderation:
			"Prompt'u daha güvenli ve giyinik bir sahneyle yeniden yazmayı öner; 'bilmiyorum' deme — moderasyon reddi olduğunu açıkça söyle.",
		quota_exceeded:
			"Kotanın dolması ihtimalini söyle; bir süre sonra tekrar denemesini veya /video sayfasından kontrol etmesini öner.",
		authentication: "Grok oturumunu yenilemesini (~/.grok/auth.json) veya XAI_API_KEY kontrol etmesini söyle.",
		invalid_request: "Süreyi kısalt, prompt'u sadeleştir veya farklı aspect ratio dene.",
		server_error: "Birkaç dakika sonra tekrar denemesini öner.",
		job_failed: "Prompt'u yumuşat veya sansürsüz ifadeleri kaldır; moderasyon veya render hatası olabilir.",
		timeout: "Kota veya moderasyon olabilir — kullanıcıya her iki ihtimali de açıkla.",
		unknown: "Ham hata metnini paylaş ve tekrar denemesini öner.",
	};

	return {
		category,
		httpStatus: httpStatus || undefined,
		apiMessage,
		apiCode,
		summary: summaries[category],
		agentExplanation: explanations[category],
		userSuggestion: suggestions[category],
		rawExcerpt: bodyText.slice(0, 400),
		endpoint,
	};
}

export function classifyVideoPollFailure(json: Record<string, unknown>, jobId: string): VideoFailureReport {
	const status =
		(typeof json.status === "string" && json.status) || (typeof json.state === "string" && json.state) || "failed";
	const body = JSON.stringify(json);
	const report = classifyVideoFailure(200, body);
	report.category = report.category === "unknown" ? "job_failed" : report.category;
	report.summary = `Video job ${jobId} durumu: ${status}. ${report.summary}`;
	return report;
}

export function classifyVideoTimeout(jobId: string, lastBody?: string): VideoFailureReport {
	const base = classifyVideoFailure(0, lastBody || "", undefined);
	base.category = "timeout";
	base.summary = `Video job ${jobId} zaman aşımı — indirilebilir URL gelmedi.`;
	base.agentExplanation =
		"Poll tamamlandı ama video URL yok. Sessiz moderasyon reddi veya kota bitmiş olabilir; kullanıcıya ikisini de açıkla.";
	return base;
}

export function formatVideoFailureForAgent(report: VideoFailureReport, extra?: Record<string, string>): string {
	return [
		"VIDEO_GENERATION_FAILED",
		`Category: ${report.category}`,
		report.httpStatus ? `HTTP: ${report.httpStatus}` : null,
		report.endpoint ? `Endpoint: ${report.endpoint}` : null,
		report.apiCode ? `API code: ${report.apiCode}` : null,
		`Summary: ${report.summary}`,
		report.apiMessage ? `API message: ${report.apiMessage}` : null,
		`Agent note: ${report.agentExplanation}`,
		`Tell user: ${report.userSuggestion}`,
		report.rawExcerpt ? `Raw API excerpt: ${report.rawExcerpt}` : null,
		extra
			? Object.entries(extra)
					.map(([k, v]) => `${k}: ${v}`)
					.join("\n")
			: null,
	]
		.filter(Boolean)
		.join("\n");
}

export function pickPrimaryVideoFailure(reports: VideoFailureReport[]): VideoFailureReport {
	const priority: VideoFailureCategory[] = [
		"content_moderation",
		"quota_exceeded",
		"authentication",
		"invalid_request",
		"job_failed",
		"server_error",
		"timeout",
		"unknown",
	];
	for (const cat of priority) {
		const hit = reports.find((r) => r.category === cat);
		if (hit) return hit;
	}
	return reports[0] || classifyVideoFailure(0, "No endpoints responded");
}
