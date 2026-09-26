import { describe, expect, test } from "bun:test";
import { formatHint } from "../src/ui/ui";

describe("formatHint", () => {
  test("renders [Key] tokens as keycaps", () => {
    expect(formatHint("Hold [Space] to call")).toBe("Hold <kbd>Space</kbd> to call");
  });

  test("escapes markup before adding keycaps", () => {
    expect(formatHint('<img src=x onerror="alert(1)"> [W]')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <kbd>W</kbd>",
    );
  });
});
