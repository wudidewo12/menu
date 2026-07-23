import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const { Client } = pg;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const databaseName = requireEnvironmentVariable("POSTGRES_DB");
const ownerRoleName = requireEnvironmentVariable("POSTGRES_OWNER");
const appRoleName = requireEnvironmentVariable("POSTGRES_APP_USER");
const appRolePassword = requireEnvironmentVariable("POSTGRES_APP_PASSWORD");
const adminDatabaseUrl = requireEnvironmentVariable("DATABASE_ADMIN_URL");
const appDatabaseUrl = requireEnvironmentVariable("DATABASE_URL");

if (!/^[a-z][a-z0-9_]*$/.test(databaseName)) {
  throw new Error("POSTGRES_DB must be a lowercase PostgreSQL identifier");
}

if (!/^[a-z][a-z0-9_]*$/.test(ownerRoleName)) {
  throw new Error("POSTGRES_OWNER must be a lowercase PostgreSQL identifier");
}

if (!/^[a-z][a-z0-9_]*$/.test(appRoleName)) {
  throw new Error("POSTGRES_APP_USER must be a lowercase PostgreSQL identifier");
}

if (!/^[0-9a-f]{48}$/.test(appRolePassword)) {
  throw new Error("POSTGRES_APP_PASSWORD must be a 48-character hexadecimal secret");
}

const database = quoteIdentifier(databaseName);
const ownerRole = quoteIdentifier(ownerRoleName);
const appRole = quoteIdentifier(appRoleName);
const appPassword = quoteLiteral(appRolePassword);
const ownerClient = new Client({ connectionString: adminDatabaseUrl });

await ownerClient.connect();

try {
  const identityResult = await ownerClient.query(
    "SELECT current_database() AS database_name, current_user AS role_name",
  );
  const identity = identityResult.rows[0];

  if (identity.database_name !== databaseName || identity.role_name !== ownerRoleName) {
    throw new Error("DATABASE_ADMIN_URL does not match POSTGRES_DB and POSTGRES_OWNER");
  }

  await ownerClient.query("BEGIN");

  const roleResult = await ownerClient.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
    [appRoleName],
  );

  if (roleResult.rows[0].exists) {
    await ownerClient.query(`
      ALTER ROLE ${appRole}
      WITH LOGIN PASSWORD ${appPassword}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
    `);
  } else {
    await ownerClient.query(`
      CREATE ROLE ${appRole}
      WITH LOGIN PASSWORD ${appPassword}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
    `);
  }

  await ownerClient.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM PUBLIC`);
  await ownerClient.query(`GRANT CONNECT ON DATABASE ${database} TO ${ownerRole}, ${appRole}`);
  await ownerClient.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await ownerClient.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${appRole}`);
  await ownerClient.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
  await ownerClient.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`,
  );
  await ownerClient.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`,
  );
  await ownerClient.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}
  `);
  await ownerClient.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appRole}
  `);
  await ownerClient.query(`ALTER ROLE ${appRole} SET search_path TO public`);
  await ownerClient.query("COMMIT");
} catch (error) {
  await ownerClient.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await ownerClient.end();
}

const appClient = new Client({ connectionString: appDatabaseUrl });

await appClient.connect();

try {
  const permissionResult = await appClient.query(`
    SELECT
      current_database() AS database_name,
      current_user AS role_name,
      has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_create_temp,
      has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_schema
  `);
  const permissions = permissionResult.rows[0];

  if (
    permissions.database_name !== databaseName ||
    permissions.role_name !== appRoleName ||
    !permissions.can_connect ||
    permissions.can_create_temp ||
    !permissions.can_use_schema ||
    permissions.can_create_in_schema
  ) {
    throw new Error("The application role permissions do not match the expected policy");
  }

  await appClient.query("BEGIN");
  let tableCreationDenied = false;

  try {
    await appClient.query("CREATE TABLE __menu_app_permission_probe (id integer)");
  } catch (error) {
    if (error.code !== "42501") {
      throw error;
    }

    tableCreationDenied = true;
    console.log("menu_app table creation: denied as expected");
  } finally {
    await appClient.query("ROLLBACK");
  }

  if (!tableCreationDenied) {
    throw new Error("menu_app unexpectedly created a table");
  }

  await appClient.query("BEGIN");
  let temporaryTableCreationDenied = false;

  try {
    await appClient.query("CREATE TEMPORARY TABLE __menu_app_temp_permission_probe (id integer)");
  } catch (error) {
    if (error.code !== "42501") {
      throw error;
    }

    temporaryTableCreationDenied = true;
    console.log("menu_app temporary table creation: denied as expected");
  } finally {
    await appClient.query("ROLLBACK");
  }

  if (!temporaryTableCreationDenied) {
    throw new Error("menu_app unexpectedly created a temporary table");
  }
} finally {
  await appClient.end();
}

console.log(`menu_app connection: passed`);
console.log(`menu_app schema usage: allowed`);
console.log(`menu_app schema creation: denied`);
console.log(`menu_app temporary table creation: denied`);
console.log(`menu_app elevated privileges: disabled`);
