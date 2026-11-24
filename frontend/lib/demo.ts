// Scripted & hardcoded demo data for /demo. Nothing here requires the backend or live API keys:
// sources live on the reserved `.example` TLD so no real outlet is quoted.
// Image ELA & noise heatmaps are genuinely computed by backend/app/pipeline/image_forensics.py.
import { CheckResult, ClaimResult, Evidence } from "./api";
import { DEMO_FORENSICS_AI, DEMO_FORENSICS_FLOOD } from "./demoForensics";

type Seed = [domain: string, cls: string, cred: number, rel: number, stance: Evidence["stance"], quote: string, discard?: string];
let nextId = 1;
const evidence = (seeds: Seed[]): Evidence[] => seeds.map(([domain, cls, cred, rel, stance, quote, discard]) => ({
  id: nextId++, url: `https://${domain}/demo`, domain, title: quote.slice(0, 60) || domain, publisher: domain.split(".")[0],
  published_at: "2026-11-23", retrieved_at: "2026-11-24T09:12:00Z", source_type: cls === "reference" ? "wikipedia" : cls === "scholarly" ? "scholarly" : cls === "fact-checker" ? "factcheck" : "web",
  excerpt: quote || "Learn the C, F and B-flat major scales first; then practise lip slurs daily…", stance, quote, rationale: "",
  rerank_score: rel, rerank_method: "cross-encoder:ms-marco-MiniLM-L-6-v2", counted: !discard, discard_reason: discard ?? null, date_note: null,
  nli_label: !discard ? (stance === "supports" ? "entailment" : stance === "refutes" ? "contradiction" : "neutral") : null,
  nli_score: !discard ? 0.91 : null,
  credibility: { score: cred, domain_class: cls, https: true, is_primary: cls === "government" || cls === "wire", recency_days: 1,
    signals: [`domain class: ${cls} (${cred.toFixed(2)})`, "https", "published 1 day ago"] },
}));

export const weightOf = (e: Evidence) => +(e.credibility.score * (0.5 + 0.5 * e.rerank_score)).toFixed(3);

export function score(ev: Evidence[], sensitive: boolean) {
  const side = (s: Evidence["stance"]) => ev.filter((e) => e.counted && e.stance === s);
  const S = +side("supports").reduce((a, e) => a + weightOf(e), 0).toFixed(2);
  const R = +side("refutes").reduce((a, e) => a + weightOf(e), 0).toFixed(2);
  const p = +(S / Math.max(S + R, 1e-6)).toFixed(3);
  const lead = side(p >= 0.5 ? "supports" : "refutes").length;
  const need = sensitive ? 3 : 2;
  const strength = Math.min(0.95, +(Math.abs(p - 0.5) * 2 * (1 - Math.exp(-(S + R) / 2.5)) * (sensitive ? 0.85 : 1)).toFixed(2));
  const verdict = S + R < 0.9 || lead < need ? "Unverifiable"
    : p >= 0.85 ? "True" : p >= 0.65 ? "Mostly True" : p > 0.35 ? "Mixed/Misleading Context" : p > 0.15 ? "Mostly False" : "False";
  return { S, R, p, strength, verdict, lead, need };
}

interface ClaimSpec { text: string; sensitivity?: string; queries: { supporting: string[]; disconfirming: string[] }; seeds: Seed[]; howTo: string[]; factCheck?: string }
function claimResult(c: ClaimSpec): ClaimResult {
  const ev = evidence(c.seeds), sens = (c.sensitivity ?? "none") !== "none", sc = score(ev, sens);
  const side = sc.p >= 0.5 ? "support" : "refute";
  return {
    claim: { text: c.text, kind: "factual", checkworthy: true, topic_sensitivity: c.sensitivity ?? "none", claim_date: null, language: "en" },
    verdict: sc.verdict, confidence: sc.strength, confidence_calibrated: false,
    confidence_explanation: `${sc.lead} independent domains ${side} the claim (needs ≥ ${sc.need}${sens ? ", stricter for sensitive topics" : ""}). Supports ${sc.S} vs refutes ${sc.R}, p = ${sc.p}. This strength score is a heuristic and is not calibrated.`,
    queries: [...c.queries.supporting, ...c.queries.disconfirming],
    fact_checks: c.factCheck ? [{ publisher: "factcheck-desk.example", url: "https://factcheck-desk.example/demo", title: c.text, rating: c.factCheck, review_date: "2026-11-24", claimant: "Viral social posts" }] : [],
    evidence: ev, unknowns: ["Evidence reflects coverage up to the retrieval time; a later event would need a new check."],
    how_to_verify: c.howTo, weights: { supports: sc.S, refutes: sc.R },
  };
}

