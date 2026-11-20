export const TEMPLATE_QUESTION_COUNTS = {
  "20q_a4": 20,
  "50q_a4": 50,
  "100q_a4": 100,
} as const;

export type TemplateId = keyof typeof TEMPLATE_QUESTION_COUNTS;

export const ANSWER_CHOICES = ["A", "B", "C", "D", "E"] as const;

export type AnswerChoice = (typeof ANSWER_CHOICES)[number];
export type CorrectionValue = AnswerChoice | "";
