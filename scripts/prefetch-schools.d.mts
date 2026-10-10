import type { DnsMode } from "../server/explanation/dns.ts";
import type { WebReader } from "../server/explanation/web.ts";
import type { ResearchEvidenceLibrary } from "../server/explanation/research-library.ts";
import type {
  schoolRegistry,
  SchoolRegistryEntry,
} from "../server/schools/index.ts";

export interface PrefetchOptions {
  school?: string[];
  city?: string;
  province?: string;
  discipline?: string;
  maxPagesPerSchool?: number;
  db?: string;
  dnsMode?: DnsMode;
  dryRun?: boolean;
  refresh?: boolean;
}
export interface PrefetchSummary {
  attemptedSchools: number;
  successfulPages: number;
  skippedFreshPages: number;
  failuresByCode: Record<string, number>;
  factsByField: Record<string, { bound: number; pending: number }>;
  robotsSkipped: number;
  dryRun: boolean;
}
export function parseArguments(args: string[]): PrefetchOptions;
export function discoveryScore(
  link: { url: string; title?: string; attachment?: boolean },
  targetYear: string | number,
  parentScore?: number,
): number;
export function discoverLinks(
  html: string,
  base: string,
  school: SchoolRegistryEntry,
  parentTitle?: string,
): { url: string; title: string; attachment: boolean }[];
export function prefetchSchools(
  options?: PrefetchOptions,
  dependencies?: {
    registry?: Pick<
      typeof schoolRegistry,
      "schools" | "byName" | "byCity" | "discoveryUrls"
    >;
    library?: ResearchEvidenceLibrary;
    reader?: WebReader;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    [key: string]: unknown;
  },
): Promise<PrefetchSummary>;
