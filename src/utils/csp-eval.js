// Lightweight CSP-safe expression & statement evaluator (no new Function / eval).
// Supports: literals, identifiers, member access, optional chaining, unary/binary/ternary,
// array & object literals, function/method calls, and simple assignments / ++ / --.

const KEYWORDS = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  NaN: NaN,
  Infinity: Infinity,
};

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function tokenize(source) {
  const tokens = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let val = "";
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < len) {
          const next = source[++i];
          if (next === "n") val += "\n";
          else if (next === "r") val += "\r";
          else if (next === "t") val += "\t";
          else val += next;
          i++;
        } else {
          val += source[i++];
        }
      }
      if (source[i] !== quote) throw new Error("Unterminated string literal");
      i++;
      tokens.push({ type: "str", value: val });
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] || ""))) {
      let num = "";
      while (i < len && /[0-9.]/.test(source[i])) num += source[i++];
      tokens.push({ type: "num", value: Number(num) });
      continue;
    }

    // Identifier
    if (/[A-Za-z_$]/.test(ch)) {
      let id = "";
      while (i < len && /[A-Za-z0-9_$]/.test(source[i])) id += source[i++];
      tokens.push({ type: "id", value: id });
      continue;
    }

    // 3-char operators
    const three = source.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three });
      i += 3;
      continue;
    }

    // 2-char operators
    const two = source.slice(i, i + 2);
    if (
      ["==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/="].includes(
        two,
      )
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    // Single-char punctuation / operators
    tokens.push({ type: "punc", value: ch });
    i++;
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function lookupRoot(name, ctx) {
  if (name in KEYWORDS) return { owner: KEYWORDS, key: name, value: KEYWORDS[name], found: true };
  if (name in ctx.extra) return { owner: ctx.extra, key: name, value: ctx.extra[name], found: true };
  if (name in ctx.magics) return { owner: ctx.magics, key: name, value: ctx.magics[name], found: true };
  if (ctx.locals && name in ctx.locals) {
    return { owner: ctx.locals, key: name, value: ctx.locals[name], found: true };
  }
  if (ctx.state && name in ctx.state) {
    return { owner: ctx.state, key: name, value: ctx.state[name], found: true };
  }
  if (name === "this") return { owner: null, key: null, value: ctx.state, found: true };
  if (typeof globalThis !== "undefined" && name in globalThis) {
    return { owner: globalThis, key: name, value: globalThis[name], found: true };
  }
  return { owner: ctx.state, key: name, value: undefined, found: false };
}

class Parser {
  constructor(tokens, ctx) {
    this.tokens = tokens;
    this.pos = 0;
    this.ctx = ctx;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    return this.tokens[this.pos++];
  }

  match(value) {
    if (this.peek().value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(value) {
    const tok = this.next();
    if (tok.value !== value) {
      throw new Error(`Expected '${value}' but got '${tok.value}'`);
    }
  }

  parseStatements() {
    let last;
    while (this.peek().type !== "eof") {
      if (this.match(";")) continue;
      last = this.parseAssignment();
      this.match(";");
    }
    return last;
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const startPos = this.pos;
    const lhsRef = this.tryParseLValue();
    const opTok = this.peek();

    if (lhsRef && ["=", "+=", "-=", "*=", "/="].includes(opTok.value)) {
      this.next();
      const rhs = this.parseAssignment();
      if (!lhsRef.owner || BLOCKED_KEYS.has(String(lhsRef.key))) {
        throw new Error("Invalid assignment target");
      }
      if (opTok.value === "=") lhsRef.owner[lhsRef.key] = rhs;
      else if (opTok.value === "+=") lhsRef.owner[lhsRef.key] += rhs;
      else if (opTok.value === "-=") lhsRef.owner[lhsRef.key] -= rhs;
      else if (opTok.value === "*=") lhsRef.owner[lhsRef.key] *= rhs;
      else if (opTok.value === "/=") lhsRef.owner[lhsRef.key] /= rhs;
      return lhsRef.owner[lhsRef.key];
    }

    if (lhsRef && (opTok.value === "++" || opTok.value === "--")) {
      this.next();
      if (!lhsRef.owner || BLOCKED_KEYS.has(String(lhsRef.key))) {
        throw new Error("Invalid update target");
      }
      const prev = Number(lhsRef.owner[lhsRef.key]);
      lhsRef.owner[lhsRef.key] = opTok.value === "++" ? prev + 1 : prev - 1;
      return prev;
    }

    this.pos = startPos;
    return this.parseTernary();
  }

  tryParseLValue() {
    const tok = this.peek();
    if (tok.type !== "id" || tok.value in KEYWORDS) return null;
    this.next();
    let ref = lookupRoot(tok.value, this.ctx);

    while (true) {
      if (this.match(".")) {
        const prop = this.next();
        if (prop.type !== "id") return null;
        if (BLOCKED_KEYS.has(prop.value)) return null;
        const owner = ref.value;
        if (owner == null) return null;
        ref = { owner, key: prop.value, value: owner[prop.value], found: true };
      } else if (this.match("[")) {
        const key = this.parseExpression();
        this.expect("]");
        if (BLOCKED_KEYS.has(String(key))) return null;
        const owner = ref.value;
        if (owner == null) return null;
        ref = { owner, key, value: owner[key], found: true };
      } else {
        break;
      }
    }

    return ref;
  }

  parseTernary() {
    const cond = this.parseNullish();
    if (this.match("?")) {
      const thenBranch = this.parseExpression();
      this.expect(":");
      const elseBranch = this.parseExpression();
      return cond ? thenBranch : elseBranch;
    }
    return cond;
  }

  parseNullish() {
    let left = this.parseOr();
    while (this.match("??")) {
      const right = this.parseOr();
      left = left ?? right;
    }
    return left;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match("||")) {
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  parseAnd() {
    let left = this.parseEquality();
    while (this.match("&&")) {
      const right = this.parseEquality();
      left = left && right;
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (["===", "!==", "==", "!="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseComparison();
      if (op === "===") left = left === right;
      else if (op === "!==") left = left !== right;
      else if (op === "==") left = left == right;
      else left = left != right;
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (["<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAdditive();
      if (op === "<") left = left < right;
      else if (op === "<=") left = left <= right;
      else if (op === ">") left = left > right;
      else left = left >= right;
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek().value === "+" || this.peek().value === "-") {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      if (op === "*") left = left * right;
      else if (op === "/") left = left / right;
      else left = left % right;
    }
    return left;
  }

  parseUnary() {
    if (this.match("!")) return !this.parseUnary();
    if (this.match("-")) return -this.parseUnary();
    if (this.match("+")) return +this.parseUnary();
    if (this.peek().type === "id" && this.peek().value === "typeof") {
      this.next();
      return typeof this.parseUnary();
    }
    if (this.peek().value === "++" || this.peek().value === "--") {
      const op = this.next().value;
      const ref = this.tryParseLValue();
      if (!ref || !ref.owner || BLOCKED_KEYS.has(String(ref.key))) {
        throw new Error("Invalid prefix update target");
      }
      const next = Number(ref.owner[ref.key]) + (op === "++" ? 1 : -1);
      ref.owner[ref.key] = next;
      return next;
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let owner = null;
    let value = this.parsePrimary();

    while (true) {
      if (this.match(".") || this.match("?.")) {
        const optional = this.tokens[this.pos - 1].value === "?.";
        const prop = this.next();
        if (prop.type !== "id") throw new Error("Expected property name");
        if (BLOCKED_KEYS.has(prop.value)) {
          owner = value;
          value = undefined;
          continue;
        }
        if (value == null) {
          if (optional) {
            owner = null;
            value = undefined;
            continue;
          }
          throw new TypeError(`Cannot read property '${prop.value}' of ${value}`);
        }
        owner = value;
        value = value[prop.value];
      } else if (this.match("[")) {
        const key = this.parseExpression();
        this.expect("]");
        if (BLOCKED_KEYS.has(String(key))) {
          owner = value;
          value = undefined;
          continue;
        }
        owner = value;
        value = value == null ? undefined : value[key];
      } else if (this.match("(")) {
        const args = [];
        if (this.peek().value !== ")") {
          do {
            args.push(this.parseExpression());
          } while (this.match(","));
        }
        this.expect(")");
        if (typeof value !== "function") {
          throw new TypeError("Attempted to call a non-function");
        }
        value = value.apply(owner ?? this.ctx.state, args);
        owner = null;
      } else {
        break;
      }
    }

    return value;
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.type === "num" || tok.type === "str") {
      this.next();
      return tok.value;
    }

    if (tok.type === "id") {
      this.next();
      const ref = lookupRoot(tok.value, this.ctx);
      if (!ref.found) {
        throw new ReferenceError(`${tok.value} is not defined`);
      }
      return ref.value;
    }

    if (this.match("(")) {
      const val = this.parseExpression();
      this.expect(")");
      return val;
    }

    if (this.match("[")) {
      const arr = [];
      if (this.peek().value !== "]") {
        do {
          if (this.peek().value === "]") break;
          arr.push(this.parseExpression());
        } while (this.match(","));
      }
      this.expect("]");
      return arr;
    }

    if (this.match("{")) {
      const obj = {};
      if (this.peek().value !== "}") {
        do {
          if (this.peek().value === "}") break;
          const keyTok = this.next();
          const key =
            keyTok.type === "id" || keyTok.type === "str" || keyTok.type === "num"
              ? String(keyTok.value)
              : null;
          if (key === null) throw new Error("Invalid object key");
          if (this.match(":")) {
            obj[key] = this.parseExpression();
          } else if (keyTok.type === "id") {
            const ref = lookupRoot(key, this.ctx);
            if (!ref.found) throw new ReferenceError(`${key} is not defined`);
            obj[key] = ref.value;
          } else {
            throw new Error("Expected ':' after object key");
          }
        } while (this.match(","));
      }
      this.expect("}");
      return obj;
    }

    throw new Error(`Unexpected token '${tok.value}'`);
  }
}

export function cspEval(expr, ctx) {
  const tokens = tokenize(String(expr || ""));
  const parser = new Parser(tokens, ctx);
  const result = parser.parseExpression();
  if (parser.peek().type !== "eof") {
    throw new Error(`Unexpected token '${parser.peek().value}'`);
  }
  return result;
}

export function cspExec(stmt, ctx) {
  const tokens = tokenize(String(stmt || ""));
  const parser = new Parser(tokens, ctx);
  return parser.parseStatements();
}
