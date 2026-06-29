import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function createBrowserGlobalContext(globals = {}) {
  return vm.createContext({
    console,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Date,
    isFinite,
    ...globals,
  });
}

export function loadBrowserGlobalScript(context, relativePath) {
  const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

export function evaluateGlobal(context, expression) {
  return new vm.Script(expression).runInContext(context);
}