const LIMITS = [
  "Hardcoded interactive demo: web sources are sample data on the .example domain; ELA/noise heatmaps are genuinely computed by VeriFact's forensics engine.",
  "Image forensics (EXIF, ELA, noise residuals, FFT spectra) are probabilistic indicators, never standalone proof.",
  "Confidence is an uncalibrated evidence-strength heuristic.",
];

// ============================================================
// HARDCODED MULTIMODAL DEMO 1: AI / Doctored Image + Viral Hoax Claim
// ============================================================
export const IMG_AI_CLAIM = "BREAKING: The Eiffel Tower in Paris is engulfed in flames right now after a massive explosion.";
const EIFFEL_FIRE_SPEC: ClaimSpec = {
  text: "The Eiffel Tower in Paris is engulfed in flames after an explosion.",
  sensitivity: "violence",
  factCheck: "False · Doctored / AI-Generated Image",
  queries: {
    supporting: ["Eiffel Tower fire explosion today", "Eiffel Tower burning Paris breaking news"],
    disconfirming: ["Eiffel Tower fire hoax fact check", "Paris fire department Eiffel Tower statement", "Eiffel Tower live webcam status"],
  },
  howTo: [
    "Inspect the ELA heatmap: notice the high-error pocket concentrated strictly around the smoke and flame plume.",
    "Check official Paris Fire Brigade (BSPP) and Eiffel Tower operator announcements.",
    "Verify via two or more international wire services before sharing breaking disaster photos.",
  ],
  seeds: [
    ["factcheck-desk.example", "fact-checker", 0.85, 0.95, "refutes", "Viral images showing the Eiffel Tower engulfed in flames are fabricated; the landmark is open and operating normally."],
    ["paris-fire-dept.example", "government", 0.88, 0.91, "refutes", "No fire or explosion has occurred at the Eiffel Tower. Emergency crews have received no incident call for the Champ de Mars."],
    ["globalwire.example", "wire", 0.85, 0.87, "refutes", "Live feeds from Paris show the Eiffel Tower standing intact under clear skies, debunking viral social-media rumours of a blaze."],
    ["euro-herald.example", "news", 0.55, 0.87, "refutes", "Live feeds from Paris show the Eiffel Tower standing intact under clear skies, debunking viral social-media rumours of a blaze.", "Near-duplicate of globalwire.example (syndicated wire copy; counted once)"],
    ["paris-heritage.example", "government", 0.85, 0.76, "refutes", "The Eiffel Tower welcomed visitors on its normal schedule today with no safety evacuations reported."],
    ["socialmirror.example", "user-generated", 0.25, 0.82, "supports", "OMG Eiffel Tower on fire right now!! Explosion heard across Paris, share fast!!"],
    ["rumor-mill.example", "unknown", 0.4, 0.61, "supports", "Witnesses confirmed the top deck collapsed within minutes.", "Stance discarded: cited quote not found verbatim in the passage"],
  ],
};
const eiffelFireClaim = claimResult(EIFFEL_FIRE_SPEC);

