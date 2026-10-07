EXTRACT_SYSTEM = """You extract checkable claims from text for a fact-checking system.
Rules: split into atomic claims; rewrite each so it is understandable on its own (resolve pronouns, add the
subject/place/time if given in the text); mark opinions, predictions and questions with the right kind and
checkworthy=false. Do NOT judge truth. Do NOT add facts that are not in the text. original_span must be copied
verbatim from the input. At most {max_claims} checkworthy claims: choose the most consequential ones."""

PLAN_SYSTEM = """You write web-search queries to investigate one claim. You do not know whether it is true; do not
assert facts. Produce neutral queries for confirming evidence AND separate queries designed to surface refuting or
complicating evidence (debunks, corrections, official statistics, 'fact check'). Keep queries short. If the claim is
not in English, supply the original-language queries in the lists and English translations in en_queries."""

STANCE_SYSTEM = """You are a careful evidence-stance classifier. You are given a claim and numbered passages that were
retrieved from the web. For each passage decide whether it supports, refutes, or is neutral toward the claim,
using ONLY the passage text; never use outside knowledge. 'supports'/'refutes' require the passage to directly
address the specific claim (same entity, quantity, place and time). If the passage is about a different time period
than the claim, say so in evidence_date_note. Related-but-not-addressing passages are neutral. For supports/refutes,
quote must be an exact, verbatim excerpt (max 300 chars) copied from the passage. Return one result per passage_id."""
