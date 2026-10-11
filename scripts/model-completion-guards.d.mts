import type { ModelAdapter } from "../server/explanation/deepseek.ts";
import type {
  WebReadResult,
  WebReader,
  WebSource,
} from "../server/explanation/web.ts";
export const completionLimit: {
  searches: number;
  modelCalls: number;
  inputCharsPerCall: number;
  planningInputChars: number;
  priorKnownTokens: number;
  combinedTokens: number;
  reads: number;
};
export function assertCompletionNotStarted(path: string): Promise<void>;
export function acquireCompletionLock(
  path: string,
  directory: string,
): Promise<void>;
export function createCompletionModelGuard(
  adapter: ModelAdapter,
  options?: {
    lock?: () => Promise<void>;
    log?: (event: Record<string, unknown>) => void;
  },
): ModelAdapter;
type SearchSource = Pick<WebSource, "url" | "title" | "excerpt">;
export function createSearchProtectedReader(options: {
  http: WebReader;
  searchHost: string;
  sources: () => SearchSource[];
  searchResults: (
    sources: SearchSource[],
    request?: { include?: string },
  ) => unknown[];
}): (
  url: string,
  options?: Partial<Parameters<WebReader>[1]>,
) => Promise<WebReadResult>;
