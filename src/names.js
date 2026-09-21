// Usernames are stored lowercase (they are identity keys in selections.user_name
// and must match exactly). For DISPLAY only, show them with a capital first
// letter. Never write the result of this back to the database.
export function cap(name) {
  if (!name) return name
  const s = String(name)
  return s.charAt(0).toUpperCase() + s.slice(1)
}
