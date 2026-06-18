export class EditorError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'EditorError';
  }
}
