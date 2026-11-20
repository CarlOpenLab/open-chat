package host

import (
	"context"
	"fmt"
	"os"
	"time"
)

func auSupportedInstallChannels(agent auAgentSpec, avail map[AgentUpdateChannel]bool) []AgentUpdateChannel {
	order := []AgentUpdateChannel{auChannelMise, auChannelNpm, auChannelPnpm, auChannelBun, auChannelBrew}
	var out []AgentUpdateChannel
	for _, ch := range order {
		if !avail[ch] {
			continue
		}
		switch ch {
		case auChannelMise:
			if len(agent.MiseTools) > 0 {
				out = append(out, ch)
			}
		case auChannelNpm, auChannelPnpm, auChannelBun:
			if agent.NpmPackage != "" {
				out = append(out, ch)
			}
		case auChannelBrew:
			if agent.BrewCask != "" {
				out = append(out, ch)
			}
		}
	}
	return out
}

func auBuildInstallCommand(agent auAgentSpec, channel AgentUpdateChannel) ([]string, error) {
	switch channel {
	case auChannelMise:
		if len(agent.MiseTools) == 0 {
			return nil, fmt.Errorf("%s 不支持通过 mise 安装", agent.Name)
		}
		return []string{"mise", "use", "-g", agent.MiseTools[0] + "@latest"}, nil
	case auChannelNpm:
		if agent.NpmPackage == "" {
			return nil, fmt.Errorf("%s 不支持通过 npm 安装", agent.Name)
		}
		return []string{"npm", "install", "-g", agent.NpmPackage + "@latest"}, nil
	case auChannelPnpm:
		if agent.NpmPackage == "" {
			return nil, fmt.Errorf("%s 不支持通过 pnpm 安装", agent.Name)
		}
		return []string{"pnpm", "add", "-g", agent.NpmPackage + "@latest"}, nil
	case auChannelBun:
		if agent.NpmPackage == "" {
			return nil, fmt.Errorf("%s 不支持通过 bun 安装", agent.Name)
		}
		return []string{"bun", "add", "-g", agent.NpmPackage + "@latest"}, nil
	case auChannelBrew:
		if agent.BrewCask == "" {
			return nil, fmt.Errorf("%s 不支持通过 Homebrew 安装", agent.Name)
		}
		return []string{"brew", "install", "--cask", agent.BrewCask}, nil
	default:
		return nil, fmt.Errorf("不支持的安装渠道：%s", channel)
	}
}

