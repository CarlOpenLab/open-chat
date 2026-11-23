package host

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// listSkills discovers local SKILL.md definitions from project and user skill
// directories. Project-level skills take precedence over user-level skills
// when names collide.
func listSkills(cwd string) []SkillInfo {
	type scanRoot struct {
		dir    string
		source string
	}

	var roots []scanRoot
	if dir := expandHome(strings.TrimSpace(cwd)); dir != "" {
		clean := filepath.Clean(dir)
		roots = append(roots,
			scanRoot{dir: filepath.Join(clean, ".claude", "skills"), source: "project"},
			scanRoot{dir: filepath.Join(clean, ".agents", "skills"), source: "project"},
			scanRoot{dir: filepath.Join(clean, ".codex", "skills"), source: "project"},
			scanRoot{dir: filepath.Join(clean, ".opencode", "skills"), source: "project"},
		)
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		roots = append(roots,
			scanRoot{dir: filepath.Join(home, ".claude", "skills"), source: "user"},
			scanRoot{dir: filepath.Join(home, ".agents", "skills"), source: "user"},
			scanRoot{dir: filepath.Join(home, ".codex", "skills"), source: "user"},
			scanRoot{dir: filepath.Join(home, ".opencode", "skills"), source: "user"},
		)
	}

	seen := make(map[string]bool)
	out := make([]SkillInfo, 0, 16)

	for _, root := range roots {
		entries, err := os.ReadDir(root.dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			entryName := entry.Name()
			if strings.HasPrefix(entryName, ".") {
				continue
			}
			fullDir := filepath.Join(root.dir, entryName)
			// Follow symlinks so linked skill directories are discovered too.
			st, err := os.Stat(fullDir)
			if err != nil || !st.IsDir() {
				continue
			}
			skillFile := filepath.Join(fullDir, "SKILL.md")
			raw, err := os.ReadFile(skillFile)
			if err != nil {
				continue
			}
			name, desc := parseSkillFrontmatter(string(raw))
			if name == "" {
				name = entryName
			}
			key := strings.ToLower(name)
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, SkillInfo{
				Name:        name,
				Description: desc,
				Source:      root.source,
				Path:        skillFile,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source == "project"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// parseSkillFrontmatter extracts name and description from YAML frontmatter
// delimited by "---" lines at the start of SKILL.md.
func parseSkillFrontmatter(content string) (name, description string) {
	s := strings.TrimPrefix(content, "\uFEFF")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.HasPrefix(s, "---\n") && s != "---" {
		return "", ""
	}
	rest := s[4:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", ""
	}
	block := rest[:end]
	lines := strings.Split(block, "\n")

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		// Skip indented continuation lines handled below.
		if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:colon]))
		val := strings.TrimSpace(line[colon+1:])

		if val == "|" || val == ">" || val == "|-" || val == ">-" {
			var parts []string
			for i+1 < len(lines) {
				next := lines[i+1]
				if strings.HasPrefix(next, " ") || strings.HasPrefix(next, "\t") || strings.TrimSpace(next) == "" {
					i++
					if t := strings.TrimSpace(next); t != "" {
						parts = append(parts, t)
					}
					continue
				}
				break
			}
			val = strings.Join(parts, " ")
		} else {
			val = unquoteYAML(val)
		}

		switch key {
		case "name":
			if name == "" {
				name = val
			}
		case "description":
			if description == "" {
				description = val
			}
		}
	}
	return strings.TrimSpace(name), strings.TrimSpace(description)
}

func unquoteYAML(v string) string {
	v = strings.TrimSpace(v)
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			return v[1 : len(v)-1]
		}
	}
	return v
}
