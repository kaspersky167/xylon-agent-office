const RUN_COMMAND_ALLOWLIST: RegExp[] = [
  /^ls(\s|$)/,
  /^cat\s/,
  /^echo\s/,
  /^pwd$/,
  /^git (status|log|diff)(\s|$)/,
  /^docker (ps|images|stats)(\s|$)/,
  /^npm (list|outdated|audit)(\s|$)/,
  /^node -e\s/,
];

const RUN_COMMAND_BLOCKED_PATTERNS: Array<{
  pattern: RegExp;
  reasonCode: string;
  message: string;
}> = [
  {
    pattern: /(^|\s)(rm|mv|cp)\s+(-[A-Za-z]*[rf]|--recursive|--force)/,
    reasonCode: "POLICY_RUN_COMMAND_DESTRUCTIVE",
    message: "Destructive filesystem flags are not permitted.",
  },
  {
    pattern: /(;|&&|\|\||\|)/,
    reasonCode: "POLICY_RUN_COMMAND_CHAINED",
    message: "Command chaining and pipes are not permitted.",
  },
  {
    pattern: /\b(curl|wget)\b/,
    reasonCode: "POLICY_RUN_COMMAND_NETWORK",
    message:
      "Direct network shell commands are blocked; use dedicated tools instead.",
  },
  {
    pattern: /`|\$\(/,
    reasonCode: "POLICY_RUN_COMMAND_SUBSHELL",
    message: "Subshell execution is not permitted.",
  },
  {
    pattern: /(^|\s)sudo(\s|$)/,
    reasonCode: "POLICY_RUN_COMMAND_PRIV_ESC",
    message: "Privilege escalation is not permitted.",
  },
];

const ALL_TOOLS = [
  "code_execute",
  "web_search",
  "write_note",
  "read_file",
  "list_files",
  "stat_file",
  "read_file_chunk",
  "write_file",
  "run_command",
  "check_health",
  "fetch_url",
] as const;

type ToolName = (typeof ALL_TOOLS)[number] | string;

type ToolPermissionSet = "*" | string[];

const ROLE_TOOL_PERMISSIONS: Record<string, ToolPermissionSet> = {
  ceo: "*",
  founder: "*",
  executive: "*",
  developer: [
    "code_execute",
    "write_note",
    "read_file",
    "list_files",
    "stat_file",
    "read_file_chunk",
    "write_file",
    "web_search",
    "fetch_url",
    "check_health",
  ],
  engineer: [
    "code_execute",
    "write_note",
    "read_file",
    "list_files",
    "stat_file",
    "read_file_chunk",
    "write_file",
    "web_search",
    "fetch_url",
    "check_health",
  ],
  analyst: [
    "write_note",
    "read_file",
    "list_files",
    "stat_file",
    "read_file_chunk",
    "web_search",
    "fetch_url",
    "check_health",
  ],
  researcher: [
    "write_note",
    "read_file",
    "list_files",
    "stat_file",
    "read_file_chunk",
    "web_search",
    "fetch_url",
    "check_health",
  ],
  user: ["read_file", "list_files", "stat_file", "read_file_chunk"],
  default: [
    "write_note",
    "read_file",
    "list_files",
    "stat_file",
    "read_file_chunk",
    "web_search",
    "fetch_url",
    "check_health",
  ],
};

const AGENT_TOOL_OVERRIDES: Record<string, ToolPermissionSet> = {
  ceo: "*",
};

export interface ToolExecutionContext {
  actorId?: string;
  actorRole?: string;
  approvalId?: string | null;
}

export interface PolicyDecision {
  allowed: boolean;
  reasonCode?: string;
  message?: string;
}

function isToolAllowed(
  permissionSet: ToolPermissionSet | undefined,
  toolName: string,
): boolean {
  if (!permissionSet) return false;
  if (permissionSet === "*") return true;
  return permissionSet.includes(toolName);
}

export function evaluateToolPolicy(
  toolName: ToolName,
  params: any,
  context?: ToolExecutionContext,
): PolicyDecision {
  const normalizedTool = String(toolName || "").trim();
  const actorId = String(context?.actorId || "")
    .trim()
    .toLowerCase();
  const actorRole = String(context?.actorRole || "default")
    .trim()
    .toLowerCase();

  const agentOverride = actorId ? AGENT_TOOL_OVERRIDES[actorId] : undefined;
  const rolePermissions =
    ROLE_TOOL_PERMISSIONS[actorRole] ?? ROLE_TOOL_PERMISSIONS.default;
  const effectivePermissions = agentOverride ?? rolePermissions;

  if (!isToolAllowed(effectivePermissions, normalizedTool)) {
    return {
      allowed: false,
      reasonCode: "POLICY_TOOL_ROLE_DENY",
      message: `Tool \"${normalizedTool}\" is not permitted for role \"${actorRole}\"${actorId ? ` (actor: ${actorId})` : ""}.`,
    };
  }

  if (normalizedTool === "run_command") {
    const command = String(params?.command || "").trim();
    if (!command) {
      return {
        allowed: false,
        reasonCode: "POLICY_RUN_COMMAND_EMPTY",
        message: "run_command requires a non-empty command.",
      };
    }

    const blocked = RUN_COMMAND_BLOCKED_PATTERNS.find((entry) =>
      entry.pattern.test(command),
    );
    if (blocked) {
      return {
        allowed: false,
        reasonCode: blocked.reasonCode,
        message: `${blocked.message} Command: \"${command}\"`,
      };
    }

    const allowed = RUN_COMMAND_ALLOWLIST.some((pattern) =>
      pattern.test(command),
    );
    if (!allowed) {
      return {
        allowed: false,
        reasonCode: "POLICY_RUN_COMMAND_NOT_ALLOWLISTED",
        message: `Command is not in the approved allowlist: \"${command}\"`,
      };
    }
  }

  return { allowed: true };
}

export const TOOL_POLICY_CONSTANTS = {
  RUN_COMMAND_ALLOWLIST,
  RUN_COMMAND_BLOCKED_PATTERNS,
  ROLE_TOOL_PERMISSIONS,
  AGENT_TOOL_OVERRIDES,
};