export const DEMO_IMAGE_AI_RESULT: CheckResult = {
  id: "demo-img-ai",
  status: "done",
  overall_verdict: "AI-Generated",
  input: {
    kind: "image+claim",
    text: IMG_AI_CLAIM,
    url: null,
    title: null,
    domain: null,
    published_at: null,
    has_image: true,
    image_name: "eiffel-fire-fake.jpg",
    image_mime: "image/jpeg",
    image_url: "/demo/eiffel-fire-fake.jpg",
  },
  multimodal_summary: {
    image_verdict: "Likely AI-Generated",
    image_is_real: false,
    claim_verdict: "False",
    claim_is_real: false,
    image_claim_match: "Consistent",
    summary: "Image assessment: Likely AI-Generated / Manipulated (Stable Diffusion & Photoshop metadata detected; ELA heatmap highlights localized post-compression alteration around the flame plume; vision analysis flags lighting inconsistencies). Image–Claim match: The image depicts the claimed scene, but the media itself is synthetic/doctored. Claim verification: False across 4 independent official & fact-checking domains.",
  },
  image_analysis: {
    image_verdict: "Likely AI-Generated",
    image_is_real: false,
    image_confidence: 0.92,
    forensics_source: "ml-service",
    ...DEMO_FORENSICS_AI,
    visual: {
      scene_description: "A daylight view of the Eiffel Tower against a clear blue sky, with an orange fire glow and dark billowing smoke overlaid across the middle lattice section.",
      visible_text: "",
      visual_entities: ["Eiffel Tower", "Paris"],
      authenticity_assessment: "likely_ai_generated",
      authenticity_rationale: "The smoke and flame plume exhibits soft, synthetic blending and inconsistent directional lighting against the crisp midday shadows on the iron lattice, corroborated by Stable Diffusion & Photoshop traces in file metadata and a localized ELA anomaly.",
      visual_anomalies: [
        "Flame glow does not cast consistent orange illumination onto surrounding steel girders",
        "Smoke edges show unnatural Gaussian diffusion against sharp background tower lattice",
        "Elevated localized JPEG Error Level Analysis (ELA) signal centered directly on the fire plume",
      ],
      watermarks_or_badges: [],
      claim_alignment: "consistent",
      alignment_explanation: "Visually, the image depicts the Eiffel Tower appearing to burn as claimed — however, forensic metadata, ELA heatmaps, and web fact-checks show the fire was synthetically added.",
      image_search_queries: ["Eiffel Tower fire viral photo fact check", "Eiffel Tower smoke fake image AI generated"],
      embedded_claims: [],
    },
    provenance_finding: "debunked_ai",
    provenance_summary: "Fact-checkers and wire services confirmed viral Eiffel Tower fire photos are synthetically generated/edited hoaxes; the monument is intact.",
    provenance_matches: [
      { url: "https://factcheck-desk.example/eiffel-fire-hoax", domain: "factcheck-desk.example", title: "Fact Check: Viral Eiffel Tower Fire Photo Is Digitally Fabricated", snippet: "No fire occurred at the Eiffel Tower; the widely shared image carries generative editing artifacts and contradicts live Paris webcams.", source_type: "factcheck", credibility_score: 0.85 },
      { url: "https://paris-fire-dept.example/press-notice", domain: "paris-fire-dept.example", title: "Paris Fire Brigade: No Incident Reported at Eiffel Tower", snippet: "Official statement confirming zero fire or explosion calls at the Champ de Mars.", source_type: "web", credibility_score: 0.88 },
      { url: "https://globalwire.example/paris-eiffel-hoax", domain: "globalwire.example", title: "Paris Landmark Operates Normally Amid Viral Fire Hoax", snippet: "Wire photographers on site verified the tower remained open with clear skies.", source_type: "news", credibility_score: 0.85 },
    ],
  },
  claims: [eiffelFireClaim],
  errors: [],
  limitations: LIMITS,
  llm_usage: { calls: 7, input_tokens: 11420, output_tokens: 1680 },
};

