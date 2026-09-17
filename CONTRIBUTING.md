# Contributing

Thanks for looking. Two things worth knowing before you open something.

## The support boundary

**We do not debug your deployment.** Self-hosting is self-service: the compose
file, the README and the code are the support.

- Bugs in *this code* — always welcome, please open an issue.
- "It does not work on my server" — probably not something we can help with.
- Paying customers of the hosted service get email support with a response time.

This is not unfriendliness, it is arithmetic. A small team cannot absorb
unbounded infrastructure support for free and still ship. Stating it plainly up
front is kinder than letting issues go unanswered.

## Scope

This does one thing: URL in, image out. Feature requests that widen that are
usually declined, and it is not personal — a narrow scope is the only reason
this stays maintainable by a very small team.

Things that are in scope: correctness on pages that currently render wrong,
performance, security, reducing operational surprise.

Things that are out of scope for now: video, GPU rendering, proxy rotation,
async job queues, dashboards, teams and seats.

## Reporting a bad capture

The most useful issue in this repo is "this page renders wrong". Include:

1. The exact URL.
2. The full request you made.
3. What you expected versus what you got, ideally both images.

Consider adding the page to `bench/urls.js` with a note on what it breaks.

## Pull requests

- Run `npm run smoke` before opening one.
- Keep the diff focused.
- New capture behaviour needs a bench page that demonstrates it.

## CLA

Outside contributions require a Contributor License Agreement before merge, so
the project keeps the option to relicense later. This is a boring legal
formality, not a claim on your work.
