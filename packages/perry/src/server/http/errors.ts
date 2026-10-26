// http/errors — typed HTTP errors. Only these messages are ever shown to clients.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message);
}

export const badRequest = (message: string): HttpError => new HttpError(400, message);
export const notFound = (message = "Not found"): HttpError => new HttpError(404, message);

/**
 * Normalizes anything thrown by a controller. Domain errors may opt in to a
 * client-visible 4xx by carrying an integer `status` (e.g. GraphChangeSetReplayError);
 * everything else becomes an opaque 500.
 */
export function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof HttpError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  if (error instanceof Error && Number.isInteger(status) && (status as number) >= 400 && (status as number) < 500) {
    return new HttpError(status as number, error.message);
  }
  return undefined;
}
