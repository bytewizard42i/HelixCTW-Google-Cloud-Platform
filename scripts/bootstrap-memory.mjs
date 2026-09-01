// SPDX-License-Identifier: Apache-2.0
// One-time Stage B bootstrap for the isolated mhelix_gcp_testwired database.
//
// Usage (the admin URL stays inside the shell environment and is never logged):
//   HELIXCTW_GCP_ADMIN_DB_URL="..." \
//   HELIXCTW_GCP_RELEASE_COMMIT="<40-hex commit>" \
//     node scripts/bootstrap-memory.mjs --check
//
// Replace --check with --apply only after reviewing the preflight. --apply is
// additive: it creates one database, one NOLOGIN owner role, one least-
// privilege runtime user, schema objects, canonical activation rows, and
// explicit grants. It contains no DROP, DELETE, TRUNCATE, or data rewrite.
//
// The runtime password is generated with node:crypto and never printed. The
// resulting URL is written mode 0600 under /home/js/GoogleCloud-secrets-folder
// for just-in-time Terraform use. A .pending file remains if activation fails;
// that is deliberate recovery evidence and must be reviewed, not deleted.

import { randomBytes } from "node:crypto";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromService = createRequire(join(repositoryRoot, "service/package.json"));
const pg = requireFromService("pg");
const databaseDirectory = join(repositoryRoot, "database", "memory");
const targetDatabase = "mhelix_gcp_testwired";
const ownerRole = "mhelix_gcp_migrator";
const runtimeUser = "mhelix_gcp_runtime";
const expectedAdminUser = "didz_gateway";
const outputPath =
  process.env.HELIXCTW_GCP_VECTOR_SECRET_FILE ??
  "/home/js/GoogleCloud-secrets-folder/helixctw-gcp-vector-runtime.env";
const pendingOutputPath = `${outputPath}.pending`;
const releaseCommit = process.env.HELIXCTW_GCP_RELEASE_COMMIT ?? "";
const adminDatabaseUrl = process.env.HELIXCTW_GCP_ADMIN_DB_URL ?? "";
const mode = process.argv[2];

if (!new Set(["--check", "--apply"]).has(mode)) {
  throw new Error("Choose exactly one mode: --check or --apply.");
}
if (!/^[0-9a-f]{40}$/.test(releaseCommit)) {
  throw new Error("HELIXCTW_GCP_RELEASE_COMMIT must be a 40-character lowercase commit.");
}

let parsedAdminUrl;
try {
  parsedAdminUrl = new URL(adminDatabaseUrl);
} catch {
  throw new Error("HELIXCTW_GCP_ADMIN_DB_URL is invalid.");
}
if (
  !["postgres:", "postgresql:"].includes(parsedAdminUrl.protocol) ||
  !parsedAdminUrl.hostname.endsWith(".cockroachlabs.cloud") ||
  decodeURIComponent(parsedAdminUrl.username) !== expectedAdminUser ||
  parsedAdminUrl.pathname !== "/helix_testtown"
) {
  throw new Error("The admin URL does not identify the reviewed didz-testwired operator.");
}

function clientFor(url) {
  return new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 2_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    application_name: "helixctw-gcp-memory-bootstrap",
  });
}

async function fileText(fileName) {
  return readFile(join(databaseDirectory, fileName), "utf8");
}

