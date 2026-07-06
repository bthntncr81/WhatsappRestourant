#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "ssh2";
import { z } from "zod";

// ── Config ──────────────────────────────────────────────────────────────────
const SSH_CONFIG = {
  host: process.env.SSH_HOST || "91.241.50.211",
  port: parseInt(process.env.SSH_PORT || "22"),
  username: process.env.SSH_USER || "root",
  password: process.env.SSH_PASSWORD || "",
};

const PROJECT_PATH = process.env.PROJECT_PATH || "/opt/whatres";
const API_PORT = process.env.API_PORT || "3000";
const CMD_TIMEOUT = parseInt(process.env.CMD_TIMEOUT || "120000"); // 2 min default

// ── SSH Helper ──────────────────────────────────────────────────────────────
function sshExec(
  command: string,
  timeout = CMD_TIMEOUT
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        conn.end();
        reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
      }
    }, timeout);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          finished = true;
          conn.end();
          return reject(err);
        }
        stream.on("close", (code: number) => {
          if (!finished) {
            clearTimeout(timer);
            finished = true;
            conn.end();
            resolve({ stdout, stderr, code: code ?? 0 });
          }
        });
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });

    conn.on("error", (err) => {
      if (!finished) {
        clearTimeout(timer);
        finished = true;
        reject(err);
      }
    });

    conn.connect({
      host: SSH_CONFIG.host,
      port: SSH_CONFIG.port,
      username: SSH_CONFIG.username,
      password: SSH_CONFIG.password,
      readyTimeout: 10000,
    });
  });
}

async function runOnServer(command: string, timeout?: number): Promise<string> {
  try {
    const result = await sshExec(command, timeout);
    let output = result.stdout;
    if (result.stderr) {
      output += (output ? "\n" : "") + "[stderr] " + result.stderr;
    }
    if (result.code !== 0) {
      output += `\n[exit code: ${result.code}]`;
    }
    return output || "(no output)";
  } catch (err: any) {
    return `[ERROR] ${err.message}`;
  }
}

function cd(cmd: string): string {
  return `cd ${PROJECT_PATH} && ${cmd}`;
}

// ── MCP Server ──────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "whatres",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════════════
// DEPLOYMENT TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "deploy",
  "Full deployment: git pull → pnpm install → build → migrate → pm2 restart",
  {
    skip_install: z
      .boolean()
      .optional()
      .describe("Skip pnpm install step"),
    skip_build: z
      .boolean()
      .optional()
      .describe("Skip build step"),
    skip_migrate: z
      .boolean()
      .optional()
      .describe("Skip database migration step"),
    processes: z
      .string()
      .optional()
      .describe("PM2 processes to restart (default: whatres-api whatres-worker)"),
  },
  async ({ skip_install, skip_build, skip_migrate, processes }) => {
    const procs = processes || "whatres-api whatres-worker";
    const steps: string[] = [];
    const results: string[] = [];

    steps.push("git pull origin main");
    if (!skip_install) steps.push("pnpm install --frozen-lockfile");
    if (!skip_build) steps.push("pnpm build:api && pnpm build:worker");
    if (!skip_migrate)
      steps.push("cd apps/api && npx prisma migrate deploy && cd ../..");
    steps.push(`pm2 restart ${procs}`);
    steps.push("pm2 status");

    for (const step of steps) {
      const timeout = step.includes("install") || step.includes("build")
        ? 300000 // 5 min for install/build
        : CMD_TIMEOUT;
      results.push(`\n▶ ${step}`);
      const output = await runOnServer(cd(step), timeout);
      results.push(output);
    }

    return { content: [{ type: "text", text: results.join("\n") }] };
  }
);

server.tool(
  "deploy_quick",
  "Quick deploy: git pull → pm2 restart (no build/install)",
  {
    processes: z
      .string()
      .optional()
      .describe("PM2 processes to restart (default: whatres-api whatres-worker)"),
  },
  async ({ processes }) => {
    const procs = processes || "whatres-api whatres-worker";
    const commands = [
      "git pull origin main",
      `pm2 restart ${procs}`,
      "pm2 status",
    ];
    const results: string[] = [];

    for (const cmd of commands) {
      results.push(`\n▶ ${cmd}`);
      results.push(await runOnServer(cd(cmd)));
    }

    return { content: [{ type: "text", text: results.join("\n") }] };
  }
);

