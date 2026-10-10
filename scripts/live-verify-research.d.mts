export function main(args?: string[]): Promise<void>;
export function rehearsalSearchResults(
  sources: import("../server/explanation/web.ts").WebSource[],
  request?: { include?: string },
): { name: string; url: string; snippet: string }[];
export function safeFailureCode(error: {
  code?: string;
  errcode?: number;
  message?: string;
}): string;
