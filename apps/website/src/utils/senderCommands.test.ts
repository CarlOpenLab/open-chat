/// <reference types="vite-plus/test/globals" />

import { formatSkillCommand, skillCommandSyntax } from "./senderCommands";

describe("skill command syntax", () => {
  // 各 CLI 认的唤起写法不同，写错就是用户可见的 "Unknown command" / 技能不生效
  it("maps each agent to the token its CLI actually parses", () => {
    const token = (agentId: string, isOhMyPi = false) =>
      formatSkillCommand(skillCommandSyntax(agentId, isOhMyPi), "show-me");

    expect(token("claude")).toBe("/show-me");
    expect(token("opencode")).toBe("/show-me");
    expect(token("codex")).toBe("$show-me");
    expect(token("pi")).toBe("/skill:show-me");
    expect(token("omp")).toBe("/skill:show-me");
    // 自定义 ACP agent 未知语法时回退到斜杠写法
    expect(token("my-agent")).toBe("/show-me");
  });
});
