const normalizeName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeSku = (value = "") =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exactNormalizedNameRegex = (value = "") => {
  const normalized = normalizeName(value);
  if (!normalized) return /^$/i;
  const pattern = normalized.split(" ").map(escapeRegex).join("\\s+");
  return new RegExp(`^${pattern}$`, "i");
};

module.exports = {
  escapeRegex,
  exactNormalizedNameRegex,
  normalizeName,
  normalizeSku,
};
