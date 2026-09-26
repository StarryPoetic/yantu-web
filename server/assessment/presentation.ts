import type { MathExpression, QuestionPresentation } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function short(value: unknown, max = 300): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function matrix(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === value[0].length &&
        row.length > 0 &&
        row.length <= 8 &&
        row.every((cell) => short(cell, 40)),
    )
  );
}
function expression(value: unknown, depth = 0): value is MathExpression {
  if (!record(value) || depth > 6) return false;
  if (value.kind === "text")
    return keys(value, ["kind", "value"]) && short(value.value, 120);
  if (value.kind === "matrix" || value.kind === "determinant")
    return keys(value, ["kind", "cells"]) && matrix(value.cells);
  if (value.kind === "row")
    return (
      keys(value, ["kind", "items"]) &&
      Array.isArray(value.items) &&
      value.items.length <= 30 &&
      value.items.every((item) => expression(item, depth + 1))
    );
  if (value.kind === "fraction")
    return (
      keys(value, ["kind", "numerator", "denominator"]) &&
      expression(value.numerator, depth + 1) &&
      expression(value.denominator, depth + 1)
    );
  if (value.kind === "power")
    return (
      keys(value, ["kind", "base", "exponent"]) &&
      expression(value.base, depth + 1) &&
      expression(value.exponent, depth + 1)
    );
  return false;
}
/** No arbitrary HTML/SVG, event attributes or remote image fetches enter a question. */
export function validPresentation(
  value: unknown,
): value is QuestionPresentation {
  if (
    !record(value) ||
    !keys(value, ["formulas", "diagram"]) ||
    JSON.stringify(value).length > 20000
  )
    return false;
  if (
    value.formulas !== undefined &&
    (!Array.isArray(value.formulas) ||
      value.formulas.length > 8 ||
      value.formulas.some(
        (formula) =>
          !record(formula) ||
          !keys(formula, ["label", "expression"]) ||
          !short(formula.label) ||
          !expression(formula.expression),
      ))
  )
    return false;
  if (value.diagram === undefined) return true;
  const diagram = value.diagram;
  if (!record(diagram) || !short(diagram.alt, 600)) return false;
  if (diagram.kind === "image")
    return (
      keys(diagram, ["kind", "src", "alt"]) &&
      typeof diagram.src === "string" &&
      /^\/question-media\/[a-zA-Z0-9_-]+\.(png|webp|jpg)$/.test(diagram.src)
    );
  return (
    diagram.kind === "matrix" &&
    keys(diagram, ["kind", "cells", "alt", "highlightDiagonal"]) &&
    matrix(diagram.cells) &&
    (diagram.highlightDiagonal === undefined ||
      typeof diagram.highlightDiagonal === "boolean")
  );
}
