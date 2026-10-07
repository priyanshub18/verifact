export const metadata = { title: "Known limitations" };
const items = [
  "Confidence is an evidence-strength heuristic and is labelled uncalibrated until it is fitted on a held-out benchmark. It is not a probability.",
  "Source credibility is a rule-based prior from small public lists (wire services, IFCN fact-checkers, government and academic domains, known satire). It is not a rating of any outlet’s accuracy, and domain age (WHOIS) is not implemented yet.",
  "Stance labels come from an LLM reading short passages. A verbatim-quote check catches fabricated quotes, not misreadings.",
  "Ranking is lexical (BM25) until the ML service is configured. Evidence retrieval is weaker for non-English claims.",
  "Image, video and audio forensics are not yet implemented in this build. When they ship, each signal is a probabilistic indicator, never proof.",
  "Fresh events may have little coverage. “Unverifiable” means the retrieved evidence was insufficient, not that a claim is false.",
  "Web search results depend on the configured search provider and can skew toward certain outlets; the sources and their lean are shown so you can judge.",
];
export default function Page() {
  return (<article className="max-w-2xl pt-12"><p className="label">Honesty</p><h1 className="font-display text-5xl">Known limitations</h1>
    <ul className="mt-8 list-inside list-disc space-y-3 text-dim">{items.map((i) => <li key={i}>{i}</li>)}</ul></article>);
}
