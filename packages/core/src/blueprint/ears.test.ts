import { describe, expect, it } from "vitest";
import { MAX_CRITERION_CHARS, formatEars, parseEars, plainSentence } from "./ears";

describe("EARS parsing", () => {
  it("BP-3A-01 event and ubiquitous forms round-trip", () => {
    const event = parseEars("when a user pays the system shall send a receipt");
    expect(event).toEqual({
      form: "event",
      trigger: "a user pays",
      response: "send a receipt",
      negated: false,
    });
    if (!event) throw new Error("no parse");
    expect(formatEars(event)).toBe("WHEN a user pays, THE SYSTEM SHALL send a receipt.");
    expect(parseEars(formatEars(event))).toEqual(event);
    expect(plainSentence(event)).toBe("When a user pays, the app sends a receipt.");

    const ubiquitous = parseEars("  The system shall   log every sign-in.  ");
    expect(ubiquitous).toEqual({
      form: "ubiquitous",
      response: "log every sign-in",
      negated: false,
    });
    if (!ubiquitous) throw new Error("no parse");
    expect(parseEars(formatEars(ubiquitous))).toEqual(ubiquitous);
    expect(plainSentence(ubiquitous)).toBe("The app logs every sign-in.");
  });

  it("BP-3A-02 unwanted (IF/THEN) and state (WHILE) forms round-trip", () => {
    const unwanted = parseEars("IF the card is declined, THEN THE SYSTEM SHALL show an error");
    expect(unwanted).toEqual({
      form: "unwanted",
      condition: "the card is declined",
      response: "show an error",
      negated: false,
    });
    if (!unwanted) throw new Error("no parse");
    expect(formatEars(unwanted)).toBe(
      "IF the card is declined, THEN THE SYSTEM SHALL show an error.",
    );
    expect(parseEars(formatEars(unwanted))).toEqual(unwanted);
    expect(plainSentence(unwanted)).toBe("If the card is declined, the app shows an error.");

    const state = parseEars("While offline, the system shall queue messages.");
    expect(state).toEqual({
      form: "state",
      state: "offline",
      response: "queue messages",
      negated: false,
    });
    if (!state) throw new Error("no parse");
    expect(parseEars(formatEars(state))).toEqual(state);
    expect(plainSentence(state)).toBe("While offline, the app queues messages.");
  });

  it("BP-3A-03 never form and SHALL NOT inside a trigger set negated", () => {
    const never = parseEars("THE SYSTEM SHALL NOT store card numbers.");
    expect(never).toEqual({ form: "never", response: "store card numbers", negated: true });
    if (!never) throw new Error("no parse");
    expect(formatEars(never)).toBe("THE SYSTEM SHALL NOT store card numbers.");
    expect(parseEars(formatEars(never))).toEqual(never);
    expect(plainSentence(never)).toBe("The app never stores card numbers.");

    const negEvent = parseEars("WHEN a guest opens the page, THE SYSTEM SHALL NOT show prices");
    expect(negEvent).toEqual({
      form: "event",
      trigger: "a guest opens the page",
      response: "show prices",
      negated: true,
    });
    if (!negEvent) throw new Error("no parse");
    expect(parseEars(formatEars(negEvent))).toEqual(negEvent);
    expect(plainSentence(negEvent)).toBe(
      "When a guest opens the page, the app never shows prices.",
    );
  });

  it("BP-3A-04 non-EARS text returns null", () => {
    expect(parseEars("Users can pay with a card")).toBeNull();
    expect(parseEars("")).toBeNull();
    expect(parseEars("WHEN a user pays, send a receipt")).toBeNull();
    expect(parseEars("THE SYSTEM SHALL")).toBeNull();
  });

  it("BP-3A-05 text over MAX_CRITERION_CHARS returns null", () => {
    const long = `THE SYSTEM SHALL ${"x".repeat(MAX_CRITERION_CHARS)}`;
    expect(long.length).toBeGreaterThan(MAX_CRITERION_CHARS);
    expect(parseEars(long)).toBeNull();
    const fits = `THE SYSTEM SHALL ${"x".repeat(MAX_CRITERION_CHARS - 20)}`;
    expect(parseEars(fits)).not.toBeNull();
  });
});
