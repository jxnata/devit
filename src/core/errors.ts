/** An error meant for the person at the terminal: printed without a stack trace. */
export class DevitError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "DevitError";
  }
}
