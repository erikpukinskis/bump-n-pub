import { describe, expect, test } from "vitest";

import { releaseShouldPublish } from "../src/commands.js";

describe("releaseShouldPublish", () => {
  test("publishes an unpublished stable release only from an allowed branch", () => {
    expect(releaseShouldPublish("1.2.3", [false, false], "main", ["main"])).toBe(true);
    expect(releaseShouldPublish("1.2.3", [false, false], "feature", ["main"])).toBe(
      false,
    );
  });

  test("publishes an unpublished prerelease from any branch", () => {
    expect(releaseShouldPublish("1.3.0-beta.0", [false, false], "feature", [])).toBe(
      true,
    );
  });

  test("does not republish a complete release group", () => {
    expect(releaseShouldPublish("1.2.3", [true, true], "main", ["main"])).toBe(false);
  });

  test("rejects a partially published release group", () => {
    expect(() => releaseShouldPublish("1.2.3", [true, false], "main", ["main"])).toThrow(
      "Exactly one package version is already published",
    );
  });
});
