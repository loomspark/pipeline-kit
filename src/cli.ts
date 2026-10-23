import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { allHardRules, ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config.ts";
import { readChange, resolveSha } from "./diff.ts";
import { checkHardRules } from "./hard-rules.ts";
import { runAsAgent } from "./agent.ts";
import { GitHub } from "./github.ts";
import { annotation, hardRulesSummary, RISK_COMMENT_MARKER, riskComment, riskStatusDescription, riskSummary, setOutput, writeSummary } from "./report.ts";
import { approvalState, classify } from "./risk.ts";
import type { Review } from "./risk.ts";

const USAGE = `pipeline-kit <command> [options]

Commands:
  validate                 Check the project config against the schema
  plan                     Print the verify plan (install, commands) as JSON
  hard-rules               Check a diff against the hard rules
  risk                     Classify a diff by changed paths and check approval
  agent git|gh <args...>   Run git or gh as the agent identity (docs/agent-identity.md)

Options:
  --config <path>          Project config (default ${DEFAULT_CONFIG_PATH})
  --base <ref>             Diff base (default origin/main); compared from the merge base
  --head <ref>             Diff head (default HEAD)
  --report-status          risk: report through a commit status, review request and PR
                           comment (needs GITHUB_TOKEN, GITHUB_REPOSITORY, KIT_PR_NUMBER)
                           and exit 0; the status is the gate. Otherwise the exit code is.

risk reads the event from KIT_EVENT_ACTION, KIT_EVENT_LABEL, KIT_EVENT_ACTOR,
KIT_PR_LABELS (JSON array) and KIT_PR_AUTHOR. Without them it reports approval as needed.`;

export const RISK_STATUS_CONTEXT = "pipeline-kit/risk";

const ZERO_SHA = /^0+$/;

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "agent") {
    const tool = argv[1];
    if (tool !== "git" && tool !== "gh") {
      console.error("Usage: pipeline-kit agent git|gh <args...>");
      return 2;
    }
    return runAsAgent(tool, argv.slice(2));
  }
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      base: { type: "string" },
      head: { type: "string" },
      help: { type: "boolean", short: "h" },
      "report-status": { type: "boolean" },
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
      const env = process.env;
      const change = readChange(base, head);
      const result = classify(change.files, config);
      const headSha = resolveSha(head);
      const pr = Number(env.KIT_PR_NUMBER) || 0;
      const github = env.GITHUB_TOKEN && env.GITHUB_REPOSITORY && pr
        ? new GitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, api: env.GITHUB_API_URL })
        : undefined;
      const { method, fromTier } = config.risk.approval;
      let reviews: Review[] | undefined;
      if (method === "review" && result.tier >= fromTier && github) reviews = await github.reviews(pr);
      const approval = approvalState(
        result.tier,
        config,
        {
          action: env.KIT_EVENT_ACTION ?? "",
          label: env.KIT_EVENT_LABEL || undefined,
          actor: env.KIT_EVENT_ACTOR || undefined,
          labels: JSON.parse(env.KIT_PR_LABELS || "[]"),
        },
        reviews && { head: headSha, reviews },
      );
      const summary = riskSummary(result, approval, config);
      writeSummary(summary);
      console.log(summary);
      setOutput("tier", String(result.tier));
      setOutput("approval", approval.status);
      setOutput("approved-by", approval.by ?? "");
      const waiting = approval.status === "needed" || approval.status === "stale";
      const blocked = config.risk.enforce && waiting;

      if (values["report-status"]) {
        if (!github) throw new Error("--report-status needs GITHUB_TOKEN, GITHUB_REPOSITORY and KIT_PR_NUMBER");
        const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
        await github.setStatus(headSha, {
          state: blocked ? "failure" : "success",
          context: RISK_STATUS_CONTEXT,
          description: riskStatusDescription(result.tier, approval, config),
          target_url: runUrl,
        });
        if (result.tier >= fromTier) await github.upsertComment(pr, RISK_COMMENT_MARKER, riskComment(result, approval, config));
        if (waiting && config.risk.approval.requestReview) {
          const author = (env.KIT_PR_AUTHOR ?? "").toLowerCase();
          const reviewers = config.risk.approval.approvers.filter((a) => a.toLowerCase() !== author);
          try {
            await github.requestReviewers(pr, reviewers);
          } catch (e) {
            // e.g. the approver opened the PR themselves: GitHub refuses self-review requests.
            console.log(annotation("warning", `Could not request review: ${(e as Error).message}`, { title: "risk" }));
          }
        }
        console.log(`Reported ${RISK_STATUS_CONTEXT}: ${blocked ? "failure" : "success"}`);
        return 0;
      }

      if (blocked) {
        console.log(annotation("error", riskStatusDescription(result.tier, approval, config), { title: "risk" }));
      }
      return blocked ? 1 : 0;
    }

    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
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
