# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/septadoni12-eng/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/septadoni12-eng/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121): a drop-in replacement for csv-reader 1.0.0 that returns its exact answer for every input — same columns, same rows, same errors, in the same order — and returns it sooner.

## Why it is faster

csv-reader 1.0.0 builds every field one character at a time. This reader remembers where each run of plain characters starts and slices it out whole when the run ends, so ordinary text is copied once per field instead of once per character. Only the characters that change meaning along the way — a dropped stray CR, a doubled quote, a CR inside quotes read as LF — break a run, and only then is a field assembled from parts. The broken-row policy itself is unchanged, down to the last error: stray CRs are dropped and reported, junk after a closing quote is appended and reported, a quote that never closes becomes a literal character and its text is read again as an unquoted field, and short rows are padded and long rows cut to the first record's width, each reported as it ends.

## Layout

- `main.ts` — the harness driver: reads the cases from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`. V8's incremental marking is switched off before `solve.js` is imported, as the house baseline's driver does.
- `solve.js` — the reader itself: a dependency-free ES module exporting `run(input)`.

## Licence

MIT — see `LICENSE`.
