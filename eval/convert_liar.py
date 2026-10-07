"""Convert the public LIAR dataset TSV (Wang 2017: col0=id, col1=label, col2=statement) to run_claims JSONL.
Download LIAR yourself (e.g. from the authors' release) - this repo ships no dataset rows.
LIAR is 6-way; we collapse: true/mostly-true -> supported, false/pants-fire -> refuted, half-true/barely-true dropped
(ambiguous under a 3-way scheme). Usage: python convert_liar.py test.tsv > liar_test.jsonl"""
import json
import sys

MAP = {"true": "supported", "mostly-true": "supported", "false": "refuted", "pants-fire": "refuted"}


def convert(lines):
    for line in lines:
        cols = line.rstrip("\n").split("\t")
        if len(cols) >= 3 and cols[1] in MAP:
            yield {"id": cols[0], "claim": cols[2], "label": MAP[cols[1]]}


if __name__ == "__main__":
    for row in convert(open(sys.argv[1], encoding="utf-8")):
        print(json.dumps(row, ensure_ascii=False))
