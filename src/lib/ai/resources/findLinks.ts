import "server-only";

/**
 * Find REAL web resources (videos, images, pages) for a lesson plan.
 *
 * The lesson model cannot browse and would invent URLs, so links never come
 * from it. Instead one OpenRouter call with the `web` plugin searches the web;
 * we keep only the URLs the search actually cited (`url_citation`
 * annotations), then fetch each one ourselves and drop anything that does not
 * load. Best effort: any failure returns `[]` — a plan is never blocked on
 * links.
 */
import { generateObject } from "ai";
import { z } from "zod";

import type { ResourceLink, StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";
import { getModel, hasApiKey } from "@/lib/ai/model";
import { resolveGenerationModelId } from "@/lib/ai/modelSetting";
import { env } from "@/lib/env";
import { parseGradeNum } from "@/lib/naming/grade";

import {
  isDocumentFile,
  leadProviders,
  providerForHost,
  providersFor,
  scoreLink,
  teachingLanguage,
  tooAdvanced,
  type Provider,
} from "./providers";

const MAX_LINKS = 5;
const MAX_PER_KIND = { video: 3, image: 1, page: 2 } as const;
const MAX_PER_HOST = 2;
const VERIFY_TIMEOUT_MS = 6000;
const SEARCH_TIMEOUT_MS = 45000;

/** Set RESOURCE_LINKS_DEBUG=1 to print each stage of the pipeline (for tuning the search). */
const debug = (...args: unknown[]) => {
  if (process.env.RESOURCE_LINKS_DEBUG) console.log("[resources]", ...args);
};

interface Candidate {
  url: string;
  title: string;
}

/** Classify by host/path; anything unknown is a plain page. */
export function classifyUrl(url: URL): ResourceLink["kind"] {
  const host = url.hostname.replace(/^www\./, "");
  if (["youtube.com", "m.youtube.com", "youtu.be", "vimeo.com"].includes(host)) return "video";
  if (host === "khanacademy.org" && /\/v\//.test(url.pathname)) return "video";
  if (host === "upload.wikimedia.org" || /\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname)) {
    return "image";
  }
  return "page";
}

/** Titles a bot-blocked crawler records instead of the page's real title. */
const JUNK_TITLE =
  /^(client challenge|just a moment\.*|access denied|attention required.*|403 forbidden|forbidden|error|www\.[\w.-]+|[\w-]+\.[a-z]{2,}(\.[a-z]{2})?)$/i;

/**
 * A readable title from the address, for pages whose real title the search
 * could not read (Khan Academy sits behind a bot check, so every result is
 * "Client Challenge"). Their addresses describe the lesson:
 * `…/e/write-whole-numbers-to-100-000-in-expanded-form`.
 */
export function titleFromUrl(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const last = (parts.at(-1) ?? "").replace(/^[^:]*:/, "").replace(/\.[a-z0-9]{2,4}$/i, "");
  const words = decodeURIComponent(last).replace(/[-_+]+/g, " ").trim();
  if (!words || /^[a-z0-9]{12,}$/i.test(words)) return url.hostname.replace(/^www\./, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Normalise + filter: https only, no credentials, no localhost/IP hosts. */
export function cleanCandidate(c: Candidate): (Candidate & { parsed: URL }) | null {
  let parsed: URL;
  try {
    parsed = new URL(c.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const host = parsed.hostname;
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) {
    return null;
  }
  parsed.hash = "";
  const given = c.title.trim();
  const title = !given || JUNK_TITLE.test(given) ? titleFromUrl(parsed) : given;
  return { url: parsed.toString(), title, parsed };
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0 (compatible; LessonLinkCheck/1.0)", ...init.headers },
  });
}

/** Does the link actually load? YouTube/Vimeo go through oEmbed (exact + cheap). */
export async function verifyLink(
  parsed: URL,
  kind: ResourceLink["kind"],
  /** A preferred provider: bot-blocking (403/429) is not evidence the page is gone. */
  trusted = false,
): Promise<boolean> {
  try {
    // YouTube and Vimeo have an exact oEmbed check. Any other video page
    // (e.g. Khan Academy's /v/ pages) is checked like a normal page.
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (kind === "video" && (host === "youtube.com" || host === "youtu.be" || host === "vimeo.com")) {
      const oembed =
        host === "vimeo.com"
          ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(parsed.toString())}`
          : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsed.toString())}`;
      return (await timedFetch(oembed)).ok;
    }
    let res = await timedFetch(parsed.toString(), { method: "HEAD" });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await timedFetch(parsed.toString(), { headers: { range: "bytes=0-0" } });
    }
    if (!res.ok) return trusted && (res.status === 403 || res.status === 429);
    const type = res.headers.get("content-type") ?? "";
    return kind === "image" ? type.startsWith("image/") : true;
  } catch {
    return false;
  }
}

