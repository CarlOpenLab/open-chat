import { Check, FolderOpen, Trash2, X } from "@lucide/vue";
import type { MenuProps } from "antdv-next";
import { computed, h, toValue, type MaybeRefOrGetter } from "vue";
import { createStyles } from "../theme/antdvStyle";
import {
  normalizeDirectoryPath,
  projectPathName,
  uniqueDirectoryPaths,
} from "../utils/projectPath";

/**
 * 项目目录下拉菜单：空状态欢迎页与输入框底栏共用同一套结构与样式，
 * 避免两处 labelRender / CSS 各自漂移。
 */
const useStyles = createStyles(({ token, css }) => ({
  projectPathMenu: css`
    min-width: 280px;
    max-width: min(420px, calc(100vw - 32px));
    max-height: min(360px, 60vh);
    overflow-y: auto;
    padding: 6px;

    .ant-dropdown-menu-item-content {
      min-width: 0;
    }
    .ant-dropdown-menu-item-divider {
      margin: 4px 0;
    }
    .project-path-menu-row {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 9px;
      padding-left: 2px;
    }
    .project-path-menu-copy {
      display: flex;
      min-width: 0;
      flex: 1;
      flex-direction: column;
      gap: 2px;
    }
    .project-path-menu-name,
    .project-path-menu-location {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .project-path-menu-name {
      color: var(--brand-foreground);
      font-size: 12.5px;
      line-height: 17px;
      font-weight: 500;
    }
    .project-path-menu-location {
      color: var(--brand-muted-strong);
      font-size: 10.5px;
      line-height: 14px;
    }
    .project-path-menu-remove {
      display: grid;
      width: 26px;
      height: 26px;
      flex: none;
      place-items: center;
      border: 0;
      border-radius: 5px;
      padding: 0;
      background: transparent;
      color: var(--brand-muted-strong);
      cursor: pointer;
      opacity: 0.55;
      transition:
        opacity ${token.motionDurationMid} ${token.motionEaseInOut},
        background-color ${token.motionDurationMid} ${token.motionEaseInOut},
        color ${token.motionDurationMid} ${token.motionEaseInOut};
    }
    .project-path-menu-remove:hover,
    .project-path-menu-remove:focus-visible {
      background: var(--brand-danger-subtle);
      color: var(--brand-danger);
      opacity: 1;
      outline: none;
    }
    .project-path-menu-name.is-selected {
      font-weight: 600;
    }
    .project-path-menu-check {
      width: 12px;
      height: 12px;
      flex: none;
      color: var(--brand-accent);
      opacity: 0;
      transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
    }
    .project-path-menu-check.is-visible {
      opacity: 1;
    }
    .project-path-menu-empty {
      display: block;
      padding: 4px 8px;
      color: var(--brand-ghost);
      font-size: 12px;
    }
  `,
}));

export interface ProjectPathMenuSources {
  paths: MaybeRefOrGetter<string[]>;
  currentPath: MaybeRefOrGetter<string>;
}

export interface ProjectPathMenuHandlers {
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
  onPick: () => void;
}

export const useProjectPathMenu = (
  sources: ProjectPathMenuSources,
  handlers: ProjectPathMenuHandlers,
) => {
  const { styles, cx } = useStyles();

  return computed<MenuProps>(() => {
    const paths = uniqueDirectoryPaths(toValue(sources.paths));
    const currentPath = normalizeDirectoryPath(toValue(sources.currentPath));
    const currentIndex = paths.indexOf(currentPath);
    const hasSelection = currentIndex >= 0;

    const pathItems: NonNullable<MenuProps["items"]> = paths.map((path, index) => ({
      key: `__path_${index}__`,
      label: path,
      path,
    }));

    const emptyHint: NonNullable<MenuProps["items"]> =
      paths.length === 0 ? [{ key: "__empty__", label: "暂无历史目录", disabled: true }] : [];

    const clearItem: NonNullable<MenuProps["items"]> = hasSelection
      ? [{ key: "__none__", label: "清除已选目录", icon: h(X) }]
      : [];

    const items: NonNullable<MenuProps["items"]> = [
      ...pathItems,
      ...emptyHint,
      ...(pathItems.length > 0 || emptyHint.length > 0 ? [{ type: "divider" as const }] : []),
      ...clearItem,
      { key: "__pick__", label: "选择其他目录", icon: h(FolderOpen) },
    ];

    return {
      rootClass: cx("project-path-menu", styles.projectPathMenu),
      items,
      selectable: true,
      selectedKeys: hasSelection ? [`__path_${currentIndex}__`] : [],
      labelRender: (item) => {
        if (item.type === "divider") return null;
        if (String(item.key).startsWith("__path_")) {
          const match = String(item.key).match(/^__path_(\d+)__$/);
          const idx = match ? Number(match[1]) : -1;
          const path = idx >= 0 ? paths[idx] : "";
          if (!path) return h("span", null, String(item.label ?? ""));
          const selected = idx === currentIndex;
          return h("div", { class: "project-path-menu-row", title: path }, [
            h(Check, {
              class: ["project-path-menu-check", { "is-visible": selected }],
              size: 14,
              "aria-hidden": "true",
            }),
            h("span", { class: "project-path-menu-copy" }, [
              h(
                "span",
                { class: ["project-path-menu-name", { "is-selected": selected }] },
                projectPathName(path) || "未命名目录",
              ),
              h("span", { class: "project-path-menu-location" }, path),
            ]),
            h(
              "button",
              {
                type: "button",
                class: "project-path-menu-remove",
                title: "从列表移除",
                "aria-label": `从列表移除 ${path}`,
                onClick: (event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handlers.onRemove(path);
                },
              },
              [h(Trash2, { size: 14, "aria-hidden": "true" })],
            ),
          ]);
        }
        if (item.key === "__empty__") {
          return h("span", { class: "project-path-menu-empty" }, String(item.label));
        }
        return null;
      },
      onClick: ({ key }) => {
        if (key === "__none__") {
          handlers.onClear();
          return;
        }
        if (key === "__pick__") {
          handlers.onPick();
          return;
        }
        const match = String(key).match(/^__path_(\d+)__$/);
        const selected = match ? paths[Number(match[1])] : undefined;
        if (selected) handlers.onSelect(selected);
      },
    };
  });
};
