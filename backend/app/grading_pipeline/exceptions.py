class ScanImageUnreadableError(Exception):
    def __init__(self, image_path: str) -> None:
        super().__init__(f"Could not read scan image at {image_path}.")


class ScanImageSizeMismatchError(Exception):
    def __init__(self, actual_size: tuple[int, int], expected_size: tuple[int, int]) -> None:
        super().__init__(f"Scan image size {actual_size} does not match expected {expected_size}.")


class ScanJobAlreadyGradedError(Exception):
    def __init__(self, scan_job_id: int) -> None:
        super().__init__(f"Scan job {scan_job_id} has already been graded.")


