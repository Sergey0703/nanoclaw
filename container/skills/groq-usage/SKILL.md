---
name: groq-usage
description: Show Groq API token usage statistics for today, yesterday, or last 7 days. Use when user asks about token usage, API costs, or how many tokens were spent.
---

# Groq Token Usage

Query the local SQLite database for token usage statistics using Python (sqlite3 CLI is not available in container).

## Today's usage
```bash
python3 -c "
import sqlite3, datetime
db = sqlite3.connect('/workspace/project/store/messages.db')
today = datetime.date.today().isoformat()
rows = db.execute('''
  SELECT model, SUM(prompt_tokens), SUM(completion_tokens), SUM(total_tokens), COUNT(*)
  FROM groq_usage WHERE date=? GROUP BY model ORDER BY 4 DESC
''', (today,)).fetchall()
if not rows:
    print('No usage data for today yet.')
else:
    for r in rows:
        print(f'Model: {r[0]}')
        print(f'  Prompt: {r[1]:,} | Completion: {r[2]:,} | Total: {r[3]:,} | Requests: {r[4]}')
db.close()
"
```

## Last 7 days
```bash
python3 -c "
import sqlite3
db = sqlite3.connect('/workspace/project/store/messages.db')
rows = db.execute('''
  SELECT date, SUM(total_tokens), COUNT(*)
  FROM groq_usage
  WHERE date >= date('now', '-7 days')
  GROUP BY date ORDER BY date DESC
''').fetchall()
if not rows:
    print('No usage data for last 7 days.')
else:
    total = sum(r[1] for r in rows)
    for r in rows:
        print(f'{r[0]}: {r[1]:,} tokens ({r[2]} requests)')
    print(f'Total: {total:,} tokens')
db.close()
"
```

## All-time total
```bash
python3 -c "
import sqlite3
db = sqlite3.connect('/workspace/project/store/messages.db')
row = db.execute('SELECT SUM(total_tokens), COUNT(*), MIN(date) FROM groq_usage').fetchone()
if row[0]:
    print(f'Total tokens: {row[0]:,}')
    print(f'Total requests: {row[1]:,}')
    print(f'Tracking since: {row[2]}')
else:
    print('No usage data yet.')
db.close()
"
```

After running the queries, format the results nicely for the user. Note: Groq free tier has no daily token limit — only 300,000 tokens/minute rate limit.
