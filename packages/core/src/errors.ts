export class AiHubError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "AiHubError";
    this.code = code;
  }
}
