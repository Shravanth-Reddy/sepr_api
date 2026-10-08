import config

conn = config.get_db_connection()
tables = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

for t in tables:
    if t == "sqlite_sequence":
        continue
    cols = [c["name"] for c in conn.execute(f"PRAGMA table_info({t})").fetchall()]
    count = conn.execute(f"SELECT count(*) as c FROM {t}").fetchone()["c"]
    print(f"=== {t} ({count} rows) ===")
    print("Columns:", cols)
    rows = conn.execute(f"SELECT * FROM {t} LIMIT 2").fetchall()
    for r in rows:
        print("  Sample:", dict(r))
    print()

conn.close()
