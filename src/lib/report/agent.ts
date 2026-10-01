import type { RawFinding } from "../findings";
import { fingerprint } from "../findings";
import { fixInstruction } from "./labels";

/**
 * Render findings as self-contained work items an LLM agent (or an engineer)
 * can act on with zero additional investigation. This is the product's North
 * Star made literal: paste the output into Claude Code and say "fix these".
 */
export function renderAgentMarkdown(
  origin: string,
  findings: RawFinding[],
): string {
  const lines: string[] = [
    `# Site-health work items for ${origin}`,
    "",
    `${findings.length} discrete, independently fixable issues found by Legible.`,
    "Each item is self-contained; they can be fixed in any order.",
    "",
  ];

  findings.forEach((f, i) => {
    lines.push(`## ${i + 1}. ${f.title}`, "");
    lines.push(`- **Type:** \`${f.type}\``);
    lines.push(`- **Fingerprint:** \`${fingerprint(f)}\``);
    for (const [key, value] of Object.entries(f.detail)) {
      if (value === undefined || value === null) continue;
      lines.push(
        `- **${key}:** ${Array.isArray(value) ? value.map((v) => `\`${v}\``).join(", ") : `\`${value}\``}`,
      );
    }
    lines.push("", `**How to fix:** ${fixInstruction(f)}`, "");
  });

  return lines.join("\n");
}
