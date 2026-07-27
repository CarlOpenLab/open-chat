import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  MEETING_COPILOT_SYSTEM_PROMPT,
  PRODUCT_STRATEGIST_SYSTEM_PROMPT,
  RESEARCH_ANALYST_SYSTEM_PROMPT,
  WRITING_EDITOR_SYSTEM_PROMPT,
} from "./prompts/officialAssistants";
import { createTicketBranchSystemPrompt } from "./prompts/ticketBranch";
import { TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE } from "./surfaces/ticketBranchForm";
import type {
  AssistantCategory,
  AssistantConversationSnapshot,
  AssistantDefinition,
} from "./types";

export const ASSISTANT_CATEGORIES: Array<"全部" | AssistantCategory> = [
  "全部",
  "开发",
  "产品",
  "写作",
  "研究",
  "效率",
];

export const OFFICIAL_ASSISTANTS: AssistantDefinition[] = [
  {
    id: "official-ticket-branch",
    slug: "ticket-branch",
    name: "工单分支助手",
    tagline: "把工单信息转换成一致、可追踪的 Git 分支名称。",
    description:
      "通过交互式表单收集工单 ID（或链接）与需求标题，生成符合团队约定的分支建议，并保留清晰的命名解释。适合研发团队日常开工和分支治理。",
    category: "开发",
    tags: ["Git", "工单", "A2UI"],
    author: "Open Chat",
    icon: "branch",
    versionId: "ticket-branch-v3",
    version: "1.2.0",
    updatedAt: "2026-07-27",
    capabilities: ["a2ui"],
    starterPrompts: [
      {
        id: "start-ticket-flow",
        label: "生成工单分支",
        description: "填写工单 ID（或链接）和需求标题",
        prompt: "",
      },
      {
        id: "branch-rules",
        label: "解释命名规则",
        description: "了解分支名称如何生成",
        prompt: "先简要解释你采用的工单分支命名规则，再询问我需要的信息。",
      },
      {
        id: "batch-branches",
        label: "批量整理分支",
        description: "为多个工单设计一致命名",
        prompt: "我有多个工单，请先告诉我批量生成分支名称需要提供哪些信息。",
      },
    ],
    systemPrompt: () => createTicketBranchSystemPrompt(),
    initialAssistantMessage: TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE,
    featured: true,
    rating: 4.9,
    installCount: 1280,
  },
  {
    id: "official-code-reviewer",
    slug: "code-reviewer",
    name: "代码审查专家",
    tagline: "优先发现真实缺陷，并给出可以直接执行的改进建议。",
    description:
      "面向工程团队的严格代码审查助手。关注正确性、回归风险、安全、性能和测试缺口，按严重程度组织结论，避免泛泛而谈。",
    category: "开发",
    tags: ["Code Review", "质量", "安全"],
    author: "Open Chat",
    icon: "code",
    versionId: "code-reviewer-v1",
    version: "1.0.0",
    updatedAt: "2026-07-27",
    capabilities: ["files"],
    starterPrompts: [
      {
        id: "review-change",
        label: "审查一段改动",
        description: "按严重程度列出问题",
        prompt: "请审查我接下来提供的代码改动，优先指出会导致错误或回归的问题。",
      },
      {
        id: "review-security",
        label: "检查安全风险",
        description: "聚焦输入、权限与敏感数据",
        prompt: "请从安全角度审查代码，重点检查输入验证、权限边界和敏感数据处理。",
      },
      {
        id: "review-tests",
        label: "寻找测试缺口",
        description: "补齐最有价值的测试场景",
        prompt: "请分析这段实现最可能遗漏的测试场景，并按风险排序。",
      },
    ],
    systemPrompt: CODE_REVIEWER_SYSTEM_PROMPT,
    featured: true,
    rating: 4.8,
    installCount: 2640,
  },
  {
    id: "official-product-strategist",
    slug: "product-strategist",
    name: "产品策略顾问",
    tagline: "把模糊想法整理成目标、范围、权衡和下一步。",
    description:
      "适合需求澄清、MVP 定义和方案评审。会先识别真正的用户问题，再组织目标、非目标、约束、风险和可验证的成功标准。",
    category: "产品",
    tags: ["产品设计", "MVP", "需求分析"],
    author: "Open Chat",
    icon: "product",
    versionId: "product-strategist-v1",
    version: "1.0.0",
    updatedAt: "2026-07-27",
    capabilities: [],
    starterPrompts: [
      {
        id: "shape-idea",
        label: "梳理一个想法",
        description: "形成目标、范围和下一步",
        prompt: "帮我把这个想法整理成目标、用户问题、范围、非目标和下一步行动。",
      },
      {
        id: "define-mvp",
        label: "定义 MVP",
        description: "找到最小可验证版本",
        prompt: "请通过提问帮我定义这个产品的 MVP，并说明暂时不应该做什么。",
      },
      {
        id: "challenge-plan",
        label: "挑战产品方案",
        description: "发现关键假设和风险",
        prompt: "请审视我的产品方案，找出最脆弱的三个假设以及验证方式。",
      },
    ],
    systemPrompt: PRODUCT_STRATEGIST_SYSTEM_PROMPT,
    featured: true,
    rating: 4.9,
    installCount: 3180,
  },
  {
    id: "official-writing-editor",
    slug: "writing-editor",
    name: "专业写作编辑",
    tagline: "保留原意和个人声音，让表达更清楚、更可信。",
    description:
      "适合邮件、文档、公告和长文编辑。默认先诊断目标与受众，再改善结构、措辞和节奏，并解释关键修改。",
    category: "写作",
    tags: ["编辑", "商务写作", "润色"],
    author: "Open Chat",
    icon: "edit",
    versionId: "writing-editor-v1",
    version: "1.0.0",
    updatedAt: "2026-07-27",
    capabilities: ["files"],
    starterPrompts: [
      {
        id: "polish-copy",
        label: "润色一段文字",
        description: "提升清晰度而不改变原意",
        prompt: "请润色我接下来提供的文字，保留原意和语气，重点改善清晰度与节奏。",
      },
      {
        id: "rewrite-email",
        label: "重写商务邮件",
        description: "直接、礼貌、有行动指向",
        prompt: "请把这封邮件改得更简洁专业，并让下一步行动更明确。",
      },
      {
        id: "diagnose-writing",
        label: "诊断表达问题",
        description: "先指出问题，再给修改稿",
        prompt: "请先指出这段文字最影响理解的三个问题，然后提供修改版本。",
      },
    ],
    systemPrompt: WRITING_EDITOR_SYSTEM_PROMPT,
    rating: 4.7,
    installCount: 1940,
  },
  {
    id: "official-research-analyst",
    slug: "research-analyst",
    name: "研究分析师",
    tagline: "检索、核对并综合信息，明确证据与不确定性。",
    description:
      "用于市场研究、竞品梳理和事实核查。启用联网搜索后，会优先使用可靠来源，区分事实、推断与未知，并给出可追溯结论。",
    category: "研究",
    tags: ["联网搜索", "事实核查", "竞品"],
    author: "Open Chat",
    icon: "research",
    versionId: "research-analyst-v1",
    version: "1.0.0",
    updatedAt: "2026-07-27",
    capabilities: ["web-search"],
    starterPrompts: [
      {
        id: "research-topic",
        label: "研究一个主题",
        description: "建立有来源的事实框架",
        prompt: "请研究我接下来提供的主题，先确认范围，再给出带来源的综合结论。",
      },
      {
        id: "compare-products",
        label: "对比竞品",
        description: "基于统一维度进行比较",
        prompt: "请帮我设计一套竞品比较框架，然后联网收集并核对公开信息。",
      },
      {
        id: "fact-check",
        label: "核查一项说法",
        description: "区分证据、推断和未知",
        prompt: "请核查我接下来提供的说法，说明支持证据、反证和仍不确定的部分。",
      },
    ],
    systemPrompt: RESEARCH_ANALYST_SYSTEM_PROMPT,
    rating: 4.8,
    installCount: 2230,
  },
  {
    id: "official-meeting-copilot",
    slug: "meeting-copilot",
    name: "会议行动助手",
    tagline: "从杂乱记录中提炼决定、负责人、截止时间和风险。",
    description:
      "把会议记录转成可执行的决策与行动清单，明确负责人和期限，对未达成共识或缺少信息的部分进行标记。",
    category: "效率",
    tags: ["会议纪要", "行动项", "决策"],
    author: "Open Chat",
    icon: "meeting",
    versionId: "meeting-copilot-v1",
    version: "1.0.0",
    updatedAt: "2026-07-27",
    capabilities: ["files"],
    starterPrompts: [
      {
        id: "summarize-meeting",
        label: "整理会议记录",
        description: "提取决定、行动和待确认项",
        prompt: "请把我接下来提供的会议记录整理成决定、行动项、负责人、截止时间和待确认问题。",
      },
      {
        id: "prepare-agenda",
        label: "准备会议议程",
        description: "围绕需要达成的决定设计",
        prompt: "请根据我的会议目标设计一份紧凑议程，明确每一部分要达成的结果。",
      },
      {
        id: "follow-up-note",
        label: "生成会后同步",
        description: "输出适合直接发送的简报",
        prompt: "请把会议内容整理成一封简洁的会后同步，突出决定和下一步。",
      },
    ],
    systemPrompt: MEETING_COPILOT_SYSTEM_PROMPT,
    rating: 4.6,
    installCount: 860,
  },
];

