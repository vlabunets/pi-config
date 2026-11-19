import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface StructuredSearchArgs {
	query?: string;
	exactPhrases?: string[];
	excludeTerms?: string[];
	site?: string;
	count?: number;
}

interface BuiltSearchQuery {
	query: string;
	baseQuery?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	site?: string;
}

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
	return decodeHtmlEntities(html.replace(/<[^>]+>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

function unwrapDuckDuckGoUrl(rawHref: string): string {
	const href = decodeHtmlEntities(rawHref.trim());
	try {
		const normalized = href.startsWith("//") ? `https:${href}` : href;
		const parsed = new URL(normalized, "https://html.duckduckgo.com");
		const uddg = parsed.searchParams.get("uddg");
		if (uddg) return uddg;
		return parsed.toString();
	} catch {
		return href;
	}
}

async function duckDuckGoLiteSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const resp = await fetch("https://lite.duckduckgo.com/lite/", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
			"Accept-Language": "en-US,en;q=0.9",
			Origin: "https://lite.duckduckgo.com",
			Referer: "https://lite.duckduckgo.com/",
		},
		body: new URLSearchParams({ q: query }).toString(),
		signal,
	});

	if (resp.status !== 200) {
		throw new Error(`DuckDuckGo Lite HTTP ${resp.status}`);
	}

	const html = await resp.text();
	if (html.includes("anomaly-modal") || html.includes("cc=botnet")) {
		throw new Error("DuckDuckGo rate-limited or challenged the request.");
	}

	const linkRe =
		/<a\b(?=[^>]*\bclass=['"][^'"]*\bresult-link\b[^'"]*['"])(?=[^>]*\bhref=['"]([^'"]+)['"])[^>]*>([\s\S]*?)<\/a>/g;
	const snipRe =
		/<td\b[^>]*\bclass=['"][^'"]*\bresult-snippet\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/g;

	const links = [...html.matchAll(linkRe)];
	const snips = [...html.matchAll(snipRe)];
	const results: SearchResult[] = [];

	for (let i = 0; i < links.length && results.length < count; i++) {
		const url = unwrapDuckDuckGoUrl(links[i][1]);
		if (!url || url.includes("duckduckgo.com/y.js")) continue;
		const title = stripTags(links[i][2]);
		if (!title) continue;
		const snippet = snips[i] ? stripTags(snips[i][1]) : "";
		results.push({ title, url, snippet });
	}

	return results;
}

async function duckDuckGoHtmlSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const resp = await fetch("https://html.duckduckgo.com/html/", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
			"Accept-Language": "en-US,en;q=0.9",
			Origin: "https://html.duckduckgo.com",
			Referer: "https://html.duckduckgo.com/",
		},
		body: new URLSearchParams({ q: query, kl: "" }).toString(),
		signal,
	});

	if (resp.status !== 200) {
		throw new Error(`DuckDuckGo HTML HTTP ${resp.status}`);
	}

	const html = await resp.text();
	if (html.includes("anomaly-modal") || html.includes("cc=botnet")) {
		throw new Error("DuckDuckGo rate-limited or challenged the request (CAPTCHA). Try again shortly.");
	}

	const linkRe =
		/<a\b(?=[^>]*\bclass=['"][^'"]*\bresult__a\b[^'"]*['"])(?=[^>]*\bhref=['"]([^'"]+)['"])[^>]*>([\s\S]*?)<\/a>/g;
	const snipRe =
		/<(?:a|div|span)\b[^>]*\bclass=['"][^'"]*\bresult__snippet\b[^'"]*['"][^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;

	const links = [...html.matchAll(linkRe)];
	const snips = [...html.matchAll(snipRe)];
	const results: SearchResult[] = [];

	for (let i = 0; i < links.length && results.length < count; i++) {
		const url = unwrapDuckDuckGoUrl(links[i][1]);
		if (!url || url.includes("duckduckgo.com/y.js")) continue;
		const title = stripTags(links[i][2]);
		if (!title) continue;
		const snippet = snips[i] ? stripTags(snips[i][1]) : "";
		results.push({ title, url, snippet });
	}

	return results;
}

async function duckDuckGoSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const num = Math.min(Math.max(count, 1), 10);
	try {
		const liteResults = await duckDuckGoLiteSearch(query, num, signal);
		if (liteResults.length > 0) return liteResults;
	} catch {
		// Fall through to html.duckduckgo.com
	}
	return duckDuckGoHtmlSearch(query, num, signal);
}

function formatResults(results: SearchResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
		.join("\n\n");
}

function stripWrappingQuotes(value: string): string {
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).trim()
		: value;
}

