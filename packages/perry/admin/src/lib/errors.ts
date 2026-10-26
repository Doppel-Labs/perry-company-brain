// lib/errors — turning a failure into the message shown in the app's error banner.

/** The error's own message, or `fallback` when the thrown value is not an Error. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Runs `task` and reports any rejection through `report` instead of propagating it, so
 * the returned promise always resolves. Every async action a hook hands to the UI goes
 * through this (or its own try/catch): components fire them with `void`, where an
 * escaped rejection would be unhandled and never reach the error banner.
 */
export async function reportErrors(task: () => Promise<void>, report: (message: string) => void, fallback: string): Promise<void> {
  try {
    await task();
  } catch (err) {
    report(errorMessage(err, fallback));
  }
}
