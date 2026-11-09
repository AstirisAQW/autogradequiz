class ScanImageUnreadableError(Exception):
    def __init__(self, image_path: str) -> None:
        super().__init__(f"Could not read scan image at {image_path}.")


class ScanJobAlreadyGradedError(Exception):
    def __init__(self, scan_job_id: int) -> None:
        super().__init__(f"Scan job {scan_job_id} has already been graded.")



