export function isAuthenticRikzRussianExamMode(
  value: unknown,
  source: "CURRENT_TEST" | "ATTEMPT_SNAPSHOT"
) {
  return source === "CURRENT_TEST"
    ? value === "RIKZ_RUSSIAN_2026"
    : value === "rikz_russian_2026";
}