function cleanItems(values?: string[]): string[] {
	if (!values) return [];
	return values
		.map((value) => stripWrappingQuotes(value.trim().replace(/\s+/g, " ")))
		.filter(Boolean);
}

function cleanQuery(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/\s+/g, " ");
	return cleaned || undefined;
}

function normalizeSite(site?: string): string | undefined {
	if (typeof site !== "string") return undefined;

	let value = site.trim().replace(/^site:/i, "").trim();
	if (!value) return undefined;

	try {
		const candidate = /^[a-z]+:\/\//i.test(value)
			? value
			: `https://${value}`;
		const url = new URL(candidate);
		if (url.hostname) value = url.hostname;
	} catch {}

	return value.replace(/\/+$/, "") || undefined;
}

function quoteForSearch(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(args: StructuredSearchArgs): BuiltSearchQuery {
	const baseQuery = cleanQuery(args.query);
	const exactPhrases = cleanItems(args.exactPhrases);
	const excludeTerms = cleanItems(args.excludeTerms);
	const site = normalizeSite(args.site);

	if (!baseQuery && exactPhrases.length === 0) {
		throw new Error(
			"At least one of 'query' or 'exactPhrases' is required.",
		);
	}

	const parts: string[] = [];
	if (baseQuery) parts.push(baseQuery);
	for (const phrase of exactPhrases) {
		parts.push(quoteForSearch(phrase));
	}
	for (const term of excludeTerms) {
		parts.push(`-${term.includes(" ") ? quoteForSearch(term) : term}`);
	}
	if (site) {
		parts.push(`site:${site}`);
	}

	return {
		query: parts.join(" "),
		baseQuery,
		exactPhrases,
		excludeTerms,
		site,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web (DuckDuckGo keyless search by default). Build one search per call from a base query string, exact phrases, exclusions, and an optional site. Returns title, URL, and snippet.",
		promptSnippet:
			"Search the web via a query string plus optional exactPhrases, excludeTerms, and site. Use one tool call per search angle.",
		promptGuidelines: [
			"Use exactPhrases for exact phrase matching instead of embedding quote marks inside the main query string.",
			"Use one web_search tool call per search angle instead of batching multiple searches into one call.",
		],

		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Base search query as a normal string. Prefer this for the main search wording.",
				}),
			),
			exactPhrases: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Exact phrases to match. Each item becomes a quoted phrase in the final search query.",
				}),
			),
			excludeTerms: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Terms or phrases to exclude. Multi-word items are excluded as exact phrases.",
				}),
			),
			site: Type.Optional(
				Type.String({
					description:
						"Optional site/domain restriction, such as example.com or a full URL.",
				}),
			),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 10)",
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params: StructuredSearchArgs, signal) {
			const count = params.count ?? 5;
			const built = buildSearchQuery(params);
			const results = await duckDuckGoSearch(built.query, count, signal);

			return {
				content: [
					{
						type: "text" as const,
						text: formatResults(results),
					},
				],
				details: {
					provider: "duckduckgo",
					composedQuery: built.query,
					query: built.baseQuery,
					exactPhrases: built.exactPhrases,
					excludeTerms: built.excludeTerms,
					site: built.site,
					resultCount: results.length,
				},
			};
		},

		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);
			const { count, ...searchArgs } = args as StructuredSearchArgs;

			try {
				const built = buildSearchQuery(searchArgs);
				const display =
					built.query.length > 70
						? built.query.slice(0, 67) + "..."
						: built.query;
				const lines = [
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("accent", `"${display}"`),
				];
				if (count && count !== 5) {
					lines.push(theme.fg("dim", `  count: ${count}`));
				}
				text.setText(lines.join("\n"));
				return text;
			} catch {
				text.setText(
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("error", "(invalid query)"),
				);
				return text;
			}
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);

			if (isPartial) {
				text.setText(theme.fg("warning", "Searching…"));
				return text;
			}

			if (context.isError) {
				const msg =
					result.content.find((c) => c.type === "text")?.text ||
					"Error";
				text.setText(theme.fg("error", msg));
				return text;
			}

			const details = result.details as {
				provider?: string;
				composedQuery?: string;
				resultCount?: number;
			};
			const status = theme.fg(
				"success",
				`${details?.resultCount ?? 0} results`,
			);
			if (!expanded) {
				text.setText(status);
				return text;
			}

			const content =
				result.content.find((c) => c.type === "text")?.text || "";
			const preview =
				content.length > 500 ? content.slice(0, 500) + "..." : content;
			const queryLine = details?.composedQuery
				? theme.fg("dim", `query: ${details.composedQuery}`)
				: "";
			text.setText(
				[status, queryLine, theme.fg("dim", preview)]
					.filter(Boolean)
					.join("\n"),
			);
			return text;
		},
	});
}