function topicLines(plan: StructuredLessonPlan): string[] {
  const idn = plan.identifier;
  return [
    `Lesson: ${idn.title} (${idn.grade} ${idn.subject}, Tanzania).`,
    `Pupils can: ${plan.success_criteria.slice(0, 3).join("; ")}.`,
    `Digital idea already suggested: ${plan.differentiation.digital_resources.join("; ")}.`,
  ];
}

/** The language rule, stated the same way in every search and in the relevance check. */
function languageRule(subject: string): string {
  return teachingLanguage(subject) === "sw"
    ? "This is a Kiswahili lesson: prefer material in Kiswahili."
    : "This school teaches in ENGLISH: only cite resources in English (English narration or " +
      "English text). Do NOT cite Kiswahili-language or other-language versions.";
}

const SAFETY =
  "Only cite pages that exist and suit young pupils: no adult, advert-heavy or off-topic sites.";

/** Search 1: videos first, English for English-medium lessons, Tanzanian a bonus. */
function tanzaniaQuery(plan: StructuredLessonPlan): string {
  return [
    ...topicLines(plan),
    languageRule(plan.identifier.subject),
    "Search the web for short educational VIDEOS first (YouTube is fine), then one freely reusable",
    "image (Wikimedia Commons preferred) and one teaching page.",
    "Material made in or for Tanzania or East Africa (Tanzanian curriculum, Ubongo Kids, Akili and Me)",
    "is a bonus when it is in the right language; it is not required.",
    SAFETY,
    "Reply with a one-line summary of each.",
  ].join(" ");
}

/** Search 2: the preferred providers that suit this grade and subject. */
function providerQuery(plan: StructuredLessonPlan, suited: Provider[]): string {
  return [
    ...topicLines(plan),
    languageRule(plan.identifier.subject),
    `Find the best matching videos, lessons or activities on this exact topic from these providers: ${suited
      .slice(0, 8)
      .map((p) => `${p.name} (${p.hosts[0]})`)
      .join("; ")}.`,
    "Prefer a specific video or lesson page over a home page. Prefer videos.",
    SAFETY,
    "Reply with a one-line summary of each.",
  ].join(" ");
}

/** Search 3+: one dedicated search per lead provider, so Khan Academy etc. can surface. */
function oneProviderQuery(plan: StructuredLessonPlan, p: Provider): string {
  return [
    ...topicLines(plan),
    languageRule(plan.identifier.subject),
    `Find the best matching video or lesson page on this exact topic from ${p.name} (${p.hosts[0]}) only.`,
    "Cite a specific video or lesson page, not the home page. If they have nothing on this topic, cite nothing.",
    SAFETY,
  ].join(" ");
}