// ============================================================
// HARDCODED MULTIMODAL DEMO 2: Real Photo Used Out of Context
// ============================================================
export const IMG_OOC_CLAIM = "BREAKING: Flash flood submerges downtown Paris streets this morning after record storm.";
const FLOOD_SPEC: ClaimSpec = {
  text: "Flash floods submerged downtown Paris streets this morning after a record storm.",
  factCheck: "False · Real Photo Used Out of Context",
  queries: {
    supporting: ["Paris flash flood downtown today", "Paris record storm street flooding"],
    disconfirming: ["Paris flood viral photo fact check", "Cartridge World flood street original photo UK"],
  },
  howTo: [
    "Read background signage in the photo: 'Cartridge World' and English 'SALE' signs indicate an English-speaking town, not Paris.",
    "Inspect EXIF capture date (2021-07-15) and verify with local meteorological agencies.",
  ],
  seeds: [
    ["factcheck-desk.example", "fact-checker", 0.85, 0.94, "refutes", "The viral photo claimed to show Paris flooding today actually depicts an older urban flood in an English town, identifiable by the Cartridge World storefront."],
    ["meteo-agency.example", "government", 0.85, 0.89, "refutes", "No flash flood warnings or record rainfall events were recorded in central Paris today; Seine water levels remain seasonal."],
    ["globalwire.example", "wire", 0.85, 0.84, "refutes", "Commuters and transport authorities in Paris reported dry roads and normal metro service throughout the morning."],
    ["socialmirror.example", "user-generated", 0.25, 0.72, "supports", "Pray for Paris! Downtown completely underwater this morning!"],
  ],
};
const floodClaim = claimResult(FLOOD_SPEC);

export const DEMO_IMAGE_OOC_RESULT: CheckResult = {
  id: "demo-img-ooc",
  status: "done",
  overall_verdict: "False",
  input: {
    kind: "image+claim",
    text: IMG_OOC_CLAIM,
    url: null,
    title: null,
    domain: null,
    published_at: null,
    has_image: true,
    image_name: "flood-2021-real.jpg",
    image_mime: "image/jpeg",
    image_url: "/demo/flood-2021-real.jpg",
  },
  multimodal_summary: {
    image_verdict: "Likely Authentic",
    image_is_real: true,
    claim_verdict: "False",
    claim_is_real: false,
    image_claim_match: "Mismatched / Out of Context",
    summary: "Image assessment: Likely Authentic (valid Canon EOS R6 EXIF dated 2021-07-15; uniform low ELA error with no manipulation traces). Image–Claim match: Mismatched / Out of Context — visible English shop signs ('Cartridge World', 'SALE') and 2021 metadata contradict the claim of Paris today. Claim verification: False.",
  },
  image_analysis: {
    image_verdict: "Likely Authentic",
    image_is_real: true,
    image_confidence: 0.82,
    forensics_source: "ml-service",
    ...DEMO_FORENSICS_FLOOD,
    visual: {
      scene_description: "A flooded commercial street with murky water covering the road and lower storefronts, a pedestrian wading past a yellow 'Cartridge World' shopfront and adjacent 'SALE' window signs.",
      visible_text: "Cartridge World · Refill · 60% · SALE · Roadrunner Sports",
      visual_entities: ["Cartridge World", "Roadrunner Sports", "Flooded UK high street"],
      authenticity_assessment: "likely_authentic",
      authenticity_rationale: "Natural daylight reflections on muddy water, consistent perspective, clean Canon EOS R6 camera EXIF, and uniformly low ELA recompression error indicate an unaltered real photograph.",
      visual_anomalies: [],
      watermarks_or_badges: [],
      claim_alignment: "mismatched_context",
      alignment_explanation: "Although the photograph is authentic, English storefront signage ('Cartridge World', 'SALE', 'Refill') and the 2021 EXIF timestamp contradict the claim that this shows downtown Paris today.",
      image_search_queries: ["Cartridge World flooded street original photo", "Paris flood viral photo out of context fact check"],
      embedded_claims: [],
    },
    provenance_finding: "debunked_out_of_context",
    provenance_summary: "Fact-checkers matched the storefronts and archival flood coverage, confirming this real photo was taken years earlier in the UK and reused out of context.",
    provenance_matches: [
      { url: "https://factcheck-desk.example/paris-flood-old-photo", domain: "factcheck-desk.example", title: "Old UK Urban Flood Photo Misleadingly Shared as 'Paris Today'", snippet: "Visible 'Cartridge World' and English 'SALE' signage confirms the image is an older UK flood photo, not Paris.", source_type: "factcheck", credibility_score: 0.85 },
      { url: "https://meteo-agency.example/paris-bulletin", domain: "meteo-agency.example", title: "Paris Regional Weather Bulletin: Normal Conditions", snippet: "No flash flood alerts issued for Île-de-France today.", source_type: "web", credibility_score: 0.85 },
    ],
  },
  claims: [floodClaim],
  errors: [],
  limitations: LIMITS,
  llm_usage: { calls: 6, input_tokens: 9950, output_tokens: 1410 },
};

