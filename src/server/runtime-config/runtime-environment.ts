export const RUNTIME_ENVIRONMENTS = Object.freeze([
  "development",
  "test",
  "staging",
  "production"
] as const);

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export type RuntimeEnvironmentClassification = Readonly<
  | { status: "VALID"; environment: RuntimeEnvironment }
  | { status: "INVALID"; environment: null }
>;

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

const deploymentLabelNames = Object.freeze([
  "APP_ENV",
  "DEPLOYMENT_ENV",
  "VERCEL_ENV"
] as const);

const environmentAliases: Readonly<Record<string, RuntimeEnvironment>> = Object.freeze({
  dev: "development",
  development: "development",
  test: "test",
  preview: "staging",
  stage: "staging",
  staging: "staging",
  prod: "production",
  production: "production"
});

function normalizeEnvironmentLabel(value: string | undefined): RuntimeEnvironment | null | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return environmentAliases[value.trim().toLowerCase()] ?? null;
}

function valid(environment: RuntimeEnvironment): RuntimeEnvironmentClassification {
  return Object.freeze({ status: "VALID", environment });
}

function invalid(): RuntimeEnvironmentClassification {
  return Object.freeze({ status: "INVALID", environment: null });
}

export function classifyRuntimeEnvironment(env: EnvironmentMap): RuntimeEnvironmentClassification {
  const executionEnvironment = normalizeEnvironmentLabel(env.NODE_ENV);
  if (
    executionEnvironment === undefined ||
    executionEnvironment === null ||
    executionEnvironment === "staging"
  ) {
    return invalid();
  }

  const deploymentEnvironments: RuntimeEnvironment[] = [];
  for (const name of deploymentLabelNames) {
    const deploymentEnvironment = normalizeEnvironmentLabel(env[name]);
    if (deploymentEnvironment === null) {
      return invalid();
    }
    if (deploymentEnvironment !== undefined) {
      deploymentEnvironments.push(deploymentEnvironment);
    }
  }

  const uniqueDeploymentEnvironments = new Set(deploymentEnvironments);
  if (uniqueDeploymentEnvironments.size > 1) {
    return invalid();
  }

  const deploymentEnvironment = deploymentEnvironments[0];
  if (deploymentEnvironment === undefined) {
    return valid(executionEnvironment);
  }

  const compatible = (
    executionEnvironment === "development" && deploymentEnvironment === "development"
  ) || (
    executionEnvironment === "test" && deploymentEnvironment === "test"
  ) || (
    executionEnvironment === "production" &&
    (deploymentEnvironment === "staging" || deploymentEnvironment === "production")
  );

  return compatible ? valid(deploymentEnvironment) : invalid();
}
