from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent


def default_data_dir() -> str:
    return str(BACKEND_ROOT / "data")


def default_workspace_dir() -> str:
    return str(REPO_ROOT / "workspace")


class Settings(BaseSettings):

    autograde_data_dir: str = Field(default_factory=default_data_dir)
    autograde_workspace_dir: str = Field(default_factory=default_workspace_dir)
    tesseract_cmd: str = ""


def get_settings() -> Settings:
    return Settings()
