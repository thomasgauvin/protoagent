# Web Fetch

`webfetch` is ProtoAgent's built-in tool for reading public web content from inside the agent loop.

It is useful for docs, changelogs, API references, release notes, and other text-heavy pages the model needs to inspect during a task.

## What it returns

The tool returns an object with three top-level fields:

- `output` — fetched content in the requested format
- `title` — a simple label built from the URL and response content type
- `metadata` — fetch details such as content type, charset, timing, and lengths

Inside the generic tool dispatcher, this object is returned to the model as a JSON string.

## Formats

### `text`

Returns plain text. If the response is HTML, ProtoAgent extracts readable text first.

### `markdown`

If the response is HTML, ProtoAgent converts it to Markdown with Turndown. If the response is already plain text or another text format, ProtoAgent wraps it in a fenced code block.

### `html`

Returns the raw response body.

## Validation and limits

Current rules:

- URL must start with `http://` or `https://`
- URL length must be 4096 characters or less
- default timeout is 30 seconds
- maximum timeout is 120 seconds
- redirect limit is 10
- maximum response size is 5 MB
- maximum returned output is 2 MB
- only text-based MIME types are accepted

Accepted MIME types include `text/*`, JSON, XML, RSS/Atom, form-encoded payloads, JavaScript, and TypeScript.

Binary responses such as images and archives are rejected.

## Behavior notes

- redirects are followed manually so ProtoAgent can enforce the redirect cap
- charset is derived from the response `Content-Type` header when possible
- HTML entity decoding is applied for `text` and `markdown`
- raw `html` output is returned without entity decoding
- oversized output is truncated with a notice instead of failing outright
- requests use browser-like headers and a fixed user-agent string

## Current scope

`webfetch` is intentionally narrow. It does not currently handle browser sessions, cookies, auth flows, JavaScript execution, or built-in web search.
