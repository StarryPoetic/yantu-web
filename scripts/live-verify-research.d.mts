export function main(
  args?: string[],
  dependencies?: {
    directory?: string;
    databasePath?: string;
    run?: ReturnType<
      typeof import("../server/disciplines/index.ts").generateGuidance
    >;
    http?: import("../server/explanation/web.ts").WebReader;
    onModelMessages?: (
      messages: import("../server/explanation/deepseek.ts").ModelMessage[],
      options?: import("../server/explanation/deepseek.ts").ModelRequestOptions,
    ) => void | Promise<void>;
    log?: (event: { event: string; simulated?: boolean }) => void;
  },
): Promise<
  | {
      totals: {
        searches: number;
        simulatedSearches: number;
        modelCalls: number;
      };
      status: string;
    }
  | undefined
>;
export function publicSchoolContext(host: string): {
  school: string | null;
  city: string;
  campusCities: string[];
};
export function rehearsalSearchResults(
  sources: Pick<
    import("../server/explanation/web.ts").WebSource,
    "url" | "title" | "excerpt"
  >[],
  request?: { include?: string },
): { name: string; url: string; snippet: string }[];
export function safeFailureCode(error: {
  code?: string;
  errcode?: number;
  message?: string;
}): string;
