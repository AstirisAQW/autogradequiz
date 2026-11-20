class ScanImageUnreadableError(Exception):
    def __init__(self, detail: str = "Could not decode uploaded scan image.") -> None:
        super().__init__(detail)


class InvalidAnswerKeyError(Exception):
    pass