export const createCustomAssistantDefinition = (input: {
  name: string;
  tagline: string;
  description: string;
  category: AssistantCategory;
  systemPrompt: string;
  capabilities: AssistantDefinition["capabilities"];
  starterPrompts?: AssistantDefinition["starterPrompts"];
  initialAssistantMessage?: string;
  icon?: AssistantDefinition["icon"];
  tags?: string[];
  forkedFromAssistantId?: string;
}): AssistantDefinition => {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const slug = id;
  return {
    id,
    slug,
    name: input.name.trim(),
    tagline: input.tagline.trim() || "你的私人 AI 助手。",
    description: input.description.trim() || input.tagline.trim() || "为你定制的私人 AI 助手。",
    category: input.category,
    tags: input.tags?.length ? [...input.tags] : ["私人助手", input.category],
    author: "仅自己可见",
    icon: input.icon ?? "product",
    versionId: `${id}-v1`,
    version: "1.0.0",
    updatedAt: new Date().toISOString().slice(0, 10),
    capabilities: [...input.capabilities],
    starterPrompts: input.starterPrompts?.length
      ? input.starterPrompts.map((prompt) => ({ ...prompt }))
      : [
          {
            id: `${id}-starter`,
            label: "开始使用",
            description: "告诉助手你想完成什么",
            prompt: "请介绍你能如何帮助我，并告诉我开始时需要提供哪些信息。",
          },
        ],
    systemPrompt: input.systemPrompt.trim(),
    ...(input.initialAssistantMessage?.trim()
      ? { initialAssistantMessage: input.initialAssistantMessage.trim() }
      : {}),
    source: "custom",
    ...(input.forkedFromAssistantId ? { forkedFromAssistantId: input.forkedFromAssistantId } : {}),
    rating: 0,
    installCount: 0,
  };
};

export function getAssistantById(id: string): AssistantDefinition | undefined {
  return OFFICIAL_ASSISTANTS.find((assistant) => assistant.id === id);
}

export function getAssistantBySlug(slug: string): AssistantDefinition | undefined {
  return OFFICIAL_ASSISTANTS.find((assistant) => assistant.slug === slug);
}

export function createAssistantConversationSnapshot(
  assistant: AssistantDefinition,
): AssistantConversationSnapshot {
  return {
    assistantId: assistant.id,
    slug: assistant.slug,
    name: assistant.name,
    icon: assistant.icon,
    versionId: assistant.versionId,
    version: assistant.version,
    capabilities: [...assistant.capabilities],
    starterPrompts: assistant.starterPrompts.map((prompt) => ({ ...prompt })),
    renderedSystemPrompt:
      typeof assistant.systemPrompt === "function"
        ? assistant.systemPrompt().trim()
        : assistant.systemPrompt.trim(),
    ...(assistant.initialAssistantMessage?.trim()
      ? { initialAssistantMessage: assistant.initialAssistantMessage.trim() }
      : {}),
  };
}
