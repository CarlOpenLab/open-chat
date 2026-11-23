package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseSkillFrontmatter(t *testing.T) {
	raw := "---\nname: \"code-review\"\ndescription: >-\n  Review staged changes\n  and report issues\n---\n\n# Body\n"
	name, desc := parseSkillFrontmatter(raw)
	if name != "code-review" {
		t.Fatalf("expected name code-review, got %q", name)
	}
	if desc != "Review staged changes and report issues" {
		t.Fatalf("unexpected description: %q", desc)
	}
}

func TestListSkillsProjectPriority(t *testing.T) {
	tmp := t.TempDir()
	projSkillDir := filepath.Join(tmp, ".claude", "skills", "deploy-check")
	if err := os.MkdirAll(projSkillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(projSkillDir, "SKILL.md"),
		[]byte("---\nname: deploy-check\ndescription: Project deploy checks\n---\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}

	skills := listSkills(tmp)
	found := false
	for _, s := range skills {
		if s.Name == "deploy-check" {
			found = true
			if s.Source != "project" || s.Description != "Project deploy checks" {
				t.Fatalf("unexpected skill entry: %+v", s)
			}
		}
	}
	if !found {
		t.Fatalf("expected deploy-check skill to be discovered, got %+v", skills)
	}
}
