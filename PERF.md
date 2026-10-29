# Performance notes

## Long timeline input latency

Measured with 407 real local posts at 1440×1000 using `.taste-skill/input-perf.mjs`.
The test types into the composer, sends 16 real Backspace key events through CDP, and waits for two animation frames after each deletion.

| Version | Median | p95 |
| --- | ---: | ---: |
| Render every post on each input | 860.84 ms | 903.83 ms |
| Limit the initial timeline to 40 posts | 69.27 ms | 94.72 ms |
| Add `v-memo` to unchanged post cards | 28.23 ms | 35.10 ms |
| Load all 407 posts with `v-memo` enabled | 48.87 ms | 56.36 ms |
| Latest rerun after weekly/monthly reports | 14.04 ms | 22.99 ms |

The regression budget is a p95 below 120 ms. The full timeline remains available through the “show more” control, while filtering and exporting continue to operate on the complete filtered result.
