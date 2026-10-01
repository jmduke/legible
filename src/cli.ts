#!/usr/bin/env node
/**
 * Zero-config scanner: the full Legible pipeline (crawl -> detect) against
 * any public site, no database or Google account required. GSC-powered
 * detectors (not_indexed) simply don't run.
 *
 *   pnpm scan https://example.com
 *   pnpm scan https://example.com --max-pages 500 --format agent
 *   pnpm scan https://example.com --format json > findings.json
 *
 * `--format html` uploads the report to R2 and prints its public URL. Pass
 * `--no-upload` to write the HTML locally instead, or `--output FILE` to write
 * it to a specific path (rewritten live as the scan progresses).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { bold, dim, paint, printPretty, printSummary } from "./cli/render";
import { artifactsConfigured, uploadHtmlArtifact } from "./lib/artifacts";
import { fingerprint } from "./lib/findings";
import { runFullScan } from "./lib/pipeline/run";
import {
  renderAgentMarkdown,
  renderHtmlPendingReport,
  renderHtmlReport,
} from "./lib/report";

const FORMATS = ["pretty", "summary", "json", "html", "agent"] as const;

interface CliArgs {
  origin: string;
  maxPages: number;
  format: (typeof FORMATS)[number];
  noFollow: RegExp[];
  upload: boolean;
  /** When set with --format html, report is written here with live pending updates. */
  output?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let maxPages = 300;
  let format: CliArgs["format"] = "pretty";
  let upload = true;
  let output: string | undefined;
  const noFollow: RegExp[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-pages") maxPages = Number(argv[++i]);
    else if (arg === "--format") format = argv[++i] as CliArgs["format"];
    else if (arg === "--output" || arg === "-o") output = argv[++i];
    else if (arg === "--summary") format = "summary";
    else if (arg === "--no-upload") upload = false;
    else if (arg === "--no-follow") noFollow.push(new RegExp(argv[++i]));
    else positional.push(arg);
  }

  const target = positional[0];
  if (!target || Number.isNaN(maxPages) || !FORMATS.includes(format)) {
    console.error(
      `Usage: legible-cli <url> [--max-pages N] [--format ${FORMATS.join("|")}] [--summary] [--output FILE] [--no-upload] [--no-follow <path-regex>]...`,
    );
    process.exit(1);
  }
  return {
    origin: new URL(target).origin,
    maxPages,
    format,
    noFollow,
    upload,
    output,
  };
}

/** Path or stdout fd to rewrite in place while an HTML report is generating. */
function htmlReportSink(output?: string): string | number | null {
  if (output) return output;
  if (process.stdout.isTTY) return null;
  try {
    // Shell redirects (`tsx … > report.html`) give a regular file on fd 1.
    // Wrappers like pnpm/npm pipe stdout — pending rewrites would append junk.
    if (fs.fstatSync(1).isFile()) return 1;
  } catch {
    /* fd 1 unavailable */
  }
  return null;
}

function writeHtmlReport(sink: string | number, html: string) {
  if (typeof sink === "number") {
    fs.ftruncateSync(sink, 0);
    fs.writeSync(sink, html, 0, "utf8");
  } else {
    fs.writeFileSync(sink, html);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (msg: string) => {
    if (args.format === "pretty" || args.format === "summary") console.log(msg);
    else console.error(msg);
  };

  log(`${dim("scanning")} ${bold(args.origin)}`);

  // An explicit --output always means "write it here"; otherwise HTML is
  // published to R2 unless that's turned off or unconfigured, in which case we
  // fall back to the local sink (file/redirect) or stdout.
  const wantsUpload =
    args.format === "html" && args.upload && args.output === undefined;
  if (wantsUpload && !artifactsConfigured()) {
    console.error(
      paint(
        "yellow",
        "  no R2 credentials — writing HTML locally instead.\n" +
          "  Run `stripe projects env --pull` and set CLOUDFLARE_API_TOKEN to publish,\n" +
          "  or pass --no-upload to silence this.",
      ),
    );
  }
  const uploading = wantsUpload && artifactsConfigured();
  const htmlSink =
    args.format === "html" && !uploading ? htmlReportSink(args.output) : null;
  if (htmlSink !== null) {
    writeHtmlReport(htmlSink, renderHtmlPendingReport(args.origin));
  }

  const { findings, stats } = await runFullScan({
    origin: args.origin,
    maxPages: args.maxPages,
    noFollowPatterns: args.noFollow,
    cruxApiKey: process.env.CRUX_API_KEY,
    onProgress: (message) => {
      log(
        message.startsWith("⚠")
          ? paint("yellow", `  ${message}`)
          : dim(`  ${message}`),
      );
      if (htmlSink !== null) {
        writeHtmlReport(
          htmlSink,
          renderHtmlPendingReport(args.origin, message),
        );
      }
    },
  });

  switch (args.format) {
    case "json":
      console.log(
        JSON.stringify(
          findings.map((f) => ({ fingerprint: fingerprint(f), ...f })),
          null,
          2,
        ),
      );
      return;
    case "agent":
      console.log(renderAgentMarkdown(args.origin, findings));
      return;
    case "html": {
      const html = renderHtmlReport(args.origin, findings, stats);
      if (uploading) {
        const url = await uploadHtmlArtifact({
          origin: args.origin,
          id: randomUUID(),
          html,
        });
        console.error(`${dim("published")} ${bold(url)}`);
        console.log(url);
      } else if (htmlSink !== null) writeHtmlReport(htmlSink, html);
      else console.log(html);
      return;
    }
    case "summary":
      printSummary(findings);
      return;
    default:
      printPretty(findings);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