func auInstall(
	ctx context.Context,
	env []string,
	agentID string,
	channel AgentUpdateChannel,
	onProgress func(AgentUpdateProgress),
) (*AgentUpdateResult, error) {
	emit := func(p AgentUpdateProgress) {
		if onProgress != nil {
			onProgress(p)
		}
	}
	spec, ok := auMatchAgent(auDefaultAgents(), agentID)
	if !ok {
		return nil, fmt.Errorf("未找到匹配的 agent：%s", agentID)
	}
	home, _ := os.UserHomeDir()
	mise := auDiscoverMise(env, home)
	avail := map[AgentUpdateChannel]bool{
		auChannelMise: mise != nil,
		auChannelNpm:  lookPath(env, "npm") != "",
		auChannelPnpm: lookPath(env, "pnpm") != "",
		auChannelBun:  lookPath(env, "bun") != "",
		auChannelBrew: lookPath(env, "brew") != "",
	}
	if !avail[channel] {
		return nil, fmt.Errorf("当前环境未检测到 %s，无法使用该方式安装", channel)
	}
	argv, err := auBuildInstallCommand(spec, channel)
	if err != nil {
		return nil, err
	}

	emit(AgentUpdateProgress{
		Stage:     "installing",
		AgentID:   spec.ID,
		AgentName: spec.Name,
		Completed: 0,
		Total:     1,
		Percent:   25,
		Message:   fmt.Sprintf("正在通过 %s 安装 %s…", channel, spec.Name),
	})

	res := auRunCmd(ctx, env, home, 10*time.Minute, argv)
	if res.Code != 0 {
		msg := auFirstNonEmptyLine(res.Stderr)
		if msg == "" {
			msg = auFirstNonEmptyLine(res.Stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("退出码 %d", res.Code)
		}
		return nil, fmt.Errorf("安装 %s 失败：%s", spec.Name, msg)
	}

	if channel == auChannelMise && mise != nil {
		emit(AgentUpdateProgress{
			Stage:     "reshim",
			AgentID:   spec.ID,
			AgentName: spec.Name,
			Completed: 0,
			Total:     1,
			Percent:   80,
			Message:   "正在刷新 mise shims…",
		})
		_ = mise.reshim(ctx)
	}

	emit(AgentUpdateProgress{
		Stage:     "verifying",
		AgentID:   spec.ID,
		AgentName: spec.Name,
		Completed: 0,
		Total:     1,
		Percent:   90,
		Message:   fmt.Sprintf("正在验证 %s 安装结果…", spec.Name),
	})

	return &AgentUpdateResult{
		ID:      spec.ID,
		Agent:   spec.Name,
		Bin:     spec.Bin,
		Status:  auStatusUpToDate,
		Channel: channel,
	}, nil
}

func auUninstall(
	ctx context.Context,
	env []string,
	agentID string,
	onProgress func(AgentUpdateProgress),
) (*AgentUpdateResult, error) {
	emit := func(p AgentUpdateProgress) {
		if onProgress != nil {
			onProgress(p)
		}
	}
	spec, ok := auMatchAgent(auDefaultAgents(), agentID)
	if !ok {
		return nil, fmt.Errorf("未找到匹配的 agent：%s", agentID)
	}

	emit(AgentUpdateProgress{
		Stage:     "uninstalling",
		AgentID:   spec.ID,
		AgentName: spec.Name,
		Completed: 0,
		Total:     1,
		Percent:   15,
		Message:   fmt.Sprintf("正在识别 %s 的安装渠道…", spec.Name),
	})

	report, mise, err := auInspectWithEnv(ctx, env, AgentUpdateOptions{Only: []string{spec.ID}})
	if err != nil {
		return nil, err
	}
	if len(report.Results) == 0 || report.Results[0].Status == auStatusNotInstalled {
		return nil, fmt.Errorf("%s 当前未安装", spec.Name)
	}
	cur := report.Results[0]
	if !cur.CanUninstall {
		return nil, fmt.Errorf("%s 当前渠道（%s）不支持自动卸载，请手动处理", spec.Name, cur.Channel)
	}

	home, _ := os.UserHomeDir()
	emit(AgentUpdateProgress{
		Stage:     "uninstalling",
		AgentID:   spec.ID,
		AgentName: spec.Name,
		Completed: 0,
		Total:     1,
		Percent:   40,
		Message:   fmt.Sprintf("正在通过 %s 卸载 %s…", cur.Channel, spec.Name),
	})

	var res auRunResult
	switch cur.Channel {
	case auChannelMise:
		tool := cur.miseTool
		if tool == "" {
			tool = cur.Identity
		}
		// Remove from global mise config first, then uninstall installed versions.
		_ = auRunCmd(ctx, env, home, 2*time.Minute, []string{"mise", "unuse", "-g", tool})
		res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"mise", "uninstall", tool})
		if mise != nil {
			_ = mise.reshim(ctx)
		}
	case auChannelNpm:
		pkg := spec.NpmPackage
		if pkg == "" {
			pkg = cur.Identity
		}
		res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"npm", "uninstall", "-g", pkg})
	case auChannelPnpm:
		pkg := spec.NpmPackage
		if pkg == "" {
			pkg = cur.Identity
		}
		res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"pnpm", "remove", "-g", pkg})
	case auChannelBun:
		pkg := spec.NpmPackage
		if pkg == "" {
			pkg = cur.Identity
		}
		res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"bun", "remove", "-g", pkg})
	case auChannelBrew:
		if cur.brewKind == "cask" {
			res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"brew", "uninstall", "--cask", cur.Identity})
		} else {
			res = auRunCmd(ctx, env, home, 5*time.Minute, []string{"brew", "uninstall", cur.Identity})
		}
	default:
		return nil, fmt.Errorf("%s 当前渠道不支持自动卸载", spec.Name)
	}

	if res.Code != 0 {
		msg := auFirstNonEmptyLine(res.Stderr)
		if msg == "" {
			msg = auFirstNonEmptyLine(res.Stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("退出码 %d", res.Code)
		}
		return nil, fmt.Errorf("卸载 %s 失败：%s", spec.Name, msg)
	}

	emit(AgentUpdateProgress{
		Stage:     "verifying",
		AgentID:   spec.ID,
		AgentName: spec.Name,
		Completed: 0,
		Total:     1,
		Percent:   85,
		Message:   fmt.Sprintf("正在验证 %s 卸载结果…", spec.Name),
	})

	return &AgentUpdateResult{
		ID:     spec.ID,
		Agent:  spec.Name,
		Bin:    spec.Bin,
		Status: auStatusNotInstalled,
	}, nil
}
