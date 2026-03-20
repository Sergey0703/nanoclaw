import sqlite3
import datetime

db = sqlite3.connect('/workspace/project/store/messages.db')
today = datetime.date.today().isoformat()

print('Today (' + today + '):')
rows = db.execute(
    'SELECT model, SUM(prompt_tokens), SUM(completion_tokens), SUM(total_tokens), COUNT(*) FROM llm_usage WHERE date=? GROUP BY model ORDER BY 4 DESC',
    (today,)
).fetchall()
if not rows:
    print('  No data yet.')
else:
    for r in rows:
        print('  ' + r[0] + ': ' + str(r[3]) + ' tokens (' + str(r[4]) + ' requests)')

print('')
print('Last 7 days:')
rows = db.execute(
    "SELECT date, SUM(total_tokens), COUNT(*) FROM llm_usage WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC"
).fetchall()
total = sum(r[1] for r in rows) if rows else 0
for r in rows:
    print('  ' + r[0] + ': ' + str(r[1]) + ' tokens (' + str(r[2]) + ' requests)')
print('  Total: ' + str(total) + ' tokens')

db.close()
