import type { WebReader } from "../server/explanation/web.ts";
import type { SchoolRegistryEntry } from "../server/schools/index.ts";
type Registry = { schools: SchoolRegistryEntry[]; [key: string]: unknown };
type Options = {
  province?: string;
  city?: string;
  limit?: number;
  write?: boolean;
  reader?: WebReader;
  concurrency?: number;
  intervalMs?: number;
};
type Page = {
  url: string | null;
  ok: boolean | null;
  skipped?: boolean;
  failureCode?: string;
  finalUrl?: string;
  transport?: string;
  encoding?: string;
};
type Report = {
  registry: Registry;
  results: {
    name: string;
    verification: SchoolRegistryEntry["verification"];
    pages: Page[];
  }[];
  summary: {
    total: number;
    homepageOk: number;
    graduateTotal: number;
    graduateOk: number;
    pages: number;
    pagesOk: number;
  };
};
export function parseArguments(args: string[]): Options;
export function verifyPage(
  school: SchoolRegistryEntry,
  url: string | null,
  reader: WebReader,
): Promise<Page>;
export function verifyRegistry(
  registry: Registry,
  options?: Options,
): Promise<Report>;
export function runVerification(
  path: string | URL,
  options?: Options,
): Promise<Report>;
