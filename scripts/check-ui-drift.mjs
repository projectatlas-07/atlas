import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const UI_DRIFT_BASELINE_VERSION = 1;

export const UI_DRIFT_RULES = {
  "raw-color": "raw hex/rgb/hsl-style colour",
  "arbitrary-color": "arbitrary Tailwind colour",
  "arbitrary-spacing": "arbitrary Tailwind spacing",
  "arbitrary-radius": "arbitrary Tailwind radius",
  "arbitrary-shadow": "arbitrary Tailwind shadow",
  "duplicate-button-style": "native button styling instead of Button",
  "duplicate-input-style": "native input styling instead of Input",
  "duplicate-select-style": "native select styling instead of Select",
  "duplicate-table-style": "native table styling instead of Table primitives",
  "duplicate-card-surface": "card-like surface styling instead of Card",
  "duplicate-feedback-style": "semantic message styling instead of Feedback",
  "duplicate-empty-state-style": "empty-state styling instead of EmptyState",
  "status-presentation-bypass": "status pill/label styling outside statuses.ts and StatusPill",
  "formatting-bypass": "display formatting outside formatting.ts",
  "shared-string-bypass": "literal wording already owned by strings.ts",
  "invalid-ui-exception": "ui-exception without a reason",
};

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...walk(absolutePath));
    } else {
      files.push(absolutePath);
    }
  }
  return files;
}

function isUiSource(relativePath) {
  if (!relativePath.startsWith("src/")) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  if (/\.(?:tsx|jsx|css)$/.test(relativePath)) return true;
  return /^src\/components\/ui\/.*\.[cm]?[jt]s$/.test(relativePath);
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source[position] === "\n") line += 1;
  }
  return line;
}

