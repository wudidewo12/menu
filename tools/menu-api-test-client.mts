import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export interface ApiResponse {
  status: number;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  setCookies: string[];
}

export interface RunningServer {
  baseUrl: string;
  process: ChildProcess;
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, process: ChildProcess) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Menu server exited early with code ${process.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // The isolated server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Timed out waiting for the isolated menu server");
}

export async function startServer(
  menuSource: "json" | "database",
  adminPassword: string,
  dataDirectory: string,
  databaseConnection = process.env.DATABASE_URL,
): Promise<RunningServer> {
  const applicationRole = process.env.POSTGRES_APP_USER;
  if (
    menuSource === "database" &&
    (!databaseConnection || !applicationRole)
  ) {
    throw new Error(
      "Database test server requires DATABASE_URL and POSTGRES_APP_USER",
    );
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const childEnvironment = {
    ...process.env,
    ADMIN_PASSWORD: adminPassword,
    APP_ORIGIN: baseUrl,
    DATA_DIR: dataDirectory,
    MENU_READ_SOURCE: menuSource,
    PORT: String(port),
  };

  if (menuSource === "json") {
    delete childEnvironment.DATABASE_URL;
    delete childEnvironment.POSTGRES_APP_USER;
  } else {
    childEnvironment.DATABASE_URL = databaseConnection;
    childEnvironment.POSTGRES_APP_USER = applicationRole;
  }

  delete childEnvironment.DATABASE_ADMIN_URL;
  delete childEnvironment.POSTGRES_OWNER;
  delete childEnvironment.POSTGRES_OWNER_PASSWORD;
  delete childEnvironment.POSTGRES_APP_PASSWORD;

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions=react-server",
      "server.js",
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForHealth(baseUrl, child);
  return {
    baseUrl,
    process: child,
  };
}

export async function stopServer(server: RunningServer | null) {
  if (!server || server.process.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      server.process.kill("SIGKILL");
    }, 5_000);

    server.process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.process.kill("SIGTERM");
  });
}

export async function apiRequest(
  baseUrl: string,
  pathname: string,
  options: {
    method?: string;
    password?: string;
    origin?: string;
    cookie?: string;
    contentType?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (options.password) {
    headers["X-Admin-Password"] = options.password;
  }
  if (options.origin !== undefined) {
    headers.Origin = options.origin;
  }
  if (options.cookie !== undefined) {
    headers.Cookie = options.cookie;
  }
  if (options.body !== undefined || options.rawBody !== undefined) {
    if (options.contentType !== null) {
      headers["Content-Type"] =
        options.contentType ?? "application/json";
    }
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });

  const responseText = await response.text();
  const getSetCookie = (
    response.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;
  const setCookies = getSetCookie
    ? getSetCookie.call(response.headers)
    : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie") as string]
      : [];

  return {
    status: response.status,
    payload: responseText
      ? JSON.parse(responseText) as Record<string, unknown>
      : {},
    headers: Object.fromEntries(response.headers.entries()),
    setCookies,
  };
}

export function uploadedFiles(root: string) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
      } else {
        files.push(path.relative(root, entryPath).split(path.sep).join("/"));
      }
    }
  }

  visit(root);
  return files.sort();
}
