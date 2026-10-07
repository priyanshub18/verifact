export const metadata = { title: "How VeriFact works" };
const steps = [
  ["Extract", "An LLM splits the input into atomic, self-contained claims and labels opinions and predictions, which are not checked. Each claim must quote a span of your input."],
  ["Search both sides", "For each claim it writes confirming and deliberately disconfirming queries, then queries Google’s ClaimReview index, web/news search, Wikipedia and scholarly sources (PubMed, Crossref)."],
  ["Read & rank", "Pages are fetched through an SSRF-safe fetcher, cut into passages and ranked against the claim. Syndicated copies of one story are collapsed so a single wire report is not counted ten times."],
  ["Judge stance", "An LLM reads only the retrieved passage and returns supports / refutes / neutral plus a verbatim quote. If the quote does not appear in the passage, the judgement is thrown away."],
  ["Weigh & decide", "A deterministic rule weighs each source by a transparent credibility prior and relevance. It needs several independent domains to agree (more for health, elections, violence) or the answer is Unverifiable. Conflicts are reported as Disputed."],
];
export default function Page() {
  return (<article className="max-w-2xl pt-12"><p className="label">Method</p><h1 className="font-display text-5xl">How VeriFact works</h1>
    <p className="mt-4 text-dim">The model never answers from memory. It only reads text we retrieved, and every verdict links to that text.</p>
    <ol className="mt-8 space-y-6">{steps.map(([t, d], i) => <li key={t}><h2 className="font-display text-2xl"><span className="font-mono text-signal">{i + 1}.</span> {t}</h2><p className="text-dim">{d}</p></li>)}</ol></article>);
}