// ============================================================
// EXISTING TEXT DEMOS (kept intact)
// ============================================================
export const DEMO_CLAIM = "Donald Trump is dead";
export const QUERIES = {
  supporting: ["Donald Trump dead", "Donald Trump death announced", "Trump died news"],
  disconfirming: ["Trump death hoax fact check", "Trump public appearance this week", "Trump alive latest"],
};
const TRUMP: ClaimSpec = {
  text: DEMO_CLAIM, queries: QUERIES, factCheck: "False",
  howTo: ["Look for a statement from family or an official spokesperson.", "Check two or more major wire services for the same report.", "Be wary of 'share before they delete this' framing: a common hoax pattern."],
  seeds: [
    ["factcheck-desk.example", "fact-checker", 0.85, 0.92, "refutes", "Viral posts claiming Donald Trump has died are false; he spoke at a public event on Thursday evening."],
    ["globalwire.example", "wire", 0.85, 0.88, "refutes", "Trump appeared in person at the rally and addressed supporters for about 40 minutes."],
    ["metro-herald.example", "news", 0.55, 0.88, "refutes", "Trump appeared in person at the rally and addressed supporters for about 40 minutes.", "Syndicated copy of globalwire.example (same story, counted once)"],
    ["officialpress.example", "government", 0.85, 0.64, "refutes", "The published schedule lists Mr. Trump at two events this week, both of which went ahead as planned."],
    ["encyclopedia.example", "reference", 0.6, 0.71, "refutes", "No date of death is recorded; the article was last updated with his appearance this week."],
    ["citytribune.example", "news", 0.55, 0.8, "refutes", "Trump took questions from reporters outside the venue on Friday morning."],
    ["socialmirror.example", "user-generated", 0.25, 0.77, "supports", "RIP Donald Trump, breaking news, he is dead, share before they delete this"],
    ["dailysatire.example", "satire", 0.05, 0.69, "supports", "Nation shocked as Trump declared dead, then demands a recount.", "Satire outlet: never counted as evidence"],
    ["truthnow-blog.example", "unknown", 0.4, 0.58, "supports", "Insiders confirm the death was hidden for days.", "Stance quote not found verbatim in the passage: judgement discarded"],
    ["brasswind-lessons.example", "unknown", 0.4, 0.08, "neutral", "", "Relevance 0.08 is below the 0.15 cut-off"],
  ],
};
const trumpResult = claimResult(TRUMP);
export const DEMO_EVIDENCE = trumpResult.evidence;
export const { S, R, p: P, strength: STRENGTH } = score(DEMO_EVIDENCE, false);
export const DEMO_RESULT: CheckResult = {
  id: "demo", status: "done", overall_verdict: trumpResult.verdict, errors: [], claims: [trumpResult], limitations: LIMITS,
  input: { kind: "text", text: DEMO_CLAIM, url: null, title: null, domain: null, published_at: null },
  llm_usage: { calls: 6, input_tokens: 9840, output_tokens: 1310 },
};

