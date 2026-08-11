from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def default_data_dir() -> str:
    return str(BACKEND_ROOT / "data")


def default_db_path() -> str:
    return str(BACKEND_ROOT / "data" / "autograde.db")


class Settings(BaseSettings):
    autograde_db_path: str = Field(default_factory=default_db_path)
    autograde_data_dir: str = Field(default_factory=default_data_dir)
    tesseract_cmd: str = ""

    def ensure_directories(self) -> None:
        Path(self.autograde_data_dir).mkdir(parents=True, exist_ok=True)
        Path(self.autograde_db_path).parent.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    return Settings()