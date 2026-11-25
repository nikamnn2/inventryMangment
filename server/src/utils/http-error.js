/** Purpose: an error that carries an HTTP status, so route code can `throw new HttpError(404, "...")` and the error middleware answers correctly. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
