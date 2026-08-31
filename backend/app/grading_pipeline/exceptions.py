class ScanImageUnreadableError(Exception):
    def __init__(self, image_path: str) -> None:
        super().__init__(f"Could not read scan image at {image_path}.")
