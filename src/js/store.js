// Saved on this phone. Every key carries a version prefix so a later app version can
// read or convert older data instead of losing it. If the browser refuses storage
// (private window, full disk) the app keeps working from memory for this session.

const PREFIX = 'mb1.';
const memory = new Map();

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    /* fall through to memory */
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function save(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to do */
  }
}