function sqlStatements(source) {
  return source
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function executeSource(client, fileName, parameter) {
  const statements = sqlStatements(await fileText(fileName));
  for (const statement of statements) {
    const values = statement.includes("$1") ? [parameter] : [];
    await client.query(statement, values);
  }
  return statements.length;
}

async function verifyBooleanSource(client, fileName, parameter) {
  const statements = sqlStatements(await fileText(fileName));
  const checks = {};
  for (const statement of statements) {
    const values = statement.includes("$1") ? [parameter] : [];
    const result = await client.query(statement, values);
    for (const row of result.rows) {
      for (const [name, value] of Object.entries(row)) {
        if (typeof value !== "boolean") {
          throw new Error(`${fileName} returned a non-boolean verification field.`);
        }
        checks[name] = value;
      }
    }
  }
  const failedChecks = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  if (Object.keys(checks).length === 0 || failedChecks.length > 0) {
    throw new Error(`${fileName} failed: ${failedChecks.join(", ") || "no checks returned"}.`);
  }
  console.log(`${fileName}: ${Object.keys(checks).length} boolean checks passed.`);
}

function targetUrlFor(username, password) {
  const target = new URL(parsedAdminUrl);
  target.pathname = `/${targetDatabase}`;
  target.username = username;
  target.password = password;
  return target;
}

const adminClient = clientFor(parsedAdminUrl);
await adminClient.connect();
let roleRows;
let databaseRows;
try {
  const identity = await adminClient.query("SELECT current_user");
  if (identity.rows[0]?.current_user !== expectedAdminUser) {
    throw new Error("The authenticated database operator is not didz_gateway.");
  }
  roleRows = (await adminClient.query("SHOW ROLES")).rows;
  const operator = roleRows.find((role) => role.username === expectedAdminUser);
  if (!operator || !operator.member_of?.includes("admin")) {
    throw new Error("didz_gateway is not currently a member of admin.");
  }
  databaseRows = (await adminClient.query("SHOW DATABASES")).rows;
} finally {
  if (mode === "--check") await adminClient.end();
}

const targetExists = databaseRows.some((row) => row.database_name === targetDatabase);
const ownerExists = roleRows.some((row) => row.username === ownerRole);
const runtimeExists = roleRows.some((row) => row.username === runtimeUser);
console.log(
  JSON.stringify(
    {
      mode,
      clusterHost: parsedAdminUrl.hostname,
      authenticatedUser: expectedAdminUser,
      targetDatabase,
      targetExists,
      ownerRoleExists: ownerExists,
      runtimeUserExists: runtimeExists,
      releaseCommit,
      sourceFiles: {
        migration001: "0b676f78935894b91ce3471156c07e05d3477ed93fb7cc6bf0fe35d20e341aa2",
        migration002: "bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d",
      },
    },
    null,
    2,
  ),
);

if (mode === "--check") process.exit(0);
if (targetExists || ownerExists || runtimeExists) {
  await adminClient.end();
  throw new Error("Stage B target objects already exist. Refusing a non-pristine bootstrap.");
}

// Ensure the private parent directory exists before generating a credential.
await access(dirname(outputPath));
try {
  await access(outputPath);
  throw new Error("The final runtime secret file already exists. Refusing to overwrite it.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try {
  await access(pendingOutputPath);
  throw new Error("A pending runtime secret exists. Review recovery state before retrying.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const runtimePassword = randomBytes(32).toString("base64url");
const runtimeUrl = targetUrlFor(runtimeUser, runtimePassword);
const secretFile = [
  `export TF_VAR_vector_database_url='${runtimeUrl.toString()}'`,
  `export HELIXCTW_GCP_VECTOR_DB_URL='${runtimeUrl.toString()}'`,
  "",
].join("\n");
await writeFile(pendingOutputPath, secretFile, { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Generated the private pending runtime URL at ${pendingOutputPath} (mode 0600).`);

try {
  await adminClient.query(`CREATE ROLE ${ownerRole}`);
  await adminClient.query(`GRANT ${ownerRole} TO ${expectedAdminUser}`);
  await adminClient.query(`CREATE DATABASE ${targetDatabase}`);
  await adminClient.query(`ALTER DATABASE ${targetDatabase} OWNER TO ${ownerRole}`);
  await adminClient.query(
    `CREATE USER ${runtimeUser} WITH LOGIN PASSWORD $1`,
    [runtimePassword],
  );
  await adminClient.query(`ALTER USER ${runtimeUser} WITH NOCREATEDB NOCREATEROLE`);
} finally {
  await adminClient.end();
}

const targetAdminUrl = targetUrlFor(
  decodeURIComponent(parsedAdminUrl.username),
  decodeURIComponent(parsedAdminUrl.password),
);
const targetClient = clientFor(targetAdminUrl);
await targetClient.connect();
try {
  await targetClient.query(`SET ROLE ${ownerRole}`);
  console.log(`migration 001: ${await executeSource(targetClient, "001_testwired_memory_core.sql")} statements applied.`);
  await executeSource(targetClient, "001_testwired_marker_activation.sql");
  await targetClient.query(`RESET ROLE`);
  await verifyBooleanSource(targetClient, "verify_marker_activation.sql");

  await targetClient.query(`SET ROLE ${ownerRole}`);
  console.log(`migration 002: ${await executeSource(targetClient, "002_testwired_vector_memory.sql")} statements applied.`);
  await executeSource(targetClient, "002_testwired_vector_memory_activation.sql");
  await executeSource(targetClient, "003_testwired_case_namespace.sql", releaseCommit);
  await executeSource(targetClient, "002_testwired_vector_memory_grants.sql");
  // New CockroachDB databases grant TEMPORARY to public by default. Remove it
  // so the exact privilege verifier can prove public has only CONNECT.
  await targetClient.query(`REVOKE TEMPORARY ON DATABASE ${targetDatabase} FROM public`);
  await executeSource(targetClient, "activate_vector_memory_capability.sql", releaseCommit);
  await targetClient.query(`RESET ROLE`);

  await verifyBooleanSource(targetClient, "verify_vector_memory_activation.sql");
  await verifyBooleanSource(targetClient, "verify_vector_memory_capability.sql", releaseCommit);
} finally {
  await targetClient.end();
}

// Prove the generated least-privilege credential can authenticate and read its
// release-bound capability before promoting the pending file.
const runtimeClient = clientFor(runtimeUrl);
await runtimeClient.connect();
try {
  const result = await runtimeClient.query(
    `SELECT count(*) = 1 AS capability_visible
       FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
      WHERE capability_id = 'vector_memory_recall'
        AND release_commit = $1`,
    [releaseCommit],
  );
  if (result.rows[0]?.capability_visible !== true) {
    throw new Error("The runtime credential cannot read its release-bound capability.");
  }
} finally {
  await runtimeClient.end();
}

await rename(pendingOutputPath, outputPath);
console.log(`Stage B bootstrap verified. Runtime URL promoted to ${outputPath} (contents not printed).`);
