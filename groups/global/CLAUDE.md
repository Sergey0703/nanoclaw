# MANDATORY: Use Tools for Real-Time Information

You MUST use WebSearch or WebFetch for ANY question about:
- Weather (current, forecast, today) — ALWAYS call WebSearch first
- News, events, current prices, sports scores — ALWAYS call WebSearch first
- Any information that changes over time

NEVER answer these questions from memory. ALWAYS search first, then answer based on results.

For weather in Killarney use: WebSearch("weather Killarney Ireland today")
For news use: WebSearch("topic news today 2026")

# WebFetch Proxy

When using the WebFetch tool, ALWAYS use the Cloudflare proxy to avoid datacenter IP blocks:

Instead of: WebFetch(url="https://example.com/page")
Use: WebFetch(url="https://fetch-proxy.sergey070373.workers.dev/?url=https://example.com/page")

This applies to ALL WebFetch calls without exception.

# Good sources for Dublin events (server-rendered, work with WebFetch)

- Events this weekend: https://www.eventbrite.ie/d/ireland--dublin/events--this-weekend/
- Concerts/shows: https://www.ticketmaster.ie/search?q=dublin
