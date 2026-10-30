import { describe, expect, it } from "vitest";
import { filterByOrigin, groupByNote, noteTasksFrom, toggleNoteTaskText } from "./noteTasks";

const notes = [
  { name: "a.md", path: "/v/a.md", relative: "a.md", text: "# A\n- [ ] uno #x\n- [x] dos\n```\n- [ ] en código\n```\n" },
  { name: "b.md", path: "/v/sub/b.md", relative: "sub/b.md", text: "- [ ] tres 📅 2026-11-02\n" },
];

describe("noteTasks", () => {
  it("lee los checkboxes de cada nota e ignora los de bloques de código", () => {
    const tasks = noteTasksFrom(notes);
    expect(tasks.map((t) => [t.noteName, t.title, t.completes])).toEqual([
      ["a", "uno", false],
      ["a", "dos", true],
      ["b", "tres", false],
    ]);
    expect(tasks[2].due).toBe("2026-11-02");
  });

  it("marca la línea correcta", () => {
    const [uno] = noteTasksFrom(notes);
    expect(toggleNoteTaskText(notes[0].text, uno)).toContain("- [x] uno #x");
  });

  it("no toca nada si la nota cambió desde que se vio la tarea", () => {
    const [uno] = noteTasksFrom(notes);
    expect(toggleNoteTaskText("- [ ] otra cosa\n", uno)).toBeNull();
    expect(toggleNoteTaskText(notes[0].text.replace("[ ] uno", "[x] uno"), uno)).toBeNull();
  });

  it("filtra y agrupa por nota de origen", () => {
    const tasks = noteTasksFrom(notes);
    expect(filterByOrigin(tasks, "sub/b.md")).toHaveLength(1);
    expect(filterByOrigin(tasks, null)).toHaveLength(3);
    expect(filterByOrigin(tasks, "no-existe.md")).toEqual([]);
    expect(groupByNote(tasks).map((g) => [g.relative, g.tasks.length])).toEqual([
      ["a.md", 2],
      ["sub/b.md", 1],
    ]);
  });
});
