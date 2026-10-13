/**
 * The operator (AOC) the user is working for. Sent as X-Operator on every API call; the API accepts it
 * only if the user is a member of that operator. Remembered per browser for convenience only.
 */
const KEY = 'aeroos.operator';
let current: string | null = null;
try {
  current = localStorage.getItem(KEY);
} catch {
  /* storage unavailable: start with the default operator */
}

export const selectedOperator = () => current;

export function selectOperator(id: string | null) {
  current = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
