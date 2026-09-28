import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export function filterName(raw) {
  const trimmed = (raw ?? "").trim().slice(0, 16);
  if (trimmed.length === 0) return "Player";
  if (matcher.hasMatch(trimmed)) return "Player";
  return trimmed.replace(/[<>&"']/g, ""); // basic sanitize
}
