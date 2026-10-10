export function main(args?: string[]): Promise<void>;
export function safeFailureCode(error: {
  code?: string;
  errcode?: number;
  message?: string;
}): string;
