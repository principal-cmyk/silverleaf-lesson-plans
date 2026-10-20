/**
 * planText — the layouts generated plans actually use (shortened from real
 * AI Studio output), split into steps and question/answer pairs.
 */
import { describe, expect, it } from "vitest";

import { exitTicketLines, keyLabel, splitExitTicket, splitSteps, stepLines } from "./planText";

describe("splitSteps", () => {
  it("splits a one-paragraph stage at its KLP markers, with numbered sub-steps", () => {
    const text =
      "KLP 1: Hold up both hands: 'Channel one.' Run four gestures. KLP 2: Drop hands to sides. " +
      "Hold. 'Read me.' KLP 3: Run three faces. Stamp the steps: 1) Name the allowed channel. " +
      "2) Switch the other two off. 3) Hold for count of three.";
    const { lead, steps } = splitSteps(text);
    expect(lead).toBe("");
    expect(steps.map((s) => s.label)).toEqual(["KLP 1", "KLP 2", "KLP 3"]);
    expect(steps[0]!.text).toBe("Hold up both hands: 'Channel one.' Run four gestures.");
    expect(steps[2]!.text).toBe("Run three faces. Stamp the steps:");
    expect(steps[2]!.sub.map((s) => s.text)).toEqual([
      "Name the allowed channel.",
      "Switch the other two off.",
      "Hold for count of three.",
    ]);
  });

  it("keeps an introduction before the first marker, and takes a round's title into its label", () => {
    const text =
      "Teacher models each mechanic. Round 1 — Choral: (i) 'Which channel?' — Gesture. " +
      "(ii) 'And this one?' — Posture. Round 2 (Pair frames): Pairs face to face. Round 3: Swap.";
    const { lead, steps } = splitSteps(text);
    expect(lead).toBe("Teacher models each mechanic.");
    expect(steps.map((s) => s.label)).toEqual(["Round 1", "Round 2 (Pair frames)", "Round 3"]);
    expect(steps[0]!.text).toBe("Choral:");
    expect(steps[0]!.sub).toHaveLength(2);
    expect(steps[1]!.text).toBe("Pairs face to face.");
  });

  it("makes each bulleted line a step, labelling it from its own marker", () => {
    const text =
      "- Model the laugh: Part 1: belly. Part 2: shoulders.\n" +
      "- Round 1 (Choral dry drills): Three quick items.\n" +
      "- State: 'A stage cry is more breath than tears.'";
    const { steps } = splitSteps(text);
    expect(steps).toHaveLength(3);
    expect(steps[0]!.text).toBe("Model the laugh:");
    expect(steps[0]!.sub.map((s) => s.label)).toEqual(["Part 1", "Part 2"]);
    expect(steps[1]).toMatchObject({ label: "Round 1 (Choral dry drills)", text: "Three quick items." });
    expect(steps[2]!.label).toBe("");
  });

  it("splits bullets run onto one line, and markers without a colon", () => {
    expect(splitSteps("- Teacher shows a cow. <br>- Teacher sorts the cards.").steps.map((s) => s.text)).toEqual([
      "Teacher shows a cow.",
      "Teacher sorts the cards.",
    ]);
    expect(splitSteps("- Teacher says 'Cow.' - Teacher says 'Lion.' - Think-aloud: 'Two houses.'").steps).toHaveLength(3);
    const { lead, steps } = splitSteps("Students work alone: Q1 Pronounce /j/ solo, Q2 Circle /j/ pictures, Q3 Judge four words.");
    expect(lead).toBe("Students work alone:");
    expect(steps.map((s) => s.label)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("splits '(1) … (2) …' steps", () => {
    const { lead, steps } = splitSteps("Teacher models the steps: (1) Display the checklist. (2) Model planning a scene.");
    expect(lead).toBe("Teacher models the steps:");
    expect(steps.map((s) => s.text)).toEqual(["Display the checklist.", "Model planning a scene."]);
  });

  it("makes each sentence of plain prose a step, keeping quoted speech whole", () => {
    const text =
      "Teacher slowly demonstrates the steps: 'First, I put toothpaste on the brush. Then I brush my teeth.' " +
      "Teacher models each action on the mouth model, e.g. the circles. Learners copy the teacher's actions.";
    expect(splitSteps(text).steps.map((s) => s.text)).toEqual([
      "Teacher slowly demonstrates the steps: 'First, I put toothpaste on the brush. Then I brush my teeth.'",
      "Teacher models each action on the mouth model, e.g. the circles.",
      "Learners copy the teacher's actions.",
    ]);
    // Short prose stays a paragraph, however many sentences.
    expect(splitSteps("Teacher shows the card. Learners read it. They point.").steps).toEqual([]);
  });

  it("does not split on a stray marker or a number in the prose", () => {
    expect(splitSteps("Learners complete the questions (Q1–Q5) in 3 minutes.").steps).toEqual([]);
    expect(splitSteps("Only KLP 2: no first marker here.").steps).toEqual([]);
    expect(splitSteps("A plain paragraph.").lead).toBe("A plain paragraph.");
  });
});

describe("splitExitTicket", () => {
  it("separates inline '(Marking guide: …)' answers, nested brackets included", () => {
    const text =
      "Exit Ticket (on slates; board headings covered): Q1: Define the three channels. " +
      "(Marking guide: Gesture — the hands; Posture — the whole body.) Q2: State what a bent back reads as. " +
      "(Marking guide: old, or tired (any one).) Q3: Name a channel.";
    const { lead, questions } = splitExitTicket(text);
    expect(lead).toBe("on slates; board headings covered");
    expect(questions).toEqual([
      { label: "Q1", question: "Define the three channels.", answer: "Gesture — the hands; Posture — the whole body." },
      { label: "Q2", question: "State what a bent back reads as.", answer: "old, or tired (any one)." },
      { label: "Q3", question: "Name a channel.", answer: "" },
    ]);
  });

  it("matches a separate marking-guide section back to its questions", () => {
    const text =
      "Exit Ticket:\nQ1: Write the four mechanics of a laugh.\nQ2: Write the four mechanics of a cry.\n" +
      "Marking guide:\nQ1: belly bursts; loose shoulders.\nQ2: the catch in the breath; broken sound.";
    const { lead, questions } = splitExitTicket(text);
    expect(lead).toBe("");
    expect(questions).toEqual([
      { label: "Q1", question: "Write the four mechanics of a laugh.", answer: "belly bursts; loose shoulders." },
      { label: "Q2", question: "Write the four mechanics of a cry.", answer: "the catch in the breath; broken sound." },
    ]);
  });

  it("reads an 'Expected answer:' line under each question", () => {
    const text =
      "Q1: Write the mechanics of a laugh. \nExpected answer: belly bursts. \n" +
      "Q2: Write the mechanics of a cry. \nExpected answer: the catch in the breath.";
    expect(splitExitTicket(text).questions.map((q) => q.answer)).toEqual([
      "belly bursts.",
      "the catch in the breath.",
    ]);
  });

  it("keeps a short closing activity whole", () => {
    expect(splitExitTicket("Thumbs up if you can name a channel. Then line up quietly.")).toEqual({
      lead: "Thumbs up if you can name a channel. Then line up quietly.",
      questions: [],
      notes: "",
    });
  });

  it("reads '→' and 'Correct:' answers, and tagged questions", () => {
    const arrows = splitExitTicket(
      "Q1 [pronounce]: Random-cue five vowels. → clean Q2 [detect]: Vowels of four words. → correct",
    );
    expect(arrows.questions).toEqual([
      { label: "Q1 [pronounce]", question: "Random-cue five vowels.", answer: "clean" },
      { label: "Q2 [detect]", question: "Vowels of four words.", answer: "correct" },
    ]);
    const correct = splitExitTicket(
      "Q1: What was the message? (Correct: e.g., 'Honesty is important.') Q2: How was it solved? (Correct: by sharing.)",
    );
    expect(correct.questions.map((q) => q.answer)).toEqual(["e.g., 'Honesty is important.'", "by sharing."]);
  });

  it("keeps a marking guide for the whole ticket apart from the last question", () => {
    const { questions, notes } = splitExitTicket(
      "Q1: Random-cue five vowels. → clean\nQ2: Ladder pan-pen-pin-pot.\nMarking guide: Q1: Station records. Q2: Correct four-step laddering.",
    );
    expect(questions[1]).toEqual({ label: "Q2", question: "Ladder pan-pen-pin-pot.", answer: "Correct four-step laddering." });
    expect(notes).toBe("");
    const general = splitExitTicket(
      "Q1: Pronounce /f/. Q2: Explain your sort. Q3: Draw one object. Marking guide: Q1–Q2: station records. Award Q3 for effort.",
    );
    expect(general.questions[2]).toEqual({ label: "Q3", question: "Draw one object.", answer: "" });
    expect(general.notes).toBe("Q1–Q2: station records. Award Q3 for effort.");
  });

  it("reads a bracketed answer after a finished question, and a guide with no question numbers", () => {
    const { questions, notes } = splitExitTicket(
      "Q1: Pronounce /e/. (Clean /e/) Q2: 'Pen' — /a/ or /e/? (/e/) Q3: Show the mouth difference. Marking guide: Secure: ≥4 correct; Developing: 2-3.",
    );
    expect(questions.map((q) => [q.question, q.answer])).toEqual([
      ["Pronounce /e/.", "Clean /e/"],
      ["'Pen' — /a/ or /e/?", "/e/"],
      ["Show the mouth difference.", ""],
    ]);
    expect(notes).toBe("Secure: ≥4 correct; Developing: 2-3.");
  });

  it("allows one skipped question number", () => {
    const { questions } = splitExitTicket("Q1: Pronounce /f/. Q2: Explain your sort. Q4: Draw one object.");
    expect(questions.map((q) => q.label)).toEqual(["Q1", "Q2", "Q4"]);
  });
});

describe("stepLines", () => {
  it("gives one line per step, labelled or numbered", () => {
    expect(stepLines("Intro. KLP 1: First. KLP 2: Second.")).toEqual(["Intro.", "KLP 1: First.", "KLP 2: Second."]);
    expect(stepLines("- Do this\n- Then that")).toEqual(["• Do this", "• Then that"]);
    expect(stepLines("1. Do this\n2. Then that")).toEqual(["1. Do this", "2. Then that"]);
    expect(stepLines("Just one paragraph.")).toEqual(["Just one paragraph."]);
  });
});

describe("exitTicketLines", () => {
  it("lists the questions, then the marking key under bare labels", () => {
    expect(keyLabel("Q1 [DOK 1]")).toBe("Q1");
    expect(exitTicketLines("Q1 [DOK 1]: Can we see in the dark? → no Q2: Name a light. → the sun")).toEqual([
      "Q1 [DOK 1]: Can we see in the dark?",
      "Q2: Name a light.",
      "Marking key:",
      "Q1: no",
      "Q2: the sun",
    ]);
  });
});
