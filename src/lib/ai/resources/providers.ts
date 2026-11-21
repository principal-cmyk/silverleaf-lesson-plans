/**
 * Preferred resource providers and the ranking rules for found links.
 *
 * Pure (no network, no server-only) so it is unit-tested. The list is the one
 * place to add or remove a provider: `findLinks.ts` names these providers in
 * its search and gives their hosts a ranking bonus. Hosts match by suffix, so
 * "khanacademy.org" also covers "www.khanacademy.org".
 */

export interface Provider {
  name: string;
  /** Hosts that count as this provider (suffix match). */
  hosts: string[];
  /** Lowest and highest grade number it suits (KG = 0, G1 = 1 … G12 = 12). */
  grades: [number, number];
  /** Subject words (lowercase substrings); empty = every subject. */
  subjects: string[];
  /** Made in Tanzania / for Tanzanian pupils — ranked higher. */
  tanzanian?: boolean;
  /** Gets its own dedicated search (a general search rarely surfaces it). */
  lead?: boolean;
}

export const PROVIDERS: Provider[] = [
  // Tanzanian and East African
  { name: "Ubongo Kids / Akili and Me (Tanzania; English versions)", hosts: ["ubongo.org"], grades: [0, 6], subjects: [], tanzanian: true, lead: true },
  { name: "Tanzania Institute of Education (TIE)", hosts: ["tie.go.tz"], grades: [0, 12], subjects: [], tanzanian: true },
  { name: "Global Health Media (health videos)", hosts: ["globalhealthmedia.org"], grades: [0, 12], subjects: ["health", "science", "environment"], lead: true },
  { name: "African Storybook (English and Kiswahili readers)", hosts: ["africanstorybook.org"], grades: [0, 4], subjects: ["english", "kiswahili", "phonics", "reading", "literacy", "language"] },
  // Global, age-appropriate
  { name: "Khan Academy Kids", hosts: ["khankids.org", "learn.khanacademy.org"], grades: [0, 2], subjects: [], lead: true },
  { name: "Khan Academy", hosts: ["khanacademy.org"], grades: [1, 12], subjects: ["math", "science", "numeracy", "ict", "computer", "physics", "chemistry", "biology", "geography", "history"], lead: true },
  { name: "BBC Bitesize", hosts: ["bbc.co.uk", "bbc.com"], grades: [1, 12], subjects: [] },
  { name: "Oak National Academy", hosts: ["thenational.academy"], grades: [0, 12], subjects: [] },
  { name: "PhET simulations", hosts: ["phet.colorado.edu"], grades: [3, 12], subjects: ["math", "science", "physics", "chemistry", "biology", "numeracy"], lead: true },
  { name: "Starfall", hosts: ["starfall.com"], grades: [0, 3], subjects: ["english", "phonics", "reading", "literacy", "language"], lead: true },
  { name: "Jolly Learning (phonics)", hosts: ["jollylearning.co.uk"], grades: [0, 2], subjects: ["phonics", "english", "literacy"], lead: true },
  { name: "StoryWeaver (English and Kiswahili stories)", hosts: ["storyweaver.org.in"], grades: [0, 6], subjects: ["english", "kiswahili", "reading", "literacy", "language"] },
  { name: "British Council LearnEnglish Kids", hosts: ["learnenglishkids.britishcouncil.org"], grades: [0, 7], subjects: ["english", "language"] },
  { name: "NASA Space Place", hosts: ["spaceplace.nasa.gov"], grades: [2, 8], subjects: ["science", "environment"] },
  { name: "National Geographic Kids", hosts: ["kids.nationalgeographic.com"], grades: [1, 8], subjects: ["science", "geography", "environment", "health"] },
  { name: "Siyavula (African curriculum)", hosts: ["siyavula.com"], grades: [7, 12], subjects: ["math", "science", "physics", "chemistry"], lead: true },
  { name: "CK-12", hosts: ["ck12.org"], grades: [6, 12], subjects: ["math", "science", "physics", "chemistry", "biology"] },
];

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Providers that suit this grade number and subject name. */
export function providersFor(gradeNum: number, subject: string): Provider[] {
  const s = subject.toLowerCase();
  return PROVIDERS.filter(
    (p) =>
      gradeNum >= p.grades[0] &&
      gradeNum <= p.grades[1] &&
      (p.subjects.length === 0 || p.subjects.some((w) => s.includes(w))),
  );
}

