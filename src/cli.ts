import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { allHardRules, ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config.ts";
import { readChange, resolveSha } from "./diff.ts";
import { checkHardRules } from "./hard-rules.ts";
import { agentGitHub, runAsAgent } from "./agent.ts";
import { guardedMerge, RISK_STATUS_CONTEXT } from "./merge.ts";
import { GitHub } from "./github.ts";
import { annotation, hardRulesSummary, RISK_COMMENT_MARKER, riskComment, riskStatusDescription, riskSummary, setOutput, writeSummary } from "./report.ts";
import { approvalState, classify } from "./risk.ts";
import { PreviewError, resolvePreview } from "./preview.ts";
import { JourneyError, journeyEnv, journeySpecs, journeysSummary, previewHeaders, runJourneys, stageSecrets } from "./journeys.ts";
import type { Review } from "./risk.ts";
import { discoverChats, notify, notifyConfigFromEnv } from "./notify.ts";
import type { NoticeFact, NoticeLevel, NoticeLink } from "./notify.ts";

const USAGE = `pipeline-kit <command> [options]

Commands:
  validate                 Check the project config against the schema
  plan                     Print the verify plan (install, commands) as JSON
  hard-rules               Check a diff against the hard rules
  risk                     Classify a diff by changed paths and check approval
  preview                  Wait for the preview of --head and print its URL (outputs url,
                           enabled=false when the project lists no journeys)
  journeys --url <url>     Run the project's journeys (Playwright) against a preview, with
                           only the secrets listed under secrets.journeys (from KIT_SECRETS)
  agent git|gh <args...>   Run git or gh as the agent identity (docs/agent-identity.md)
  agent merge <pr>         Merge a PR as the agent, only if every check and status is
                           green, including pipeline-kit/risk (docs/agent-identity.md)
  notify --level alert|digest --title <text> [--fact Label=value]... [--link Label=https://...]...
                           Send an ops notice to Telegram (docs/notify.md). Needs
                           TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (TELEGRAM_TOPIC_ID for the
                           repo's topic); does nothing without them. Always exits 0 once sent
                           or skipped, so it can't fail the job that calls it.
  notify --discover        List the groups and topics the bot has seen, with their IDs

Options:
  --config <path>          Project config (default ${DEFAULT_CONFIG_PATH})
  --base <ref>             Diff base (default origin/main); compared from the merge base
  --head <ref>             Diff head (default HEAD)
  --report-status          risk: report through a commit status, review request and PR
                           comment (needs GITHUB_TOKEN, GITHUB_REPOSITORY, KIT_PR_NUMBER)
                           and exit 0; the status is the gate. Otherwise the exit code is.

risk reads the event from KIT_EVENT_ACTION, KIT_EVENT_LABEL, KIT_EVENT_ACTOR,
KIT_PR_LABELS (JSON array) and KIT_PR_AUTHOR. Without them it reports approval as needed.`;


const ZERO_SHA = /^0+$/;

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "agent" && argv[1] === "merge") {
    const number = Number(argv[2]);
    if (!Number.isInteger(number) || number <= 0 || argv.length !== 3) {
      console.error("Usage: pipeline-kit agent merge <pr-number>");
      return 2;
    }
    const result = await guardedMerge(await agentGitHub(), number);
    for (const p of result.decision.passed) console.log(`  ok   ${p}`);
    for (const r of result.decision.reasons) console.log(`  no   ${r}`);
    console.log(result.message);
    return result.merged ? 0 : 1;
  }
  if (argv[0] === "agent") {
    const tool = argv[1];
    if (tool !== "git" && tool !== "gh") {
      console.error("Usage: pipeline-kit agent git|gh <args...> | agent merge <pr-number>");
      return 2;
    }
    return runAsAgent(tool, argv.slice(2));
  }
  if (argv[0] === "notify") return notifyCommand(argv.slice(1));
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", default: DEFAULT_CONFIG_PATH },
      base: { type: "string" },
      head: { type: "string" },
      url: { type: "string" },
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

    case "preview": {
      if (!config.journeys?.length) {
        setOutput("enabled", "false");
        console.log(annotation("notice", "No journeys in the project config; nothing to run against a preview.", { title: "journeys" }));
        return 0;
      }
      const env = process.env;
      const sha = resolveSha(head);
      // In CI the job's token; locally (no GITHUB_TOKEN) the agent identity, never a person.
      const github = async () =>
        env.GITHUB_TOKEN && env.GITHUB_REPOSITORY
          ? new GitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, api: env.GITHUB_API_URL })
          : agentGitHub();
      const url = await resolvePreview(config, sha, github, { log: (l) => console.log(l) });
      if (!url) throw new PreviewError("Journeys are listed but the project has no previews.");
      setOutput("enabled", "true");
      setOutput("url", url);
      console.log(url);
      return 0;
    }

    case "journeys": {
      const url = values.url;
      if (!url || !/^https?:\/\/\S+$/.test(url)) throw new JourneyError("journeys needs --url <preview URL> (from the preview command).");
      const specs = journeySpecs(config);
      if (!specs.length) {
        console.log(annotation("notice", "No journeys in the project config.", { title: "journeys" }));
        return 0;
      }
      const secrets = stageSecrets(config, process.env.KIT_SECRETS);
      const env = journeyEnv(url, previewHeaders(config, secrets), secrets);
      console.log(`Running ${specs.length} journey spec(s) against ${url}`);
      const code = runJourneys(specs, env);
      const summary = journeysSummary(config, url, code);
      writeSummary(summary);
      if (code !== 0) console.log(annotation("error", "A journey failed against the preview.", { title: "journeys" }));
      return code === 0 ? 0 : 1;
    }

    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function splitPair(raw: string, what: string): [string, string] {
  const i = raw.indexOf("=");
  if (i <= 0) throw new Error(`--${what} must be Label=value`);
  return [raw.slice(0, i), raw.slice(i + 1)];
}

