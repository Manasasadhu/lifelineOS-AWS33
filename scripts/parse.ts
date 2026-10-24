/**
 * Try the fallback parser:
 *   npm run parse -- "My grandmother needs insulin and we have no electricity."
 */
import { parseRequestLocally, redactText } from '../src/engine';

const text = process.argv.slice(2).join(' ');
if (!text) {
  console.error('Usage: npm run parse -- "<request text>"');
  process.exit(1);
}
console.log(`text:     ${redactText(text)}`);
console.log(JSON.stringify(parseRequestLocally(text), null, 2));
