from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def default_data_dir() -> str:
    return str(BACKEND_ROOT / "data")


def default_db_path() -> str:
    return str(BACKEND_ROOT / "data" / "autograde.db")


class Settings(BaseSettings):
    """Runtime configuration for the backend.

    tesseract_cmd: reserved for the OCR phase, when scan_results.name_text/date_text/
        section_text get populated from the scanned image instead of left blank. Not
        read anywhere yet, and pytesseract (declared in pyproject.toml) isn't imported
        anywhere yet either -- both wait on that phase's implementation.
    """

    autograde_db_path: str = Field(default_factory=default_db_path)
    autograde_data_dir: str = Field(default_factory=default_data_dir)
    tesseract_cmd: str = ""

    def ensure_directories(self) -> None:
        Path(self.autograde_data_dir).mkdir(parents=True, exist_ok=True)
        Path(self.autograde_db_path).parent.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    return Settings()

