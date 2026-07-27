export const TICKET_BRANCH_INITIAL_ASSISTANT_MESSAGE = `<a2ui>
[
  {"version":"v0.9","createSurface":{"surfaceId":"ticket-branch-form-1","catalogId":"local://open-chat/basic"}},
  {"version":"v0.9","updateComponents":{"surfaceId":"ticket-branch-form-1","components":[{"id":"root","component":"Card","title":"生成工单分支","child":"form-content"},{"id":"form-content","component":"Column","gap":14,"children":["form-tip","ticket-id","project-name","submit"]},{"id":"form-tip","component":"Text","text":"填写工单 ID（或链接）和需求标题，系统会自动判断分支类型并生成命令。","variant":"secondary"},{"id":"ticket-id","component":"TextField","label":"工单 ID 或链接 *","placeholder":"例如：123432 或 https://www.teambition.com/task/123432","value":{"path":"/ticketId"}},{"id":"project-name","component":"TextField","label":"需求标题 *","placeholder":"例如：新增组织树筛选功能","value":{"path":"/projectName"}},{"id":"submit-label","component":"Text","text":"生成分支命令"},{"id":"submit","component":"Button","child":"submit-label","variant":"primary","action":{"event":{"name":"generate_ticket_branch","context":{"source":"ticket-branch-form-1","requiredPaths":["/ticketId","/projectName"]}}}}]}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"ticket-branch-form-1","path":"/ticketId","value":""}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"ticket-branch-form-1","path":"/projectName","value":""}}
]
</a2ui>`;
