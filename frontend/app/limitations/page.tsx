export const metadata = { title: "Known limitations" };
const items = [
  "Image forensics (EXIF, ELA, noise residuals, FFT spectra) and vision-model inspection are probabilistic indicators, never 100% proof. Social media re-uploads strip EXIF metadata and recompress JPEGs, masking both authentic camera history and subtle edits.",
  "Without a Google Vision or SerpAPI key, image provenance uses visual-context web search rather than pixel-exact reverse image search.",
  "Confidence is an evidence-strength heuristic and is labelled uncalibrated until it is fitted on a held-out benchmark. It is not a probability.",
  "Source credibility is a rule-based prior from small public lists (wire services, IFCN fact-checkers, government and academic domains, known satire). It is not a rating of any outlet’s accuracy, and domain age (WHOIS) is not implemented yet.",
  "Stance labels come from an LLM reading short passages. A verbatim-quote check catches fabricated quotes, not misreadings; enable ml-service for a second DeBERTa NLI cross-check.",
  "Video and audio verification are not yet implemented in this build.",
  "Fresh events may have little coverage. “Unverifiable” means the retrieved evidence was insufficient, not that a claim is false.",
];
export default function Page() {
  return (<article className="max-w-2xl pt-12"><p className="label">Honesty</p><h1 className="font-display text-5xl">Known limitations</h1>
    <ul className="mt-8 list-inside list-disc space-y-3 text-dim">{items.map((i) => <li key={i}>{i}</li>)}</ul></article>);
}
