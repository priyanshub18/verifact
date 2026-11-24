export const metadata = { title: "How VeriFact works" };
const steps = [
  ["Inspect the image (Forensics)", "Uploaded images are validated by magic bytes and inspected for EXIF camera metadata, C2PA Content Credentials, AI-generator & editor traces, Error Level Analysis (ELA), median noise residuals, and 2D FFT spectral cues."],
  ["Check visual content & claim match", "A vision model describes what is visibly depicted, transcribes visible text (OCR), flags observable AI or editing artifacts, and checks whether the image actually matches or contradicts your claim."],
  ["Trace image provenance", "VeriFact searches the web and fact-checks using visual descriptors, visible text, and optional reverse image search to catch recycled, out-of-context, or previously debunked photos."],
  ["Extract & search claim evidence", "Your claim (and any claims printed inside the image) is split into atomic factual claims. Confirming and deliberately disconfirming queries run across web search, GDELT news, Wikipedia, PubMed, Crossref, and existing fact-checks."],
  ["Read, rank, judge & fuse", "Pages are fetched safely, deduplicated across wire copies, and stance-checked with mandatory verbatim quotes (plus optional DeBERTa NLI cross-check). Deterministic rules weigh domain credibility and fuse Image Authenticity + Image–Claim Match + Claim Factuality into the final verdict."],
];
export default function Page() {
  return (<article className="max-w-2xl pt-12"><p className="label">Method</p><h1 className="font-display text-5xl">How VeriFact works</h1>
    <p className="mt-4 text-dim">VeriFact checks both halves of visual misinformation: whether the image itself is authentic, whether it matches the caption/claim, and whether the claim is backed by credible evidence.</p>
    <ol className="mt-8 space-y-6">{steps.map(([t, d], i) => <li key={t}><h2 className="font-display text-2xl"><span className="font-mono text-signal">{i + 1}.</span> {t}</h2><p className="text-dim">{d}</p></li>)}</ol></article>);
}
