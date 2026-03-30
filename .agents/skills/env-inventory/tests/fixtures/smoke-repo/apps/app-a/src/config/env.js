const key = "UNRESOLVED_DYNAMIC";

function requireNonEmptyEnv(name, value) {
  if (!value) {
    throw new Error(name + " is required");
  }

  return value;
}

function readEnv() {
  const primary = process.env.APP_A_TOKEN ?? "fallback-token";
  const publicFlag = process.env.PUBLIC_FLAG || "0";
  const composeValue = process.env.COMPOSE_ONLY || "";
  const workflowSecret = requireNonEmptyEnv("APP_A_RUNTIME_SECRET", process.env.APP_A_RUNTIME_SECRET);
  const validatedOnly = process.env.APP_A_VALIDATED_ONLY;
  const dynamic = process.env[key];
  const missing = [];

  if (!validatedOnly) {
    missing.push("APP_A_VALIDATED_ONLY");
    throw new Error("Missing required env vars");
  }

  return { primary, publicFlag, composeValue, workflowSecret, validatedOnly, dynamic };
}

module.exports = { readEnv };
