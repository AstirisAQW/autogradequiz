class UnknownTemplateError(Exception):
    def __init__(self, template_id: str) -> None:
        super().__init__(f"No template exists with id {template_id}.")