server.tool(
  "deploy_web",
  "Deploy only the web frontend: git pull → build:web → restart web",
  {},
  async () => {
    const commands = [
      "git pull origin main",
      "pnpm build:web",
      "pm2 restart whatres-web || true",
      "pm2 status",
    ];
    const results: string[] = [];

    for (const cmd of commands) {
      results.push(`\n▶ ${cmd}`);
      results.push(await runOnServer(cd(cmd), 300000));
    }

    return { content: [{ type: "text", text: results.join("\n") }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// PM2 / SERVER MANAGEMENT TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "pm2_status",
  "Show PM2 process list and status",
  {},
  async () => {
    const output = await runOnServer("pm2 jlist 2>/dev/null || pm2 list");
    // Try to parse JSON for better formatting
    try {
      const procs = JSON.parse(output);
      const formatted = procs.map((p: any) => ({
        name: p.name,
        status: p.pm2_env?.status,
        pid: p.pid,
        cpu: `${p.monit?.cpu || 0}%`,
        memory: `${Math.round((p.monit?.memory || 0) / 1024 / 1024)}MB`,
        uptime: p.pm2_env?.pm_uptime
          ? `${Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000 / 60)}min`
          : "N/A",
        restarts: p.pm2_env?.restart_time || 0,
      }));
      return {
        content: [
          {
            type: "text",
            text: "PM2 Processes:\n" + JSON.stringify(formatted, null, 2),
          },
        ],
      };
    } catch {
      return { content: [{ type: "text", text: output }] };
    }
  }
);

server.tool(
  "pm2_restart",
  "Restart PM2 process(es)",
  {
    process: z
      .string()
      .describe("Process name: whatres-api, whatres-web, whatres-worker, or 'all'"),
  },
  async ({ process: proc }) => {
    const cmd = proc === "all" ? "pm2 restart all" : `pm2 restart ${proc}`;
    const output = await runOnServer(`${cmd} && pm2 status`);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "pm2_stop",
  "Stop a PM2 process",
  {
    process: z
      .string()
      .describe("Process name: whatres-api, whatres-web, whatres-worker, or 'all'"),
  },
  async ({ process: proc }) => {
    const cmd = proc === "all" ? "pm2 stop all" : `pm2 stop ${proc}`;
    const output = await runOnServer(`${cmd} && pm2 status`);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "pm2_logs",
  "View PM2 logs for a process",
  {
    process: z
      .string()
      .optional()
      .describe("Process name (default: all)"),
    lines: z
      .number()
      .optional()
      .describe("Number of lines to show (default: 50)"),
    error_only: z
      .boolean()
      .optional()
      .describe("Show only error logs"),
  },
  async ({ process: proc, lines, error_only }) => {
    const n = lines || 50;
    const procName = proc || "all";
    const errFlag = error_only ? "--err" : "";
    const output = await runOnServer(
      `pm2 logs ${procName} --nostream --lines ${n} ${errFlag} 2>&1`
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "server_resources",
  "Show server resource usage: CPU, memory, disk, uptime",
  {},
  async () => {
    const commands = [
      "echo '=== UPTIME ===' && uptime",
      "echo '=== MEMORY ===' && free -h",
      "echo '=== DISK ===' && df -h / /opt",
      "echo '=== CPU ===' && top -bn1 | head -5",
      "echo '=== NODE ===' && node --version",
      "echo '=== PM2 ===' && pm2 list",
    ];
    const output = await runOnServer(commands.join(" && "));
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "db_migrate",
  "Run Prisma migrations on the server (prisma migrate deploy)",
  {},
  async () => {
    const output = await runOnServer(
      cd("cd apps/api && npx prisma migrate deploy"),
      120000
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "db_status",
  "Check database migration status and connection",
  {},
  async () => {
    const output = await runOnServer(
      cd("cd apps/api && npx prisma migrate status 2>&1")
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "db_backup",
  "Backup PostgreSQL database to a file on the server",
  {
    filename: z
      .string()
      .optional()
      .describe("Backup filename (default: auto-generated with timestamp)"),
  },
  async ({ filename }) => {
    const fname =
      filename || `whatres_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
    const backupPath = `/opt/backups/${fname}`;
    const commands = [
      "mkdir -p /opt/backups",
      `source ${PROJECT_PATH}/.env && pg_dump "$DATABASE_URL" > ${backupPath}`,
      `ls -lh ${backupPath}`,
      "echo 'Backup completed successfully'",
    ];
    const output = await runOnServer(commands.join(" && "), 300000);
    return { content: [{ type: "text", text: `Backup: ${backupPath}\n${output}` }] };
  }
);

server.tool(
  "db_query",
  "Run a read-only SQL query on the database (SELECT only)",
  {
    query: z.string().describe("SQL SELECT query to execute"),
  },
  async ({ query }) => {
    const trimmed = query.trim().toUpperCase();
    if (
      !trimmed.startsWith("SELECT") &&
      !trimmed.startsWith("\\D") &&
      !trimmed.startsWith("WITH")
    ) {
      return {
        content: [
          {
            type: "text",
            text: "[BLOCKED] Only SELECT/WITH queries are allowed for safety. Use db_exec for other operations.",
          },
        ],
      };
    }
    const escaped = query.replace(/'/g, "'\\''");
    const output = await runOnServer(
      `source ${PROJECT_PATH}/.env && psql "$DATABASE_URL" -c '${escaped}'`,
      30000
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "db_exec",
  "Run any SQL statement on the database (INSERT, UPDATE, DELETE, ALTER, etc.) - USE WITH CAUTION",
  {
    query: z.string().describe("SQL statement to execute"),
  },
  async ({ query }) => {
    const escaped = query.replace(/'/g, "'\\''");
    const output = await runOnServer(
      `source ${PROJECT_PATH}/.env && psql "$DATABASE_URL" -c '${escaped}'`,
      30000
    );
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH & MONITORING TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "health_check",
  "Check the API health endpoint and response time",
  {},
  async () => {
    const output = await runOnServer(
      `curl -s -w '\\n--- Response time: %{time_total}s, HTTP %{http_code} ---' http://localhost:${API_PORT}/api/health`,
      10000
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "api_test",
  "Test any API endpoint on the server",
  {
    method: z
      .enum(["GET", "POST", "PATCH", "PUT", "DELETE"])
      .optional()
      .describe("HTTP method (default: GET)"),
    path: z.string().describe("API path (e.g., /api/health)"),
    body: z.string().optional().describe("JSON request body"),
    token: z.string().optional().describe("JWT Bearer token"),
    tenant_id: z.string().optional().describe("X-Tenant-ID header value"),
  },
  async ({ method, path, body, token, tenant_id }) => {
    const m = method || "GET";
    let curlCmd = `curl -s -w '\\nHTTP %{http_code} - %{time_total}s' -X ${m}`;
    curlCmd += ` -H 'Content-Type: application/json'`;
    if (token) curlCmd += ` -H 'Authorization: Bearer ${token}'`;
    if (tenant_id) curlCmd += ` -H 'X-Tenant-ID: ${tenant_id}'`;
    if (body) curlCmd += ` -d '${body.replace(/'/g, "'\\''")}'`;
    curlCmd += ` http://localhost:${API_PORT}${path}`;

    const output = await runOnServer(curlCmd, 15000);
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// NGINX TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "nginx_status",
  "Check nginx status and configuration",
  {},
  async () => {
    const commands = [
      "echo '=== NGINX STATUS ===' && systemctl status nginx --no-pager -l 2>&1 | head -15",
      "echo '=== NGINX CONFIG TEST ===' && nginx -t 2>&1",
      "echo '=== SITES ENABLED ===' && ls -la /etc/nginx/sites-enabled/ 2>/dev/null || ls -la /etc/nginx/conf.d/ 2>/dev/null",
    ];
    const output = await runOnServer(commands.join(" ; "));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "nginx_config",
  "View nginx configuration for this project",
  {
    config_file: z
      .string()
      .optional()
      .describe("Specific config file name (default: auto-detect whatres config)"),
  },
  async ({ config_file }) => {
    let cmd: string;
    if (config_file) {
      cmd = `cat /etc/nginx/sites-available/${config_file} 2>/dev/null || cat /etc/nginx/conf.d/${config_file} 2>/dev/null || echo 'Config file not found'`;
    } else {
      cmd = `grep -rl 'whatres\\|${API_PORT}' /etc/nginx/sites-available/ /etc/nginx/conf.d/ 2>/dev/null | head -3 | xargs -I{} sh -c 'echo "=== {} ===" && cat {}'`;
    }
    const output = await runOnServer(cmd);
    return { content: [{ type: "text", text: output || "No nginx config found for this project" }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENT TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "env_view",
  "View .env file on the server (sensitive values masked)",
  {},
  async () => {
    const output = await runOnServer(
      cd(
        `cat .env | sed -E 's/(PASSWORD|SECRET|KEY|TOKEN|ENCRYPTION)=(.{4}).*/\\1=\\2***MASKED***/I'`
      )
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "env_update",
  "Update a single .env variable on the server",
  {
    key: z.string().describe("Environment variable name"),
    value: z.string().describe("New value"),
  },
  async ({ key, value }) => {
    const escaped = value.replace(/'/g, "'\\''").replace(/"/g, '\\"');
    const cmd = cd(
      `grep -q '^${key}=' .env && sed -i 's|^${key}=.*|${key}=${escaped}|' .env || echo '${key}=${escaped}' >> .env`
    );
    const output = await runOnServer(cmd);
    const verify = await runOnServer(cd(`grep '^${key}=' .env`));
    return {
      content: [
        {
          type: "text",
          text: `Updated ${key} on server.\nVerification: ${verify}${output ? "\n" + output : ""}`,
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// GENERAL SSH TOOL
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "ssh_exec",
  "Execute any command on the server via SSH",
  {
    command: z.string().describe("Shell command to execute"),
    working_dir: z
      .string()
      .optional()
      .describe("Working directory (default: project path)"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 120000)"),
  },
  async ({ command, working_dir, timeout }) => {
    const dir = working_dir || PROJECT_PATH;
    const output = await runOnServer(`cd ${dir} && ${command}`, timeout || CMD_TIMEOUT);
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// GIT TOOLS (on server)
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "git_status",
  "Show git status on the server",
  {},
  async () => {
    const output = await runOnServer(
      cd("git status && echo '---' && git log --oneline -5")
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "git_log",
  "Show git log on the server",
  {
    count: z.number().optional().describe("Number of commits to show (default: 10)"),
    search: z.string().optional().describe("Search term in commit messages"),
  },
  async ({ count, search }) => {
    const n = count || 10;
    let cmd = `git log --oneline -${n}`;
    if (search) cmd += ` --grep="${search}" -i`;
    const output = await runOnServer(cd(cmd));
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// FILE TOOLS (on server)
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "server_file_read",
  "Read a file on the server",
  {
    path: z.string().describe("File path (relative to project or absolute)"),
    lines: z.number().optional().describe("Number of lines to read (default: all)"),
  },
  async ({ path, lines }) => {
    const filePath = path.startsWith("/") ? path : `${PROJECT_PATH}/${path}`;
    const cmd = lines ? `head -n ${lines} ${filePath}` : `cat ${filePath}`;
    const output = await runOnServer(cmd);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "server_file_write",
  "Write content to a file on the server",
  {
    path: z.string().describe("File path (relative to project or absolute)"),
    content: z.string().describe("File content to write"),
  },
  async ({ path, content }) => {
    const filePath = path.startsWith("/") ? path : `${PROJECT_PATH}/${path}`;
    const escaped = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
    const output = await runOnServer(`cat > ${filePath} << 'WHATRES_EOF'\n${escaped}\nWHATRES_EOF`);
    const verify = await runOnServer(`wc -l ${filePath} && ls -lh ${filePath}`);
    return {
      content: [
        {
          type: "text",
          text: `File written: ${filePath}\n${verify}${output ? "\n" + output : ""}`,
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// REDIS TOOLS
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "redis_info",
  "Show Redis server info and memory usage",
  {},
  async () => {
    const output = await runOnServer(
      "redis-cli info memory 2>/dev/null | head -15 && echo '---' && redis-cli info keyspace 2>/dev/null"
    );
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "redis_exec",
  "Execute a Redis CLI command",
  {
    command: z.string().describe("Redis CLI command (e.g., 'keys *', 'get mykey', 'dbsize')"),
  },
  async ({ command }) => {
    const output = await runOnServer(`redis-cli ${command} 2>&1`);
    return { content: [{ type: "text", text: output }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCES (Context Information)
// ═══════════════════════════════════════════════════════════════════════════

server.resource("project-info", "whatres://project-info", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/plain",
      text: [
        "WhatRes - WhatsApp Restaurant Management Platform",
        `Server: ${SSH_CONFIG.host}`,
        `Project Path: ${PROJECT_PATH}`,
        `API Port: ${API_PORT}`,
        "",
        "PM2 Processes: whatres-api, whatres-web, whatres-worker",
        "",
        "Deploy Commands:",
        "  Full: deploy (pull → install → build → migrate → restart)",
        "  Quick: deploy_quick (pull → restart)",
        "  Web only: deploy_web (pull → build:web → restart web)",
        "",
        "Key Paths on Server:",
        `  Project: ${PROJECT_PATH}`,
        `  Env: ${PROJECT_PATH}/.env`,
        "  Backups: /opt/backups/",
        "  Nginx: /etc/nginx/sites-available/",
        "  PM2 logs: ~/.pm2/logs/",
      ].join("\n"),
    },
  ],
}));

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server failed to start:", err);
  process.exit(1);
});
