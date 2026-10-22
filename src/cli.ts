import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { allHardRules, ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config.ts";
import { readChange } from "./diff.ts";
import { checkHardRules } from "./hard-rules.ts";
import { annotation, hardRulesSummary, riskSummary, setOutput, writeSummary } from "./report.ts";
import { approvalState, classify } from "./risk.ts";
import { TIER_NAMES } from "./types.ts";

const USAGE = `pipeline-kit <command> [options]

Commands:
  validate                 Check the project config against the schema
  plan                     Print the verify plan (install, commands) as JSON
  hard-rules               Check a diff against the hard rules
  risk                     Classify a diff by changed paths and check approval

Options:
  --config <path>          Project config (default ${DEFAULT_CONFIG_PATH})
  --base <ref>             Diff base (default origin/main); compared from the merge base
  --head <ref>             Diff head (default HEAD)

risk reads the pull request event from KIT_EVENT_ACTION, KIT_EVENT_LABEL and
KIT_PR_LABELS (JSON array). Without them it reports the tier and approval as needed.`;

const ZERO_SHA = /^0+$/;

function main(argv: string[]): number {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      base: { type: "string" },
      head: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const config = loadConfig(values.config);
  const base = values.base || "origin/main";
  const head = values.head || "HEAD";

  switch (command) {
    case "validate": {
      const rules = allHardRules(config);
      console.log(`${values.config}: valid (${config.verify.commands.length} verify commands, ${config.risk.rules.length} risk rules, ${rules.length} hard rules)`);
      return 0;
    }

    case "plan": {
      const plan = {
        nodeVersionFile: config.verify.nodeVersionFile,
        install: config.verify.install,
        cache: existsSync("package-lock.json") ? "npm" : "",
        commands: config.verify.commands,
      };
      setOutput("node-version-file", plan.nodeVersionFile);
      setOutput("install", plan.install);
      setOutput("cache", plan.cache);
      setOutput("commands", JSON.stringify(plan.commands));
      console.log(JSON.stringify(plan, null, 2));
      return 0;
    }

    case "hard-rules": {
      if (ZERO_SHA.test(base)) {
        console.log(annotation("notice", "No base commit for this push (new branch); hard rules skipped."));
        return 0;
      }
      const change = readChange(base, head);
      const findings = checkHardRules(change, allHardRules(config));
      for (const f of findings) {
        console.log(annotation("error", `${f.rule.description}${f.rule.ref ? ` (${f.rule.ref})` : ""}`, { file: f.path, line: f.line, title: `hard rule ${f.rule.id}` }));
      }
      const summary = hardRulesSummary(findings, change.files.filter((f) => f.status !== "D").length);
      writeSummary(summary);
      console.log(summary);
      return findings.length ? 1 : 0;
    }

    case "risk": {
      const change = readChange(base, head);
      const result = classify(change.files, config);
      const labels: string[] = JSON.parse(process.env.KIT_PR_LABELS || "[]");
      const approval = approvalState(result.tier, config, {
        action: process.env.KIT_EVENT_ACTION ?? "",
        label: process.env.KIT_EVENT_LABEL || undefined,
        labels,
      });
      const summary = riskSummary(result, approval, config);
      writeSummary(summary);
      console.log(summary);
      setOutput("tier", String(result.tier));
      setOutput("approval", approval);
      const blocked = config.risk.enforce && (approval === "needed" || approval === "stale");
      if (blocked) {
        console.log(annotation("error", `Tier ${result.tier} (${TIER_NAMES[result.tier]}): ${approval === "stale" ? "approval is stale; re-apply" : "needs"} the ${config.risk.approval.label} label from an approver.`, { title: "risk" }));
      }
      return blocked ? 1 : 0;
    }

    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof ConfigError) {
    console.log(annotation("error", e.message, { title: "pipeline config" }));
    console.error(e.message);
    process.exitCode = 1;
  } else {
    // git errors name refs and paths only; still, print the message, not any captured output.
    console.error(`pipeline-kit: ${(e as Error).message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}
