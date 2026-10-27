// Pronto names carry timing-crew annotations: "Kit* Gauthier", "Rad_ Delgado_",
// "Mark (late) Andy", "Augusto (Max) Nucci", "Charlie Davis 2".
export function cleanDriverName(name) {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[*_]/g, ' ')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pre-2018 events have no overall index to restore names the class PDF cut
// short ("Jeremiah McClintoc"), so they are completed from trusted full names:
// Tour/Nationals results and ProSolos that had an overall index. A name the
// trusted set already contains is a real name, not a truncation. Longer names
// that are themselves cut short collapse into the longest one; anything still
// ambiguous is left alone.
const MIN_TRUNCATED_LENGTH = 12;

export function completeName(name, trustedNames) {
  if (name.length < MIN_TRUNCATED_LENGTH || trustedNames.includes(name)) return name;
  const longer = trustedNames.filter(known => known.length > name.length && known.startsWith(name));
  const longest = longer.filter(candidate => !longer.some(other => other.length > candidate.length && other.startsWith(candidate)));
  return longest.length === 1 ? longest[0] : name;
}
