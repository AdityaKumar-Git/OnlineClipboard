/** An error that maps to an HTTP response of shape `{ error: { code, message } }`. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
