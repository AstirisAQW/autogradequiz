import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config import get_settings

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    settings = get_settings()
    settings.ensure_directories()
    connection = sqlite3.connect(settings.autograde_db_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
    finally:
        connection.close()


def init_db() -> None:
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with get_connection() as connection:
        connection.executescript(schema_sql)
        connection.commit()
