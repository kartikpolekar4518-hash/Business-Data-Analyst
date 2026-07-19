# CLAUDE.md

Ponytail (full) governs code style in this repo — minimal diffs, reuse before
writing, no speculative abstractions, terse output. Don't restate its rules
here; if Ponytail is ever off, ask before assuming this project wants heavier
changes.

## Plan before coding

For anything beyond a one-line fix or an already-unambiguous request (new
feature, multi-file change, anything touching auth/data/money paths): use
Plan Mode first — state the approach, get it confirmed, then implement.
