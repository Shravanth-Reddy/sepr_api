"""
Configuration and environment setup for Signal Agent.
"""
import os
import sqlite3
from pathlib import Path
from dotenv import load_dotenv

# Base project paths
BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Load environment variables
ENV_FILE = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_FILE)

# API Keys & Settings
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

DEFAULT_SEARCH_QUERY = os.getenv(
    "DEFAULT_SEARCH_QUERY", 
    "Port Klang port disruption OR delay OR strike OR weather"
).strip()
DEFAULT_DELAY_DAYS = int(os.getenv("DEFAULT_DELAY_DAYS", "7"))
SERPAPI_TIMEOUT_SECONDS = float(os.getenv("SERPAPI_TIMEOUT_SECONDS", "15"))

# Reference date for the demo scenario
REFERENCE_DATE = "2026-10-03"

# Database & Cache paths
DB_PATH = BASE_DIR / "mock_erp.db"
CACHE_FILE = CACHE_DIR / "serp_cache.json"

def get_db_connection() -> sqlite3.Connection:
    """Returns a SQLite connection to mock_erp.db with Row factory enabled."""
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Mock ERP database not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn
