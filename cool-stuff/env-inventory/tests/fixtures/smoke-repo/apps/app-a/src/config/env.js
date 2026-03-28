const key = "UNRESOLVED_DYNAMIC";

function readEnv() {
  const primary = process.env.APP_A_TOKEN ?? "fallback-token";
  const publicFlag = process.env.PUBLIC_FLAG || "0";
  const composeValue = process.env.COMPOSE_ONLY || "";
  const workflowSecret = process.env.APP_A_RUNTIME_SECRET || "";
  const dynamic = process.env[key];
  const missing = [];

  if (!workflowSecret) {
    missing.push("APP_A_RUNTIME_SECRET");
    throw new Error("Missing required env vars");
  }

  return { primary, publicFlag, composeValue, workflowSecret, dynamic };
}

module.exports = { readEnv };
