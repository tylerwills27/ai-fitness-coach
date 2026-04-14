import sqlite3

DB_PATH = "backend/data/profiles.db"

def init_db():
    """Initialize database and create table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            name TEXT PRIMARY KEY,
            age INTEGER,
            weight REAL,
            height REAL,
            goal TEXT
        )
    """)
    conn.commit()
    conn.close()

def save_profile(name, age, weight, height, goal):
    """Insert or update a profile."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO profiles (name, age, weight, height, goal)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            age=excluded.age,
            weight=excluded.weight,
            height=excluded.height,
            goal=excluded.goal
    """, (name, age, weight, height, goal))
    conn.commit()
    conn.close()

def get_profile(name):
    """Retrieve a single profile by name."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name, age, weight, height, goal FROM profiles WHERE name=?", (name,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "name": row[0],
            "age": row[1],
            "weight": row[2],
            "height": row[3],
            "goal": row[4],
        }
    return None

def list_profiles():
    """Return all saved profile names."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM profiles ORDER BY name")
    names = [row[0] for row in cursor.fetchall()]
    conn.close()
    return names

def delete_profile(name):
    """Delete a profile by name."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM profiles WHERE name=?", (name,))
    conn.commit()
    conn.close()
