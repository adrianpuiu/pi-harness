#!/usr/bin/env python3
"""Vendor hyperpowers Claude Code plugins (bug-hunter, refactor) into pi-harness.

Transforms:
  skills/*/SKILL.md  -> skills/<name>/SKILL.md        (pi Agent Skills: name +
      description merged with when_to_use; Claude-Code-only fields dropped)
  agents/*.md        -> agents/<name>.md              (scout profiles: name +
      description frontmatter, tools policy derived from the original list,
      namespaced skill refs rewritten to plain names)

Dropped deliberately: MCP code-review-graph tool refs (pi is no-MCP),
allowed-tools (governance gate supersedes), model/color (scouts inherit).

One-shot reproducible import; run from repo root:
  python3 tools/vendor-hyperpowers.py /path/to/hyperpowers-main/plugins
"""
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/media/agp/bALAMUC/hyperpowers-main/plugins")
DEST = Path(__file__).resolve().parent.parent

# F11: a frontmatter block must be a complete opening+closing fence. An
# unclosed `---` or a 4-dash `----` opener is body text, never a misparse.
FM_RE = re.compile(r"\A---[ \t]*\n(.*?)\n---[ \t]*\n?(.*)\Z", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Minimal parser: top-level keys, folded (>-) and list scalars unfolded."""
    match = FM_RE.match(text.strip("\n"))
    if not match:
        return {}, text
    fm, body = match.group(1), match.group(2)
    fields: dict[str, str] = {}
    current_key = None
    buffer: list[str] = []
    for raw in fm.splitlines():
        top = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", raw)
        indented = re.match(r"^\s+(.*)$", raw)
        if top:
            flush(current_key, buffer, fields)
            current_key, rest = top.group(1), top.group(2).strip()
            buffer = [] if rest in ("|", ">-", ">") else ([rest] if rest else [])
        elif indented and current_key:
            line = indented.group(1)
            buffer.append(line[2:].strip() if line.startswith("- ") else line.strip())
    flush(current_key, buffer, fields)
    return fields, body.strip()


def flush(key: str | None, buffer: list[str], fields: dict[str, str]) -> None:
    if key is None:
        return
    # F11: keep empty-valued keys explicitly set ("" not silently dropped).
    fields[key] = " ".join(part for part in buffer if part).strip()


def rewrite_refs(body: str) -> str:
    return body.replace("hyperpowers-bug-hunter:", "").replace("hyperpowers-refactor:", "")


def fold(field: str) -> str:
    return re.sub(r"\s+", " ", field).strip()


def safe_name(raw: str, fallback: str) -> str:
    """F06: frontmatter names are untrusted — never a path component as-is."""
    name = raw.strip()
    if not name or "/" in name or "\\" in name or ".." in name:
        raise SystemExit(f"refusing untrusted frontmatter name: {raw!r}")
    return name


def safe_target(root: Path, target: Path) -> Path:
    """F06: belt-and-braces — the resolved target must stay under root."""
    try:
        target.resolve().relative_to(root.resolve())
    except ValueError:
        raise SystemExit(f"refusing to write outside {root}: {target}") from None
    return target


def vendor_skill(src: Path) -> Path:
    fm, body = parse_frontmatter(src.read_text())
    description = fold(fm.get("description", ""))
    if fm.get("when_to_use"):
        description += f" Triggers: {fold(fm['when_to_use'])}"
    name = safe_name(fm.get("name", ""), src.parent.name)
    out = f"---\nname: {name}\ndescription: {description}\n---\n\n{rewrite_refs(body)}\n"
    target = safe_target(DEST, DEST / "skills" / name / "SKILL.md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out)
    return target


def vendor_agent(src: Path) -> Path:
    fm, body = parse_frontmatter(src.read_text())
    name = safe_name(fm.get("name", ""), src.stem)
    description = fold(fm.get("description", ""))
    tools_list = fm.get("tools", "").lower()
    policy = "none" if tools_list in ("", "none", "[]") else "read-only"
    out = (
        f"---\nname: {name}\ndescription: {description}\ntools: {policy}\n---\n\n"
        f"{rewrite_refs(body)}\n"
    )
    (DEST / "agents").mkdir(exist_ok=True)
    target = safe_target(DEST, DEST / "agents" / f"{name}.md")
    target.write_text(out)
    return target


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"source plugins dir not found: {SRC}")
    written = 0
    for plugin in ("bug-hunter", "refactor"):
        skills = sorted((SRC / plugin / "skills").glob("*/SKILL.md"))
        agents = sorted((SRC / plugin / "agents").glob("*.md"))
        if not skills and not agents:
            raise SystemExit(f"nothing to vendor for {plugin!r} under {SRC}")
        for skill in skills:
            vendor_skill(skill)
            written += 1
        for agent in agents:
            vendor_agent(agent)
            written += 1
    print(f"vendored {written} files -> {DEST}/skills, {DEST}/agents")


if __name__ == "__main__":
    main()
