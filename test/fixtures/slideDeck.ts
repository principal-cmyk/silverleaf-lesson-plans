/**
 * A small, complete lesson deck (English, 40 minutes) for the slide tests.
 */
import { NO_VISUAL, type SlideDeck } from "@/lib/slides/deckSchema";

const say = (text: string) => [{ kind: "say" as const, text }];

export const DECK: SlideDeck = {
  language: "en",
  lesson_minutes: 40,
  title: {
    heading: "Many and few",
    subheading: "Grade 1 · Arithmetic",
    emoji: "🥭",
    script: say("Welcome the class."),
  },
  get_ready: {
    start_minute: 0,
    end_minute: 2,
    heading: "Get ready",
    instructions: ["Take out your exercise book.", "Write the date and the title."],
    materials: ["Exercise book", "Pencil"],
    book_title: "Many and few",
    book_goal: "Today I will say which group has many.",
    script: say("Open your books and write the date."),
  },
  hook: {
    start_minute: 2,
    end_minute: 7,
    heading: "Look!",
    instructions: ["Look at the two groups.", "Which group has more pencils?"],
    visual: {
      ...NO_VISUAL,
      kind: "objects",
      caption: "Count each group",
      groups: [
        { emoji: "✏️", count: 10, label: "Group A" },
        { emoji: "✏️", count: 1, label: "Group B" },
      ],
    },
    sentence_frame: "This group has ___.",
    expected_answers: ["The group of 10"],
    script: [
      { kind: "do", text: "Hold up 10 pencils and 1 pencil." },
      { kind: "ask", text: "Which group has more?" },
      { kind: "expect", text: "The group of 10." },
    ],
  },
  i_do: {
    start_minute: 7,
    end_minute: 17,
    heading: "New learning",
    key_words: [
      { word: "many", meaning: "a large number", emoji: "🐝" },
      { word: "few", meaning: "a small number", emoji: "" },
    ],
    key_words_script: say("Read each word with me."),
    teaching_points: ["Many means a large number", "Few means a small number", "We compare two groups"],
    teaching_points_visual: NO_VISUAL,
    teaching_points_script: say("Listen carefully."),
    worked_examples: [
      {
        problem: "8 mangoes and 3 mangoes",
        visual: {
          ...NO_VISUAL,
          kind: "number_line",
          number_line: { from: 0, to: 10, step: 1, highlight: [3, 8] },
        },
        steps: ["Count each group", "8 is more than 3", "So 8 is many"],
        book_note: "8 > 3, so 8 is MANY",
        script: say("Watch me count."),
      },
    ],
  },
  i_do_checkpoint: {
    question: "Is 1 many or few?",
    answer: "Few",
    instructions: ["Think.", "Show me on your fingers."],
    visual: NO_VISUAL,
    script: say("Show me on your fingers."),
  },
  we_do: {
    start_minute: 17,
    end_minute: 27,
    heading: "Practice together",
    sentence_frame: "___ is many, ___ is few.",
    rounds: [
      {
        title: "Round 1",
        instructions: ["Read each question.", "Say the answer together."],
        visual: NO_VISUAL,
        minutes: 5,
        questions: [
          { question: "7 or 3?", answer: "7 is many" },
          { question: "2 or 9?", answer: "" },
          { question: "4 or 6?", answer: "6 is many" },
        ],
        script: say("Answer all together."),
      },
      {
        title: "Round 2",
        instructions: ["Write on your slate.", "Hold it up."],
        visual: {
          ...NO_VISUAL,
          kind: "place_value",
          place_value: { hundreds: 0, tens: 0, ones: 5 },
        },
        minutes: 5,
        questions: [{ question: "5 or 1?", answer: "5 is many" }],
        script: say("Slates up!"),
      },
    ],
  },
  we_do_checkpoint: {
    question: "Is 5 always many?",
    answer: "No, it depends",
    instructions: [],
    visual: NO_VISUAL,
    script: say("Think first."),
  },
  you_do: {
    start_minute: 27,
    end_minute: 35,
    heading: "On your own",
    instructions: ["Open your exercise book.", "In your exercise book, circle the MANY group."],
    questions: [
      { question: "4 or 1", answer: "4" },
      { question: "2 or 8", answer: "8" },
    ],
    challenge: { question: "Draw a FEW group", answer: "" },
    script: say("Work quietly."),
    marking_script: say("Swap books and tick."),
  },
  exit_ticket: {
    start_minute: 35,
    end_minute: 38,
    heading: "Exit ticket",
    instructions: ["Answer in your book."],
    questions: [
      { question: "Circle MANY: 6 or 2", answer: "6" },
      { question: "Circle FEW: 9 or 3", answer: "3" },
    ],
    script: say("Hand in your books."),
  },
  close: {
    start_minute: 38,
    end_minute: 40,
    heading: "What we learned",
    recap: ["Many and few compare groups"],
    self_check: ["I can say which group has many"],
    homework: "Find a many group at home.",
    script: say("Thumbs up if you can."),
  },
};