function exceptionReason(line) {
  const match = /^\s*(?:\/\/|\/\*|\{\/\*|<!--)\s*ui-exception:\s*(.*)/.exec(line);
  if (!match) return null;
  return match[1]
    .replace(/\*\/.*$/, "")
    .replace(/-->.*$/, "")
    .trim();
}

function exceptionMetadata(lines) {
  const exemptLines = new Set();
  const invalidLines = [];

  lines.forEach((line, index) => {
    const reason = exceptionReason(line);
    if (reason === null) return;
    if (!reason) {
      invalidLines.push(index + 1);
      return;
    }

    exemptLines.add(index + 1);
    let nextLine = index + 1;
    while (nextLine < lines.length && !lines[nextLine].trim()) nextLine += 1;
    if (nextLine < lines.length) exemptLines.add(nextLine + 1);
  });

  return { exemptLines, invalidLines };
}

function normalizeEvidence(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function extractOpeningTags(source) {
  const tags = [];
  const startPattern = /<(button|input|select|table|thead|tbody|tr|th|td|span|div|section|article|p)\b/g;
  let match;

  while ((match = startPattern.exec(source))) {
    let quote = null;
    let braceDepth = 0;
    let cursor = startPattern.lastIndex;

    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      const previous = source[cursor - 1];

      if (quote) {
        if (character === quote && previous !== "\\") quote = null;
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (character === ">" && braceDepth === 0) {
        tags.push({
          name: match[1],
          start: match.index,
          text: source.slice(match.index, cursor + 1),
        });
        startPattern.lastIndex = cursor + 1;
        break;
      }
    }
  }

  return tags;
}

function classDetails(tagText) {
  const attributeMatch = /\bclassName\s*=/.exec(tagText);
  if (!attributeMatch) return null;

  const afterEquals = tagText
    .slice(attributeMatch.index + attributeMatch[0].length)
    .trimStart();
  const literalMatch = /^(?:\{\s*)?(["'`])([\s\S]*?)\1(?:\s*\})?/.exec(afterEquals);

  if (literalMatch) {
    const value = literalMatch[2];
    const tokens = value.split(/\s+/).filter(Boolean);
    return {
      index: attributeMatch.index,
      literal: true,
      tokens,
      signature: [...tokens].sort().join(" "),
    };
  }

  return {
    index: attributeMatch.index,
    literal: false,
    tokens: [],
    signature: `dynamic:${normalizeEvidence(afterEquals)}`,
  };
}

function baseUtility(token) {
  return token.split(":").at(-1) ?? token;
}

function hasToken(tokens, pattern) {
  return tokens.some((token) => pattern.test(baseUtility(token)));
}

function extractSharedStrings(root) {
  const stringsPath = path.join(root, "src/lib/strings.ts");
  if (!existsSync(stringsPath)) return [];

  const source = readFileSync(stringsPath, "utf8");
  const objectMatch = /const ENGLISH_SHARED_STRINGS\s*=\s*\{([\s\S]*?)\}\s*as const;/.exec(source);
  if (!objectMatch) return [];

  const values = new Set();
  for (const match of objectMatch[1].matchAll(/:\s*"([^"\n]+)"/g)) {
    values.add(match[1]);
  }
  return [...values].sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanSource({ source, relativePath, sharedStrings }) {
  const lines = source.split(/\r?\n/);
  const { exemptLines, invalidLines } = exceptionMetadata(lines);
  const findings = [];

  function add(rule, index, evidence, fingerprint = evidence) {
    const line = lineNumberAt(source, index);
    if (rule !== "invalid-ui-exception" && exemptLines.has(line)) return;
    findings.push({
      rule,
      file: relativePath,
      line,
      evidence: normalizeEvidence(evidence),
      fingerprint: normalizeEvidence(fingerprint),
    });
  }

  for (const line of invalidLines) {
    findings.push({
      rule: "invalid-ui-exception",
      file: relativePath,
      line,
      evidence: "ui-exception requires a readable reason",
      fingerprint: "missing-reason",
    });
  }

  const patternRules = [
    {
      rule: "raw-color",
      pattern: /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^\n;}]*/gi,
    },
    {
      rule: "arbitrary-color",
      pattern: /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-\[(?:#|(?:rgb|rgba|hsl|hsla|oklch|oklab|color|var)\()[^\]]+\]/gi,
    },
    {
      rule: "arbitrary-spacing",
      pattern: /(?:^|[\s"'`])(-?(?:[mp][trblxy]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left)-\[[^\]]+\])/g,
      group: 1,
    },
    {
      rule: "arbitrary-radius",
      pattern: /\brounded(?:-[a-z]+)?-\[[^\]]+\]/g,
    },
    {
      rule: "arbitrary-shadow",
      pattern: /\bshadow-\[[^\]]+\]/g,
    },
  ];

  for (const { rule, pattern, group = 0 } of patternRules) {
    for (const match of source.matchAll(pattern)) {
      const evidence = match[group];
      const offset = group === 0 ? 0 : match[0].indexOf(evidence);
      add(rule, match.index + offset, evidence, evidence.toLowerCase());
    }
  }

  if (/\.(?:tsx|jsx)$/.test(relativePath)) {
    for (const tag of extractOpeningTags(source)) {
      const details = classDetails(tag.text);
      if (!details) continue;

      const index = tag.start + details.index;
      const fingerprint = `${tag.name}|${details.signature}`;
      const inputType = /\btype\s*=\s*["']([^"']+)["']/.exec(tag.text)?.[1];

      if (tag.name === "button") {
        add("duplicate-button-style", index, "styled <button>", fingerprint);
        continue;
      }

      if (
        tag.name === "input"
        && !["checkbox", "radio", "file", "hidden"].includes(inputType ?? "")
      ) {
        add("duplicate-input-style", index, "styled <input>", fingerprint);
        continue;
      }

      if (tag.name === "select") {
        add("duplicate-select-style", index, "styled <select>", fingerprint);
        continue;
      }

      if (["table", "thead", "tbody", "tr", "th", "td"].includes(tag.name)) {
        add("duplicate-table-style", index, `styled <${tag.name}>`, fingerprint);
        continue;
      }

      if (!details.literal) continue;
      const tokens = details.tokens;

      if (
        tag.name === "span"
        && hasToken(tokens, /^rounded-(?:full|atlas-pill)$/)
        && hasToken(tokens, /^(?:p[xy]?|px|py)-/)
        && hasToken(tokens, /^(?:bg|text|border)-/)
      ) {
        add(
          "status-presentation-bypass",
          index,
          "pill-like status styling",
          fingerprint,
        );
        continue;
      }

      const semanticSurface = hasToken(
        tokens,
        /^bg-(?:red|emerald|amber|blue|cyan)-\d+|^bg-atlas-(?:danger|success|warning|info)-surface$/,
      );
      const semanticText = hasToken(
        tokens,
        /^text-(?:red|emerald|amber|blue|cyan)-\d+|^text-atlas-(?:danger|success|warning|info)-text$/,
      );
      const padded = hasToken(tokens, /^(?:p|px|py)-/);

      if (
        ["div", "p", "section"].includes(tag.name)
        && semanticSurface
        && semanticText
        && padded
      ) {
        add(
          "duplicate-feedback-style",
          index,
          "semantic message surface",
          fingerprint,
        );
        continue;
      }

      if (
        ["div", "section", "p"].includes(tag.name)
        && hasToken(tokens, /^text-center$/)
        && hasToken(tokens, /^py-/)
        && hasToken(tokens, /^text-(?:slate|stone)-\d+|^text-atlas-text-muted$/)
      ) {
        add(
          "duplicate-empty-state-style",
          index,
          "empty-state-like presentation",
          fingerprint,
        );
        continue;
      }

      if (
        ["div", "section", "article"].includes(tag.name)
        && hasToken(tokens, /^rounded-(?:lg|xl|2xl|atlas-card)$/)
        && hasToken(tokens, /^border(?:-|$)/)
        && hasToken(tokens, /^bg-/)
        && padded
      ) {
        add(
          "duplicate-card-surface",
          index,
          "card-like grouped surface",
          fingerprint,
        );
      }
    }

    const formattingPatterns = [
      /\.toLocale(?:String|DateString|TimeString)\s*\(/g,
      /\bIntl\.(?:NumberFormat|DateTimeFormat)\s*\(/g,
      /\b(?:formatSalesMoney|formatChallanDate|formatStoredCurrency|formatStaffMoney|formatFuelTime)\s*\(/g,
      /₹\s*\$\{/g,
    ];
    for (const pattern of formattingPatterns) {
      for (const match of source.matchAll(pattern)) {
        add("formatting-bypass", match.index, match[0], match[0]);
      }
    }

    const inlineStatusPattern = /\b(?:status|paymentState|isActive|isLocked)\b[^?\n]{0,100}\?\s*["'](?:Active|Archived|Inactive|Paid|Unpaid|Partial|Void|Locked|Reversed)["']/g;
    for (const match of source.matchAll(inlineStatusPattern)) {
      add(
        "status-presentation-bypass",
        match.index,
        normalizeEvidence(match[0]),
        "inline-status-label",
      );
    }

    for (const value of sharedStrings) {
      const escaped = escapeRegExp(value);
      const literalPattern = new RegExp(
        `(["'\\x60])${escaped}\\1|>\\s*${escaped}\\s*<`,
        "g",
      );
      for (const match of source.matchAll(literalPattern)) {
        add("shared-string-bypass", match.index, value, value);
      }
    }
  }

  return findings;
}

export function scanUiDrift(root = process.cwd()) {
  const sourceRoot = path.join(root, "src");
  const sharedStrings = extractSharedStrings(root);
  const findings = [];

  for (const absolutePath of walk(sourceRoot).sort()) {
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (!isUiSource(relativePath)) continue;
    const source = readFileSync(absolutePath, "utf8");
    findings.push(...scanSource({ source, relativePath, sharedStrings }));
  }

  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file)
      || left.line - right.line
      || left.rule.localeCompare(right.rule),
  );
}

function findingKey({ rule, file, fingerprint }) {
  return `${rule}\u0000${file}\u0000${fingerprint}`;
}

export function createUiDriftBaseline(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        rule: finding.rule,
        file: finding.file,
        fingerprint: finding.fingerprint,
        count: 1,
      });
    }
  }

  return {
    version: UI_DRIFT_BASELINE_VERSION,
    note: "Existing violations only. Do not hand-edit counts to approve new UI drift.",
    violations: [...grouped.values()].sort(
      (left, right) =>
        left.file.localeCompare(right.file)
        || left.rule.localeCompare(right.rule)
        || left.fingerprint.localeCompare(right.fingerprint),
    ),
  };
}

export function compareUiDrift(findings, baseline) {
  if (baseline.version !== UI_DRIFT_BASELINE_VERSION) {
    throw new Error(
      `Unsupported UI drift baseline version ${String(baseline.version)}.`,
    );
  }

  const allowed = new Map(
    baseline.violations.map((entry) => [findingKey(entry), entry.count]),
  );
  const current = new Map();

  for (const finding of findings) {
    const key = findingKey(finding);
    const group = current.get(key);
    if (group) {
      group.count += 1;
      group.lines.push(finding.line);
    } else {
      current.set(key, {
        ...finding,
        count: 1,
        lines: [finding.line],
      });
    }
  }

  return [...current.entries()]
    .filter(([key, group]) => group.count > (allowed.get(key) ?? 0))
    .map(([key, group]) => ({
      ...group,
      baselineCount: allowed.get(key) ?? 0,
      key,
    }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file)
        || left.lines[0] - right.lines[0]
        || left.rule.localeCompare(right.rule),
    );
}

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    baseline: null,
    writeBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write-baseline") {
      options.writeBaseline = true;
    } else if (argument === "--root") {
      options.root = path.resolve(argv[++index]);
    } else if (argument === "--baseline") {
      options.baseline = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  options.baseline ??= path.join(options.root, "scripts/ui-drift-baseline.json");
  return options;
}

export function runUiDriftCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const findings = scanUiDrift(options.root);

  if (options.writeBaseline) {
    const baseline = createUiDriftBaseline(findings);
    mkdirSync(path.dirname(options.baseline), { recursive: true });
    writeFileSync(options.baseline, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(
      `Wrote ${baseline.violations.length} UI drift baseline fingerprints to ${path.relative(options.root, options.baseline)}.\n`,
    );
    return 0;
  }

  if (!existsSync(options.baseline)) {
    process.stderr.write(
      `UI drift baseline not found: ${options.baseline}\nRun with --write-baseline only after reviewing the current repository.\n`,
    );
    return 1;
  }

  const baseline = JSON.parse(readFileSync(options.baseline, "utf8"));
  const newViolations = compareUiDrift(findings, baseline);

  if (newViolations.length === 0) {
    process.stdout.write(
      `UI drift check passed (${findings.length} grandfathered occurrences, no new violations).\n`,
    );
    return 0;
  }

  process.stderr.write("New Atlas UI drift detected:\n");
  for (const violation of newViolations) {
    const description = UI_DRIFT_RULES[violation.rule] ?? violation.rule;
    process.stderr.write(
      `- ${violation.file}:${violation.lines.join(",")} [${violation.rule}] ${description}; current ${violation.count}, baseline ${violation.baselineCount}; ${violation.evidence}\n`,
    );
  }
  process.stderr.write(
    "Use Atlas tokens/shared contracts, or add a narrow // ui-exception: <reason> for a legitimate exception.\n",
  );
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    process.exitCode = runUiDriftCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