async function notifyCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      level: { type: "string" },
      title: { type: "string" },
      source: { type: "string" },
      fact: { type: "string", multiple: true },
      link: { type: "string", multiple: true },
      discover: { type: "boolean" },
    },
  });
  const config = notifyConfigFromEnv();
  if (values.discover) {
    if (!config.botToken) {
      console.error("notify --discover needs TELEGRAM_BOT_TOKEN in the environment.");
      return 2;
    }
    const chats = await discoverChats(config.botToken);
    if (!chats.length) {
      console.log("No groups seen yet. Send /start@<your bot> in the repo's topic, then run this again.");
      return 0;
    }
    for (const c of chats) {
      console.log(c.topicId
        ? `TELEGRAM_CHAT_ID=${c.chatId} TELEGRAM_TOPIC_ID=${c.topicId}  (${c.chatTitle} / ${c.topicName ?? "topic"})`
        : `TELEGRAM_CHAT_ID=${c.chatId}  (${c.chatTitle})`);
    }
    return 0;
  }
  const level = values.level as NoticeLevel;
  if ((level !== "alert" && level !== "digest") || !values.title) {
    console.error("Usage: pipeline-kit notify --level alert|digest --title <text> [--fact Label=value]... [--link Label=https://...]...");
    return 2;
  }
  const facts: NoticeFact[] = (values.fact ?? []).map((raw) => {
    const [label, v] = splitPair(raw, "fact");
    return { label, value: /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v };
  });
  const links: NoticeLink[] = (values.link ?? []).map((raw) => {
    const [label, url] = splitPair(raw, "link");
    return { label, url };
  });
  const result = await notify({ level, title: values.title, source: values.source, facts, links }, { config });
  if (result.sent) console.log(`notify: sent (${level})`);
  else if (result.reason === "not-configured") console.log("notify: skipped, TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
  else if (result.reason === "invalid") {
    console.error(`notify: not sent, ${result.detail}`);
    return 2;
  } else console.log(`notify: not sent (${result.detail})`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof PreviewError || e instanceof JourneyError) {
    console.log(annotation("error", e.message, { title: e instanceof PreviewError ? "preview" : "journeys" }));
    console.error(e.message);
    process.exitCode = 1;
  } else if (e instanceof ConfigError) {
    console.log(annotation("error", e.message, { title: "pipeline config" }));
    console.error(e.message);
    process.exitCode = 1;
  } else {
    // git errors name refs and paths only; still, print the message, not any captured output.
    console.error(`pipeline-kit: ${(e as Error).message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}
