export class DomainError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 503;
  readonly code: string;

  constructor(status: 400 | 403 | 404 | 409 | 422 | 429 | 503, code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
  }
}
