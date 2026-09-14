---
name: A page captures wrong
about: A screenshot is blank, half-rendered, or missing content
title: 'Capture: '
labels: capture
---

**The URL**


**What the capture looks like vs the real page**
<!-- Attach both if you can. A screenshot of the screenshot is genuinely useful here. -->


**The request you made**
```
GET /take?url=...
```

**Response headers** — these narrow it down faster than anything else:
```
X-Render-Ms:
X-Blank-Suspected:
X-Text-Length:
X-Wait-Fallback:
X-Upstream-Status:
```

**Have you tried the 4-way isolation?** It usually settles blocking vs timing
in one command — run the page with both blocks on, ads off, cookies off, and
neither. If the sizes differ it is a blocking problem; if they are all the same
and small it is a render-timing problem.

| | bytes |
| --- | --- |
| both on | |
| ads off | |
| cookies off | |
| neither | |
