# screenshotline-mcp

An MCP server that gives an agent two tools:

- **`screenshot`** — capture a web page as an image, for when the layout is the answer.
- **`read_page`** — render the page, then return its text as clean Markdown, for when the text is.

Pages are fully rendered first: JavaScript executed, consent banners removed,
lazy images loaded, ads, chat widgets and newsletter popups stripped. So
`read_page` works on sites that return nothing useful to a plain HTTP fetch.
A capture that comes back blank is reported as a warning, not narrated as
though it were the page.

## Install

Get a free key at [screenshotline.com/account](https://screenshotline.com/account)
— 500 renders a month, no card. Then, in Claude Code:

```bash
claude mcp add screenshotline -e SCREENSHOTLINE_ACCESS_KEY=sl_live_... -- npx -y screenshotline-mcp
```

Or in any MCP client's JSON config (Claude Desktop, Cursor, and others):

```json
{
  "mcpServers": {
    "screenshotline": {
      "command": "npx",
      "args": ["-y", "screenshotline-mcp"],
      "env": { "SCREENSHOTLINE_ACCESS_KEY": "sl_live_..." }
    }
  }
}
```

## Self-hosted

The renderer is open source. Point the server at your own instance and no key
is needed unless you configured one:

```bash
SCREENSHOTLINE_BASE_URL=http://localhost:3000 npx -y screenshotline-mcp
```

| Variable | Default | |
|---|---|---|
| `SCREENSHOTLINE_ACCESS_KEY` | — | Your API key. Required for the hosted API. |
| `SCREENSHOTLINE_BASE_URL` | `https://api.screenshotline.com` | Any Screenshotline instance. |

This package is only the MCP bridge — one file plus the MCP SDK. It does not
download a browser; the rendering happens on the API it points at.

Docs: [screenshotline.com/docs/extract](https://screenshotline.com/docs/extract) ·
License: AGPL-3.0-or-later
