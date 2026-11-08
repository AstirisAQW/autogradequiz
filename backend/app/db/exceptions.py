class InvalidTestError(Exception):
    pass


class InvalidCorrectionError(Exception):
    pass


class TestNotFoundError(Exception):
    def __init__(self, test_id: int) -> None:
        super().__init__(f"No test exists with id {test_id}.")


class BatchNotFoundError(Exception):
    def __init__(self, batch_id: int) -> None:
        super().__init__(f"No batch exists with id {batch_id}.")


class ScanJobNotFoundError(Exception):
    def __init__(self, scan_job_id: int) -> None:
        super().__init__(f"No scan job exists with id {scan_job_id}.")


class ScanResultNotFoundError(Exception):
    def __init__(self, scan_job_id: int) -> None:
        super().__init__(f"No scan result exists for scan job {scan_job_id}.")


