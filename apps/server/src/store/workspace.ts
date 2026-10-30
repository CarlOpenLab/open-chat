/**
 * 工作区存储门面：持有 SQLite 连接，聚合各实体存储，提供概况、导出与关闭。
 * 网关运行时只持有一个实例；测试用 ":memory:" 创建独立实例。
 */
import fs from "node:fs";
import path from "node:path";
import type { WorkspaceInfo, WorkspacePreferences } from "@cc-heart/open-chat-types";
import { dataRootDir } from "../attachments";
import { openDatabase, schemaVersion, type Database } from "../db/database";
import { ConversationStore } from "./conversations";
import { PreferenceStore } from "./preferences";
import { ProjectPathStore } from "./projectPaths";
import { ProviderStore, toProviderView } from "./providers";
import { TaskStore } from "./tasks";

export const DATABASE_FILE_NAME = "open-chat.db";

/**
 * @description 默认数据库位置：数据根目录（`OPEN_CHAT_DATA_DIR` 或 `~/.cc-hearts-open-code`）下的 open-chat.db。
 * @returns {string} 数据库文件绝对路径
 */
export function defaultDatabasePath(): string {
  return path.join(dataRootDir(), DATABASE_FILE_NAME);
}

/** 全量导出（设置页备份）：服务商只含掩码，不导出明文 Key。 */
export interface WorkspaceExport {
  version: 1;
  exportedAt: string;
  tasks: ReturnType<TaskStore["list"]>;
  conversations: ReturnType<ConversationStore["list"]>;
  transcripts: Record<string, unknown[]>;
  providers: ReturnType<typeof toProviderView>[];
  projectPaths: string[];
  preferences: WorkspacePreferences;
}

export class WorkspaceStore {
  readonly tasks: TaskStore;
  readonly conversations: ConversationStore;
  readonly providers: ProviderStore;
  readonly projectPaths: ProjectPathStore;
  readonly preferences: PreferenceStore;

  constructor(
    readonly db: Database,
    readonly databasePath: string,
  ) {
    this.tasks = new TaskStore(db);
    this.conversations = new ConversationStore(db);
    this.providers = new ProviderStore(db);
    this.projectPaths = new ProjectPathStore(db);
    this.preferences = new PreferenceStore(db);
  }

  /**
   * @description 打开（必要时创建并迁移）数据库，返回工作区存储。
   * @param {string} file - 数据库文件路径；":memory:" 用于测试
   * @returns {WorkspaceStore} 可用的存储实例
   */
  static open(file: string = defaultDatabasePath()): WorkspaceStore {
    return new WorkspaceStore(openDatabase(file), file);
  }

  /**
   * @description 数据库概况：路径、文件大小（含 WAL）、schema 版本与各类数据条数。
   * @returns {WorkspaceInfo} 概况
   */
  info(): WorkspaceInfo {
    let sizeBytes = 0;
    if (this.databasePath !== ":memory:") {
      for (const suffix of ["", "-wal"]) {
        try {
          sizeBytes += fs.statSync(`${this.databasePath}${suffix}`).size;
        } catch {
          // WAL 文件在检查点后可能不存在
        }
      }
    }
    return {
      databasePath: this.databasePath,
      sizeBytes,
      schemaVersion: schemaVersion(this.db),
      counts: {
        tasks: this.tasks.count(),
        conversations: this.conversations.count(),
        providers: this.providers.count(),
        projectPaths: this.projectPaths.count(),
      },
    };
  }

  /**
   * @description 导出全部工作区数据（JSON 备份）。
   * @returns {WorkspaceExport} 导出内容
   */
  exportAll(): WorkspaceExport {
    // 备份必须包含已归档会话，否则归档即从备份中消失
    const conversations = this.conversations.list({ includeArchived: true });
    const transcripts: Record<string, unknown[]> = {};
    for (const conversation of conversations) {
      const messages = this.conversations.getTranscript(conversation.key);
      if (messages) transcripts[conversation.key] = messages;
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: this.tasks.list(),
      conversations,
      transcripts,
      providers: this.providers.list().map(toProviderView),
      projectPaths: this.projectPaths.list(),
      preferences: this.preferences.get(),
    };
  }

  /**
   * @description 关闭数据库连接（网关停止时调用）。
   * @returns {void}
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private closed = false;
}
