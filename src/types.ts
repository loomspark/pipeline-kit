// Types for .pipeline/config.yml. schema/pipeline-config.schema.json is the contract;
// keep these in step with it.

export type Tier = 0 | 1 | 2;

export const TIER_NAMES: Record<Tier, string> = {
  0: "auto-ship",
  1: "auto-build",
  2: "escalate",
};

export interface VerifyCommand {
  name: string;
  run: string;
}

export interface RiskRule {
  tier: Tier;
  paths: string[];
  reason: string;
  ref?: string;
}

export interface HardRule {
  id: string;
  description: string;
  ref?: string;
  paths: string[];
  exceptPaths?: string[];
  forbidFile?: boolean;
  forbidPatterns?: string[];
  ignoreCase?: boolean;
}

export interface PipelineConfig {
  version: 1;
  project: { name: string; description?: string };
  verify: { nodeVersionFile: string; install: string; commands: VerifyCommand[] };
  risk: {
    enforce: boolean;
    defaultTier: Tier;
    approval: {
      method: "review" | "label";
      approvers: string[];
      requestReview: boolean;
      label: string;
      fromTier: Tier;
    };
    rules: RiskRule[];
  };
  hardRules: { presets: string[]; rules: HardRule[] };
  previews?: {
    source: "deployment" | "command" | "none";
    environment?: string;
    command?: string;
    timeoutMinutes: number;
    /** Header name -> NAME of the secret holding its value. */
    headers: Record<string, string>;
  };
  journeys?: { id: string; description: string; spec?: string }[];
  testData?: { reset?: string; seed?: string };
  models?: { gatewayUrl?: string; roles?: Partial<Record<"triage" | "build" | "review" | "test", string>> };
  secrets: Record<string, string[]>;
}