async function search(prompt: string): Promise<Candidate[]> {
  const model = await resolveGenerationModelId();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      plugins: [{ id: "web", max_results: 6 }],
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`web search HTTP ${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }>;
      };
    }>;
  };
  const out: Candidate[] = [];
  for (const a of json.choices?.[0]?.message?.annotations ?? []) {
    const c = a.type === "url_citation" ? a.url_citation : undefined;
    if (c?.url) out.push({ url: c.url, title: c.title ?? "" });
  }
  return out;
}

/** How many ranked candidates the relevance check looks at. */
const JUDGE_TOP = 12;

/**
 * Ask the model which candidates really fit THIS lesson and grade. Ranking
 * alone favours any Tanzanian video, so a growth-science video could land on a
 * safety-signs plan, or Form One notes on a Grade 4 plan. Fails open (keeps
 * everything) so a judging hiccup never costs a plan its links.
 */
async function keepRelevant<T extends { url: string; title: string; host: string }>(
  plan: StructuredLessonPlan,
  ranked: T[],
): Promise<T[]> {
  const top = ranked.slice(0, JUDGE_TOP);
  if (top.length === 0) return top;
  try {
    const idn = plan.identifier;
    const { object } = await generateObject({
      model: getModel(await resolveGenerationModelId()),
      schema: z.object({ keep: z.array(z.number().int()) }),
      schemaName: "relevant_links",
      system:
        "You check web resources for a primary/secondary school lesson in Tanzania. Keep only links " +
        "that directly teach or show THIS lesson's topic and suit pupils of THIS grade. Reject links " +
        "in the wrong language (" + languageRule(plan.identifier.subject) + "), about a different topic, notes written for a much older class (e.g. Form One/secondary notes " +
        "for a primary lesson), or anything unsuitable for children. Judge from the title and address.",
      prompt: [
        `Grade ${idn.grade}, ${idn.subject}. Lesson: ${idn.title}.`,
        `Pupils can: ${plan.success_criteria.slice(0, 3).join("; ")}.`,
        "Candidates:",
        ...top.map((c, i) => `${i}. ${c.title} — ${c.host} — ${c.url}`),
        "Return the numbers of the candidates to keep (an empty list if none fit).",
      ].join("\n"),
    });
    debug("judge kept", object.keep, "of", top.length);
    const keep = new Set(object.keep);
    return top.filter((_, i) => keep.has(i));
  } catch (err) {
    console.error("[ai/resources] relevance check failed:", err instanceof Error ? err.message : err);
    return top;
  }
}

/** Search, filter, verify, rank, cap. Never throws. */
export async function findResourceLinks(plan: StructuredLessonPlan): Promise<ResourceLink[]> {
  if (!hasApiKey()) return [];
  try {
    const idn = plan.identifier;
    const gradeNum = parseGradeNum(idn.grade) ?? 3;
    const suited = providersFor(gradeNum, idn.subject);

    // Two searches in parallel; one failing still leaves the other's results.
    const settled = await Promise.allSettled([
      search(tanzaniaQuery(plan)),
      ...(suited.length > 0 ? [search(providerQuery(plan, suited))] : []),
      ...leadProviders(suited).map((prov) => search(oneProviderQuery(plan, prov))),
    ]);
    const found = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (found.length === 0 && settled.every((r) => r.status === "rejected")) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }

    const seen = new Set<string>();
    const cleaned = found
      .map(cleanCandidate)
      .filter((c): c is NonNullable<ReturnType<typeof cleanCandidate>> => {
        if (!c || seen.has(c.url) || isDocumentFile(c.url)) return false;
        seen.add(c.url);
        return true;
      })
      .map((c) => {
        const host = c.parsed.hostname.replace(/^www\./, "");
        return { ...c, host, kind: classifyUrl(c.parsed) };
      });

    debug("candidates after clean:", cleaned.length);
    const checks = await Promise.all(
      cleaned.map((c) => verifyLink(c.parsed, c.kind, Boolean(providerForHost(c.host, suited)))),
    );
    const ranked = cleaned
      .filter((c, i) => checks[i] && !tooAdvanced(c.title, c.url, gradeNum))
      .map((c) => ({ c, score: scoreLink(c, suited, teachingLanguage(idn.subject)) }))
      .sort((x, y) => y.score - x.score)
      .map((x) => x.c);
    debug("verified, ranked:");
    ranked.forEach((c, i) => debug(`  ${i}. ${c.kind} ${c.host} | ${c.title.slice(0, 50)} | ${c.url.slice(0, 80)}`));
    const dropped = cleaned.filter((_, i) => !checks[i]).map((c) => c.url.slice(0, 90));
    if (dropped.length > 0) debug("failed the link check:", dropped);
    const relevant = await keepRelevant(plan, ranked);

    const counts = { video: 0, image: 0, page: 0 };
    const perHost = new Map<string, number>();
    const links: ResourceLink[] = [];
    for (const c of relevant) {
      if (links.length >= MAX_LINKS) break;
      if (counts[c.kind] >= MAX_PER_KIND[c.kind]) continue;
      if ((perHost.get(c.host) ?? 0) >= MAX_PER_HOST) continue;
      counts[c.kind] += 1;
      perHost.set(c.host, (perHost.get(c.host) ?? 0) + 1);
      links.push({ title: c.title.slice(0, 140), url: c.url, kind: c.kind, source: c.host });
    }
    return links;
  } catch (err) {
    console.error("[ai/resources] link search failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
