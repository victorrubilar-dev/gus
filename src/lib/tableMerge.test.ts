import { describe, expect, it } from "vitest";
import {
  adjacentTableCell,
  computeTableMerges,
  mergeTableCells,
  neighbourColumn,
  unmergeTableCells,
  isTableMergePossible,
  isTableUnmergePossible,
  type TableLine,
  type TableCellCaret,
} from "./tableLayout";

function toLines(markdown: string): TableLine[] {
  return markdown.split("\n").map((text) => ({ text, code: false }));
}

describe("Cálculo y combinación de celdas en tablas Markdown", () => {
  it("detecta celdas combinadas horizontalmente (colspan)", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| Fusionado | > | Solo |",
    ].join("\n");
    const lines = toLines(md);
    const merges = computeTableMerges(lines, 0, 2);

    const master = merges.get("2:0");
    expect(master).toBeDefined();
    expect(master?.isContinuation).toBe(false);
    expect(master?.colSpan).toBe(2);
    expect(master?.rowSpan).toBe(1);

    const continuation = merges.get("2:1");
    expect(continuation).toBeDefined();
    expect(continuation?.isContinuation).toBe(true);
    expect(continuation?.masterCol).toBe(0);

    const normal = merges.get("2:2");
    expect(normal).toBeDefined();
    expect(normal?.isContinuation).toBe(false);
    expect(normal?.colSpan).toBe(1);
    expect(normal?.rowSpan).toBe(1);
  });

  it("detecta celdas combinadas verticalmente (rowspan)", () => {
    const md = [
      "| Col 1 | Col 2 |",
      "| --- | --- |",
      "| Fila A | B |",
      "| ^ | C |",
    ].join("\n");
    const lines = toLines(md);
    const merges = computeTableMerges(lines, 0, 3);

    const master = merges.get("2:0");
    expect(master).toBeDefined();
    expect(master?.isContinuation).toBe(false);
    expect(master?.rowSpan).toBe(2);
    expect(master?.colSpan).toBe(1);

    const continuation = merges.get("3:0");
    expect(continuation).toBeDefined();
    expect(continuation?.isContinuation).toBe(true);
    expect(continuation?.masterLine).toBe(2);
    expect(continuation?.masterCol).toBe(0);
  });

  it("detecta celdas combinadas 2x2", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| Cuadro | > | Otro |",
      "| ^ | > | Fin |",
    ].join("\n");
    const lines = toLines(md);
    const merges = computeTableMerges(lines, 0, 3);

    const master = merges.get("2:0");
    expect(master).toBeDefined();
    expect(master?.isContinuation).toBe(false);
    expect(master?.rowSpan).toBe(2);
    expect(master?.colSpan).toBe(2);

    expect(merges.get("2:1")?.isContinuation).toBe(true);
    expect(merges.get("3:0")?.isContinuation).toBe(true);
    expect(merges.get("3:1")?.isContinuation).toBe(true);
  });

  it("mergeTableCells combina una selección horizontal en la fila", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| A | B | C |",
    ].join("\n");
    const lines = toLines(md);
    const rect = { top: 2, bottom: 2, left: 0, right: 1 };

    const edit = mergeTableCells(lines, rect);
    expect(edit).not.toBeNull();
    expect(edit?.lines[2]).toContain("| A | > | C |");
    expect(edit?.caret).toEqual({ line: 2, col: 0 });
  });

  it("mergeTableCells combina una selección vertical entre filas", () => {
    const md = [
      "| Col 1 | Col 2 |",
      "| --- | --- |",
      "| A | B |",
      "| C | D |",
    ].join("\n");
    const lines = toLines(md);
    const rect = { top: 2, bottom: 3, left: 0, right: 0 };

    const edit = mergeTableCells(lines, rect);
    expect(edit).not.toBeNull();
    expect(edit?.lines[2]).toContain("| A | B |");
    expect(edit?.lines[3]).toContain("| ^ | D |");
  });

  it("mergeTableCells combina una selección 2x2", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| A | B | C |",
      "| D | E | F |",
    ].join("\n");
    const lines = toLines(md);
    const rect = { top: 2, bottom: 3, left: 0, right: 1 };

    const edit = mergeTableCells(lines, rect);
    expect(edit).not.toBeNull();
    expect(edit?.lines[2]).toContain("| A | > | C |");
    expect(edit?.lines[3]).toContain("| ^ | > | F |");
  });

  it("unmergeTableCells separa las celdas combinadas", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| A | > | C |",
    ].join("\n");
    const lines = toLines(md);

    const edit = unmergeTableCells(lines, 2, 0, null);
    expect(edit).not.toBeNull();
    expect(edit?.lines[2]).not.toContain(">");
    expect(edit?.lines[2]).toContain("| A |  | C |");
  });

  it("la navegación salta celdas de continuación (merge markers)", () => {
    const md = [
      "| Col 1 | Col 2 | Col 3 |",
      "| --- | --- | --- |",
      "| A | > | C |",
    ].join("\n");
    const lines = toLines(md);

    // neighbourColumn desde col 0 hacia la derecha con '>' en col 1
    const nextCol = neighbourColumn(lines, 2, 0, 1);
    expect(nextCol).toBe(2);

    // neighbourColumn desde col 2 hacia la izquierda con '>' en col 1
    const prevCol = neighbourColumn(lines, 2, 2, -1);
    expect(prevCol).toBe(0);

    // adjacentTableCell (Tab) salta la celda combinada
    const caret: TableCellCaret = {
      blockStart: 0,
      blockEnd: 2,
      line: 2,
      row: 2,
      col: 0,
      cols: 3,
      cellStart: 0,
      cellEnd: 0,
      selStart: 0,
      selEnd: 0,
      collapsed: true,
      onDelimiter: false,
    };
    const nextCell = adjacentTableCell(caret, 1, lines);
    expect(nextCell).toEqual({ line: 2, col: 2 });
  });

  it("isTableMergePossible valida si el rectángulo abarca múltiples celdas", () => {
    expect(isTableMergePossible(null)).toBe(false);
    expect(isTableMergePossible({ top: 2, bottom: 2, left: 0, right: 0 })).toBe(false);
    expect(isTableMergePossible({ top: 2, bottom: 2, left: 0, right: 1 })).toBe(true);
    expect(isTableMergePossible({ top: 2, bottom: 3, left: 0, right: 0 })).toBe(true);
  });

  it("isTableUnmergePossible detecta si hay celdas para separar", () => {
    const md = [
      "| Col 1 | Col 2 |",
      "| --- | --- |",
      "| A | > |",
    ].join("\n");
    const lines = toLines(md);

    expect(isTableUnmergePossible(lines, 2, 0, null)).toBe(true);
    expect(isTableUnmergePossible(lines, 2, 1, null)).toBe(true);

    const normalMd = [
      "| Col 1 | Col 2 |",
      "| --- | --- |",
      "| A | B |",
    ].join("\n");
    const normalLines = toLines(normalMd);
    expect(isTableUnmergePossible(normalLines, 2, 0, null)).toBe(false);
  });
});