export const MULTI_POST = "BREAKING: Donald Trump is dead. Meanwhile the Eiffel Tower was completed in 1889, and drinking bleach cures COVID-19. Honestly he was the best president ever.";
const EIFFEL: ClaimSpec = {
  text: "The Eiffel Tower was completed in 1889",
  queries: { supporting: ["Eiffel Tower completed 1889", "Eiffel Tower construction finished"], disconfirming: ["Eiffel Tower completion date disputed", "Eiffel Tower opened 1887"] },
  howTo: ["Check the operator's official history page.", "Compare with an encyclopedia entry and a dated primary source."],
  seeds: [
    ["paris-heritage.example", "government", 0.85, 0.86, "supports", "The tower was completed in March 1889 in time for the Exposition Universelle."],
    ["encyclopedia.example", "reference", 0.6, 0.9, "supports", "Construction began in January 1887 and was completed on 31 March 1889."],
    ["history-journal.example", "scholarly", 0.85, 0.78, "supports", "Gustave Eiffel's company finished the structure in 1889, after just over two years of work."],
    ["globalwire.example", "wire", 0.85, 0.55, "supports", "The landmark, completed in 1889, welcomes about six million visitors a year."],
    ["trivia-forum.example", "user-generated", 0.25, 0.6, "refutes", "pretty sure it was finished in 1887 actually"],
    ["eiffel-souvenirs.example", "unknown", 0.4, 0.31, "neutral", "Buy miniature Eiffel Tower models, shipped worldwide."],
  ],
};
const BLEACH: ClaimSpec = {
  text: "Drinking bleach cures COVID-19", sensitivity: "health", factCheck: "False",
  queries: { supporting: ["bleach cures COVID-19", "chlorine dioxide COVID treatment"], disconfirming: ["drinking bleach dangers health agency", "bleach COVID cure fact check", "chlorine dioxide poisoning cases"] },
  howTo: ["Check your national health agency's guidance.", "Look for peer-reviewed trials, not testimonials.", "Call poison control if anyone has ingested bleach."],
  seeds: [
    ["intl-health-org.example", "intergovernmental", 0.88, 0.9, "refutes", "Drinking bleach or other disinfectants does not prevent or treat COVID-19 and can be extremely dangerous."],
    ["health-agency.example", "government", 0.85, 0.88, "refutes", "Ingesting chlorine dioxide products can cause severe vomiting, acute liver failure and life-threatening low blood pressure."],
    ["medjournal.example", "scholarly", 0.85, 0.7, "refutes", "No clinical trial has shown any benefit of chlorine dioxide against SARS-CoV-2 in humans."],
    ["poison-control.example", "government", 0.85, 0.74, "refutes", "Calls about disinfectant ingestion rose sharply after false cure claims spread online."],
    ["wellness-forum.example", "user-generated", 0.25, 0.8, "supports", "my uncle drank the MMS solution and his covid cleared in two days"],
    ["miracle-cure-shop.example", "unknown", 0.4, 0.66, "supports", "Clinically proven to eliminate the virus in 24 hours.", "Stance quote not found verbatim in the passage: judgement discarded"],
  ],
};
const multiClaims = [claimResult(TRUMP), claimResult(EIFFEL), claimResult(BLEACH)];
export const MULTI_LANES = [TRUMP, EIFFEL, BLEACH].map((c, i) => ({ text: c.text, sensitivity: c.sensitivity ?? "none", queries: c.queries, result: multiClaims[i] }));
export const MULTI_OPINION = "Honestly he was the best president ever";
export const MULTI_RESULT: CheckResult = {
  id: "demo-multi", status: "done", overall_verdict: "Mixed/Misleading Context", errors: [], limitations: LIMITS,
  input: { kind: "text", text: MULTI_POST, url: null, title: null, domain: null, published_at: null },
  claims: [...multiClaims, {
    claim: { text: MULTI_OPINION, kind: "opinion", checkworthy: false, topic_sensitivity: "none", claim_date: null, language: "en" },
    verdict: "Not Checkworthy", confidence: null, confidence_calibrated: false, confidence_explanation: "Labelled as opinion; not a verifiable factual claim.",
    queries: [], fact_checks: [], evidence: [], unknowns: [], how_to_verify: [], weights: {},
  }],
  llm_usage: { calls: 14, input_tokens: 27410, output_tokens: 3920 },
};
