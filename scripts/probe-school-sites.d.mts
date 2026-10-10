import type { WebReader } from "../server/explanation/web.ts";
export function probeSites(
  urls: string[],
  options?: { reader?: WebReader; concurrency?: number },
): Promise<{
  results: {
    index: number;
    url: string;
    status: string;
    code?: string;
    tlsCode?: string;
    finalUrl?: string;
    transport?: "https" | "http";
    encoding?: string;
  }[];
  summary: {
    total: number;
    success: number;
    failures: Record<string, number>;
    tlsCodes: Record<string, number>;
    chainFailureRatio: number;
  };
}>;
