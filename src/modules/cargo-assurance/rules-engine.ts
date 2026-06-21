// =============================================================================
// Cargo Assurance — safe, versioned rules engine
// -----------------------------------------------------------------------------
// Client procedures and Taylor methodologies are expressed as DECLARATIVE rule
// trees, never as executable code. Evaluation uses a whitelisted set of operators
// over a named numeric context — there is NO eval, no function construction, no
// property access into arbitrary objects. A methodology pins a version so historical
// reviews reproduce exactly. See docs/cargo-assurance/cargo-calculation-engine.md.
// =============================================================================
import { round } from './numeric';

/** A node in a declarative rule expression. */
export type RuleNode =
  | { const: number }
  | { ref: string } // a named input from the evaluation context
  | { op: BinaryOp; args: [RuleNode, RuleNode] }
  | { op: UnaryOp; args: [RuleNode] }
  | { op: 'sum'; args: RuleNode[] };

export type BinaryOp = 'add' | 'sub' | 'mul' | 'div';
export type UnaryOp = 'neg' | 'abs';

export interface Methodology {
  key: string;
  version: number;
  /** Named output expressions, e.g. { received: <RuleNode>, variance: <RuleNode> }. */
  outputs: Record<string, RuleNode>;
}

export type EvalContext = Record<string, number>;

export class RuleEvaluationError extends Error {}

const BINARY: Record<BinaryOp, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => {
    if (b === 0) throw new RuleEvaluationError('Division by zero');
    return a / b;
  },
};

const UNARY: Record<UnaryOp, (a: number) => number> = {
  neg: (a) => -a,
  abs: (a) => Math.abs(a),
};

// Bounds so an untrusted client-procedure rule tree can never exhaust the stack or
// run unbounded compute (the engine throws RuleEvaluationError well before a native
// RangeError / stack overflow could crash the evaluating worker).
export const MAX_RULE_DEPTH = 64;
export const MAX_RULE_NODES = 10_000;
export const MAX_SUM_ARGS = 1_000;

/** Evaluate a single rule node against a numeric context. Pure and total (throws on misuse). */
export function evaluateNode(node: RuleNode, ctx: EvalContext): number {
  return evalGuarded(node, ctx, 0, { count: 0 });
}

function evalGuarded(node: RuleNode, ctx: EvalContext, depth: number, counter: { count: number }): number {
  if (depth > MAX_RULE_DEPTH) {
    throw new RuleEvaluationError(`Rule nesting too deep (> ${MAX_RULE_DEPTH})`);
  }
  if (++counter.count > MAX_RULE_NODES) {
    throw new RuleEvaluationError(`Rule too large (> ${MAX_RULE_NODES} nodes)`);
  }

  if ('const' in node) {
    if (!Number.isFinite(node.const)) throw new RuleEvaluationError('Non-finite constant');
    return node.const;
  }
  if ('ref' in node) {
    const v = ctx[node.ref];
    if (v === undefined) throw new RuleEvaluationError(`Unknown input: ${node.ref}`);
    if (!Number.isFinite(v)) throw new RuleEvaluationError(`Non-finite input: ${node.ref}`);
    return v;
  }
  if (node.op === 'sum') {
    if (node.args.length > MAX_SUM_ARGS) {
      throw new RuleEvaluationError(`sum has too many operands (> ${MAX_SUM_ARGS})`);
    }
    return node.args.reduce((acc, n) => acc + evalGuarded(n, ctx, depth + 1, counter), 0);
  }
  if (node.op === 'neg' || node.op === 'abs') {
    const operand = node.args[0];
    if (!operand) throw new RuleEvaluationError(`Unary operator ${node.op} requires one operand`);
    return UNARY[node.op](evalGuarded(operand, ctx, depth + 1, counter));
  }
  const fn = BINARY[node.op as BinaryOp];
  if (!fn) throw new RuleEvaluationError(`Unsupported operator: ${(node as { op: string }).op}`);
  const [left, right] = node.args;
  if (!left || !right) throw new RuleEvaluationError(`Operator ${node.op} requires two operands`);
  return fn(evalGuarded(left, ctx, depth + 1, counter), evalGuarded(right, ctx, depth + 1, counter));
}

/** Evaluate every output of a methodology against a context; results rounded to 4 dp. */
export function evaluateMethodology(methodology: Methodology, ctx: EvalContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, node] of Object.entries(methodology.outputs)) {
    out[name] = round(evaluateNode(node, ctx));
  }
  return out;
}
