from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    autograde_db_path: str = "./data/autograde.db"
    autograde_data_dir: str = "./data"
    tesseract_cmd: str = ""

    def ensure_directories(self) -> None:
        Path(self.autograde_data_dir).mkdir(parents=True, exist_ok=True)
        Path(self.autograde_db_path).parent.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    return Settings()
