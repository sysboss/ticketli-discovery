export interface DiscoveryConfig {
  backendBaseUrl: string;
  adminToken: string;
  batchSize: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): DiscoveryConfig {
  const batchSize = Number(process.env.DISCOVERY_BATCH_SIZE ?? "20");
  return {
    backendBaseUrl: requireEnv("BACKEND_BASE_URL").replace(/\/$/, ""),
    adminToken: requireEnv("DISCOVERY_ADMIN_TOKEN"),
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 20,
  };
}
