/** Sender 斜杠指令解析：让输入区的 goal 等指令能以结构化方式发送给模型。 */

export const SENDER_COMMANDS = ["goal", "system", "instruction", "objective", "review"] as const;

export type SenderCommand = (typeof SENDER_COMMANDS)[number];

export interface ParsedSenderCommand {
  command: SenderCommand;
  arg: string;
  raw: string;
}

/** 别名 → 规范指令 */
const COMMAND_ALIASES: Record<string, SenderCommand> = {
  goal: "goal",
  target: "goal",
  objective: "goal",
  system: "system",
  instruction: "instruction",
  instruct: "instruction",
  review: "review",
};

const COMMAND_PATTERN = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/;

export function parseSenderCommand(input: string): ParsedSenderCommand | null {
  const trimmed = input.trimStart();
  const match = trimmed.match(COMMAND_PATTERN);
  if (!match) return null;
  const rawCmd = match[1].toLowerCase();
  const command = COMMAND_ALIASES[rawCmd];
  if (!command) return null;
  const arg = (match[2] ?? "").trim();
  // goal/system/instruction 必须带参数，否则视为普通文本（避免空发送）
  if (!arg) return null;
  return { command, arg, raw: trimmed };
}

/** 将指令参数包装为发送给模型的明文，确保在 user 消息中可被模型识别。 */
export function formatCommandForModel(parsed: ParsedSenderCommand): string {
  switch (parsed.command) {
    case "goal":
      return `🎯 目标指令：${parsed.arg}`;
    case "system":
      // system 指令会走 systemPrompt 通道，这里仅作回退展示
      return `⚙️ 系统指令：${parsed.arg}`;
    case "instruction":
      return `📋 指令：${parsed.arg}`;
    case "review":
      return `🔍 复审指令：${parsed.arg}`;
    default:
      return parsed.arg;
  }
}

/** 是否为需要走独立 goal/system 通道的指令（需要提升为 system 优先级） */
export function isSystemLevelCommand(command: SenderCommand): boolean {
  return (
    command === "goal" || command === "system" || command === "objective" || command === "review"
  );
}

// ============ 快捷指令组件元数据（Oh My Pi 优先） ============
export interface QuickCommandMeta {
  command: SenderCommand;
  label: string;
  description: string;
  icon: string;
  aliases: string[];
  ohMyPiPriority: boolean;
  placeholder: string;
}

export const QUICK_COMMANDS: QuickCommandMeta[] = [
  {
    command: "goal",
    label: "Goal 目标",
    description: "设定任务目标，Oh My Pi 将围绕目标规划执行",
    icon: "🎯",
    aliases: ["target", "objective"],
    ohMyPiPriority: true,
    placeholder: "例如：重构为清晰可维护的架构",
  },
  {
    command: "review",
    label: "Review 复审",
    description: "复审变更，检查代码质量与安全性",
    icon: "🔍",
    aliases: [],
    ohMyPiPriority: true,
    placeholder: "例如：检查本次修改的安全性和边界情况",
  },
  {
    command: "instruction",
    label: "Instruction 指令",
    description: "发送高优指令，模型优先遵循",
    icon: "📋",
    aliases: ["instruct"],
    ohMyPiPriority: false,
    placeholder: "例如：优先保证正确性，再考虑性能",
  },
  {
    command: "system",
    label: "System 系统",
    description: "设置系统提示，影响后续所有回合",
    icon: "⚙️",
    aliases: [],
    ohMyPiPriority: false,
    placeholder: "例如：你是一个资深架构师",
  },
];

export function getQuickCommandsForAgent(isOhMyPi: boolean): QuickCommandMeta[] {
  if (isOhMyPi)
    return [...QUICK_COMMANDS].sort((a, b) => Number(b.ohMyPiPriority) - Number(a.ohMyPiPriority));
  return QUICK_COMMANDS;
}

export function filterQuickCommands(query: string, isOhMyPi: boolean): QuickCommandMeta[] {
  const commands = getQuickCommandsForAgent(isOhMyPi);
  const q = query.trim().toLowerCase().replace(/^\//, "");
  if (!q) return commands;
  return commands.filter(
    (item) =>
      item.command.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}
