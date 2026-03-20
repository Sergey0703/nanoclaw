---
name: groq-usage
description: Show Groq API token usage statistics for today, yesterday, or last 7 days. Use when user asks about token usage, API costs, or how many tokens were spent.
---

# Groq Token Usage

Query the local SQLite database for token usage statistics.

## Today's usage
```bash
sqlite3 /workspace/project/store/messages.db "
  SELECT
    model,
    SUM(prompt_tokens) as prompt,
    SUM(completion_tokens) as completion,
    SUM(total_tokens) as total,
    COUNT(*) as requests
  FROM groq_usage
  WHERE date = strftime('%Y-%m-%d', 'now')
  GROUP BY model
  ORDER BY total DESC;
"
```

## Last 7 days summary
```bash
sqlite3 /workspace/project/store/messages.db "
  SELECT
    date,
    SUM(total_tokens) as total_tokens,
    COUNT(*) as requests
  FROM groq_usage
  WHERE date >= strftime('%Y-%m-%d', 'now', '-7 days')
  GROUP BY date
  ORDER BY date DESC;
"
```

## All-time total
```bash
sqlite3 /workspace/project/store/messages.db "
  SELECT
    SUM(total_tokens) as total_tokens,
    COUNT(*) as requests,
    MIN(date) as since
  FROM groq_usage;
"
```

After running, format results nicely and present to user. Groq free tier limit is 300,000 tokens/minute. There is no daily limit — only per-minute rate limits.