/** The provider a host belongs to, among those that suit the lesson. */
export function providerForHost(host: string, suited: Provider[]): Provider | undefined {
  return suited.find((p) => p.hosts.some((h) => hostMatches(host, h)));
}

const TANZANIA_WORDS = /\b(tanzania|tanzanian|dar es salaam|east africa)\b/i;
const KISWAHILI_WORDS = /\b(swahili|kiswahili|kiswahili|sayansi|hisabati|somo|darasa)\b/i;

/**
 * The language a lesson is taught in: Silverleaf is an English-medium school,
 * so every subject is English except Kiswahili itself.
 */
export function teachingLanguage(subject: string): "en" | "sw" {
  return /swahili/i.test(subject) ? "sw" : "en";
}

/** Does this link look Tanzanian (host, title or address)? */
export function looksTanzanian(host: string, title: string, url: string): boolean {
  return host.endsWith(".tz") || TANZANIA_WORDS.test(title) || TANZANIA_WORDS.test(url);
}

/** Does this link look like it is in Kiswahili (title or address)? */
export function looksKiswahili(title: string, url: string): boolean {
  return KISWAHILI_WORDS.test(title) || KISWAHILI_WORDS.test(url);
}

export interface Rankable {
  host: string;
  title: string;
  url: string;
  kind: "video" | "image" | "page";
}

/**
 * Higher is better. Language fit and videos lead, then preferred providers,
 * then Tanzanian origin.
 */
export function scoreLink(
  c: Rankable,
  suited: Provider[],
  language: "en" | "sw" = "en",
): number {
  const provider = providerForHost(c.host, suited);
  const kiswahili = looksKiswahili(c.title, c.url);
  let score = 0;
  if (provider) score += 40;
  // Tanzanian origin is a bonus, a smaller one for English lessons (English
  // matters more there than where the video was made).
  if (provider?.tanzanian || looksTanzanian(c.host, c.title, c.url)) {
    score += language === "en" ? 15 : 35;
  }
  if (c.kind === "video") score += 30;
  else if (c.kind === "image") score += 5;
  // The language must match the lesson: English lessons should not get
  // Kiswahili material, nor a Kiswahili lesson English material.
  // UK/US curriculum labels (KS2, Year 5) work but are not our curriculum.
  if (UK_LABELS.test(c.title)) score -= 15;
  if (language === "en" && kiswahili) score -= 80;
  if (language === "sw" && kiswahili) score += 30;
  return score;
}

const SECONDARY_WORDS = /\b(form[\s_-]*(one|two|three|four|five|six|[1-6])|secondary school|o-level|a-level)\b/i;

/** Secondary-level material (e.g. "Form One notes") does not belong on a primary plan. */
export function tooAdvanced(title: string, url: string, gradeNum: number): boolean {
  return gradeNum <= 7 && (SECONDARY_WORDS.test(title) || SECONDARY_WORDS.test(url));
}

/** The providers worth a dedicated search for this lesson (at most `max`). */
export function leadProviders(suited: Provider[], max = 3): Provider[] {
  return suited.filter((p) => p.lead).slice(0, max);
}

const DOCUMENT_FILE = /\.(docx?|pdf|pptx?|xlsx?|zip|rtf|odt)$/i;

/** A raw file download (Word, PDF, slides…) is not a lesson page a teacher can open and use. */
export function isDocumentFile(url: string): boolean {
  try {
    return DOCUMENT_FILE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const UK_LABELS = /\b(ks[1-4]|key stage|year [1-9]\b|gcse|a-level|eleven plus)/i;
