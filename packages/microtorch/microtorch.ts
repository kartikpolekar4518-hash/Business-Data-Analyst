// microtorch.ts — miniature, eager-mode, PyTorch-style DL framework in pure TypeScript.
// Mirrors torch.Tensor / torch.nn / torch.optim API and define-by-run autograd semantics.

export type Shape = number[];
export type Nested = number | Nested[];

let gradMode = true;
export function no_grad<T>(fn: () => T): T {
  const prev = gradMode;
  gradMode = false;
  try { return fn(); } finally { gradMode = prev; }
}

const numel = (s: Shape): number => s.reduce((a, b) => a * b, 1);

function stridesOf(shape: Shape): number[] {
  const st = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) st[i] = st[i + 1] * shape[i + 1];
  return st;
}

function forEachIndex(shape: Shape, fn: (idx: number[]) => void): void {
  const rank = shape.length;
  if (rank === 0) { fn([]); return; }
  const idx = new Array(rank).fill(0);
  const total = numel(shape);
  for (let k = 0; k < total; k++) {
    fn(idx);
    for (let d = rank - 1; d >= 0; d--) { if (++idx[d] < shape[d]) break; idx[d] = 0; }
  }
}

const dot = (idx: number[], st: number[]): number => {
  let o = 0;
  for (let i = 0; i < idx.length; i++) o += idx[i] * st[i];
  return o;
};

// offset into a (possibly broadcast) operand, given an index of the output tensor
function bcastOffset(idx: number[], outRank: number, shape: Shape, st: number[]): number {
  let o = 0;
  const diff = outRank - shape.length;
  for (let i = 0; i < shape.length; i++) o += (shape[i] === 1 ? 0 : idx[diff + i]) * st[i];
  return o;
}

function broadcastShape(a: Shape, b: Shape): number[] {
  const rank = Math.max(a.length, b.length);
  const out = new Array(rank);
  for (let i = 0; i < rank; i++) {
    const da = a[a.length - rank + i] ?? 1;
    const db = b[b.length - rank + i] ?? 1;
    if (da !== db && da !== 1 && db !== 1)
      throw new Error(`Shapes ${a} and ${b} are not broadcastable`);
    out[i] = Math.max(da, db);
  }
  return out;
}

// PyTorch semantics: gradients ACCUMULATE into .grad
function accumulate(t: Tensor, g: Float32Array): void {
  if (!t.requires_grad) return;
  if (!t.grad) t.grad = new Tensor(new Float32Array(t.data.length), t.shape);
  const d = t.grad.data;
  for (let i = 0; i < g.length; i++) d[i] += g[i];
}

export class Tensor {
  data: Float32Array;
  shape: Shape;
  requires_grad: boolean;
  grad: Tensor | null = null;
  children: Tensor[] = [];          // parents in the autograd graph
  _backward: () => void = () => {}; // local backward rule

  constructor(data: Float32Array | number[], shape: Shape, requires_grad = false) {
    this.data = data instanceof Float32Array ? data : Float32Array.from(data);
    this.shape = [...shape];
    if (this.data.length !== numel(this.shape))
      throw new Error(`data length ${this.data.length} != numel(shape) ${numel(this.shape)}`);
    this.requires_grad = requires_grad;
  }

  get ndim(): number { return this.shape.length; }
  get dtype(): string { return "float32"; }
  get device(): string { return "cpu"; }

  item(): number {
    if (numel(this.shape) !== 1) throw new Error("item() only valid for scalar tensors");
    return this.data[0];
  }

  // ---------------- autograd: topological sort, then reverse-mode sweep ----------------
  backward(): void {
    if (!this.requires_grad)
      throw new Error("element 0 of tensors does not require grad and does not have a grad_fn");
    if (numel(this.shape) !== 1)
      throw new Error("grad can be implicitly created only for scalar outputs");
    const topo: Tensor[] = [];
    const seen = new Set<Tensor>();
    const dfs = (t: Tensor): void => {
      if (seen.has(t)) return;
      seen.add(t);
      for (const p of t.children) dfs(p);
      topo.push(t);
    };
    dfs(this);
    if (!this.grad) this.grad = new Tensor(new Float32Array([1]), this.shape);
    for (let i = topo.length - 1; i >= 0; i--) {
      const t = topo[i];
      if (t.grad) t._backward();
    }
  }

  // ---------------- elementwise binary ops with broadcasting ----------------
  private bin(other: Tensor | number, f: (x: number, y: number) => number,
              dfdx?: (x: number, y: number) => number,
              dfdy?: (x: number, y: number) => number): Tensor {
    const a = this;
    const b = typeof other === "number" ? new Tensor([other], []) : other;
    const shape = broadcastShape(a.shape, b.shape);
    const oStr = stridesOf(shape), aStr = stridesOf(a.shape), bStr = stridesOf(b.shape);
    const out = new Float32Array(numel(shape));
    forEachIndex(shape, (idx) => {
      const o = dot(idx, oStr);
      out[o] = f(a.data[bcastOffset(idx, shape.length, a.shape, aStr)],
                 b.data[bcastOffset(idx, shape.length, b.shape, bStr)]);
    });
    const needs = gradMode && (a.requires_grad || b.requires_grad);
    const res = new Tensor(out, shape, needs);
    if (needs) {
      res.children = [a, b];
      res._backward = () => {
        const g = res.grad!.data;
        if (a.requires_grad) {                       // un-broadcast: sum grad over broadcast dims
          const ga = new Float32Array(a.data.length);
          forEachIndex(shape, (idx) => {
            const o  = dot(idx, oStr);
            const oa = bcastOffset(idx, shape.length, a.shape, aStr);
            const ob = bcastOffset(idx, shape.length, b.shape, bStr);
            ga[oa] += g[o] * (dfdx ? dfdx(a.data[oa], b.data[ob]) : 1);
          });
          accumulate(a, ga);
        }
        if (b.requires_grad) {
          const gb = new Float32Array(b.data.length);
          forEachIndex(shape, (idx) => {
            const o  = dot(idx, oStr);
            const oa = bcastOffset(idx, shape.length, a.shape, aStr);
            const ob = bcastOffset(idx, shape.length, b.shape, bStr);
            gb[ob] += g[o] * (dfdy ? dfdy(a.data[oa], b.data[ob]) : 1);
          });
          accumulate(b, gb);
        }
      };
    }
    return res;
  }

  add(o: Tensor | number): Tensor { return this.bin(o, (x, y) => x + y); }
  sub(o: Tensor | number): Tensor { return this.bin(o, (x, y) => x - y, undefined, () => -1); }
  mul(o: Tensor | number): Tensor { return this.bin(o, (x, y) => x * y, (x, y) => y, (x, y) => x); }
  div(o: Tensor | number): Tensor {
    return this.bin(o, (x, y) => x / y, (_x, y) => 1 / y, (x, y) => -x / (y * y));
  }

  // ---------------- elementwise unary ops ----------------
  private un(f: (x: number) => number, df: (x: number) => number): Tensor {
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = f(this.data[i]);
    const needs = gradMode && this.requires_grad;
    const res = new Tensor(out, this.shape, needs);
    if (needs) {
      res.children = [this];
      res._backward = () => {
        const g = res.grad!.data;
        const ga = new Float32Array(this.data.length);
        for (let i = 0; i < g.length; i++) ga[i] = g[i] * df(this.data[i]);
        accumulate(this, ga);
      };
    }
    return res;
  }

  neg(): Tensor     { return this.un((x) => -x, () => -1); }
  pow(n: number): Tensor { return this.un((x) => Math.pow(x, n), (x) => n * Math.pow(x, n - 1)); }
  exp(): Tensor     { return this.un(Math.exp, Math.exp); }
  log(): Tensor     { return this.un(Math.log, (x) => 1 / x); }
  relu(): Tensor    { return this.un((x) => (x > 0 ? x : 0), (x) => (x > 0 ? 1 : 0)); }
  sigmoid(): Tensor {
    return this.un((x) => 1 / (1 + Math.exp(-x)),
                   (x) => { const s = 1 / (1 + Math.exp(-x)); return s * (1 - s); });
  }
  tanh(): Tensor    { return this.un(Math.tanh, (x) => 1 - Math.tanh(x) ** 2); }

  // ---------------- reductions ----------------
  sum(): Tensor {
    let s = 0;
    for (let i = 0; i < this.data.length; i++) s += this.data[i];
    const needs = gradMode && this.requires_grad;
    const res = new Tensor(new Float32Array([s]), [], needs);
    if (needs) {
      res.children = [this];
      res._backward = () =>
        accumulate(this, new Float32Array(this.data.length).fill(res.grad!.data[0]));
    }
    return res;
  }
  mean(): Tensor { return this.sum().div(this.data.length); }

  // ---------------- linear algebra (2-D) ----------------
  matmul(other: Tensor): Tensor {
    if (this.ndim !== 2 || other.ndim !== 2 || this.shape[1] !== other.shape[0])
      throw new Error(`matmul: shape mismatch ${this.shape} @ ${other.shape}`);
    const [m, k] = this.shape;
    const n = other.shape[1];
    const A = this.data, B = other.data;
    const C = new Float32Array(m * n);
    for (let i = 0; i < m; i++)
      for (let p = 0; p < k; p++) {
        const a = A[i * k + p];
        if (a === 0) continue;
        for (let j = 0; j < n; j++) C[i * n + j] += a * B[p * n + j];
      }
    const needs = gradMode && (this.requires_grad || other.requires_grad);
    const res = new Tensor(C, [m, n], needs);
    if (needs) {
      res.children = [this, other];
      res._backward = () => {
        const g = res.grad!.data;
        if (this.requires_grad) {                    // dA = g @ B^T
          const dA = new Float32Array(m * k);
          for (let i = 0; i < m; i++)
            for (let j = 0; j < n; j++) {
              const gv = g[i * n + j];
              if (gv === 0) continue;
              for (let p = 0; p < k; p++) dA[i * k + p] += gv * B[p * n + j];
            }
          accumulate(this, dA);
        }
        if (other.requires_grad) {                   // dB = A^T @ g
          const dB = new Float32Array(k * n);
          for (let i = 0; i < m; i++)
            for (let j = 0; j < n; j++) {
              const gv = g[i * n + j];
              if (gv === 0) continue;
              for (let p = 0; p < k; p++) dB[p * n + j] += A[i * k + p] * gv;
            }
          accumulate(other, dB);
        }
      };
    }
    return res;
  }

  t(): Tensor {                                      // 2-D transpose
    if (this.ndim !== 2) throw new Error("t(): only 2D supported");
    const [r, c] = this.shape;
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < r; i++)
      for (let j = 0; j < c; j++) out[j * r + i] = this.data[i * c + j];
    const needs = gradMode && this.requires_grad;
    const res = new Tensor(out, [c, r], needs);
    if (needs) {
      res.children = [this];
      res._backward = () => {
        const g = res.grad!.data;
        const dIn = new Float32Array(g.length);
        for (let i = 0; i < c; i++)
          for (let j = 0; j < r; j++) dIn[j * c + i] = g[i * r + j];
        accumulate(this, dIn);
      };
    }
    return res;
  }

  reshape(...dims: number[]): Tensor {
    const shape = [...dims];
    const neg = shape.indexOf(-1);
    if (neg !== -1) {
      const known = shape.filter((d) => d !== -1).reduce((a, b) => a * b, 1);
      shape[neg] = this.data.length / known;
    }
    if (numel(shape) !== this.data.length) throw new Error("reshape: size mismatch");
    const needs = gradMode && this.requires_grad;
    const res = new Tensor(this.data.slice(), shape, needs);
    if (needs) {
      res.children = [this];
      res._backward = () => accumulate(this, res.grad!.data.slice());
    }
    return res;
  }

  argmax(dim = -1): Tensor {                         // inference helper, no grad
    if (this.ndim !== 2 || (dim !== -1 && dim !== 1))
      throw new Error("argmax: only 2D, last dim supported");
    const [n, c] = this.shape;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let j = 1; j < c; j++)
        if (this.data[i * c + j] > this.data[i * c + best]) best = j;
      out[i] = best;
    }
    return new Tensor(out, [n]);
  }

  toString(): string {
    const st = stridesOf(this.shape);
    const fmt = (x: number): string => {
      const a = Math.abs(x);
      if (x !== 0 && (a >= 1e4 || a < 1e-3)) return x.toExponential(3);
      return parseFloat(x.toFixed(4)).toString();
    };
    const build = (off: number, dim: number): string => {
      if (dim === this.shape.length) return fmt(this.data[off]);
      const parts: string[] = [];
      for (let i = 0; i < this.shape[dim]; i++) parts.push(build(off + i * st[dim], dim + 1));
      const sep = dim < this.shape.length - 1 ? ",\n " : ", ";
      return "[" + parts.join(sep) + "]";
    };
    return `tensor(${build(0, 0)}${this.requires_grad ? ", requires_grad=true" : ""})`;
  }
}

// ---------------- tensor factories ----------------
function flatten(data: Nested): { shape: Shape; buf: Float32Array } {
  const shape: Shape = [];
  const buf: number[] = [];
  const walk = (d: Nested, depth: number): void => {
    if (Array.isArray(d)) {
      if (shape[depth] === undefined) shape[depth] = d.length;
      else if (shape[depth] !== d.length) throw new Error("ragged nested arrays are not allowed");
      for (const x of d) walk(x, depth + 1);
    } else buf.push(d);
  };
  walk(data, 0);
  return { shape, buf: Float32Array.from(buf) };
}

export interface Opts { requires_grad?: boolean }

export function tensor(data: Nested, opts: Opts = {}): Tensor {
  const { shape, buf } = flatten(data);
  return new Tensor(buf, shape, opts.requires_grad ?? false);
}
export function zeros(shape: Shape, opts: Opts = {}): Tensor {
  return new Tensor(new Float32Array(numel(shape)), shape, opts.requires_grad);
}
export function ones(shape: Shape, opts: Opts = {}): Tensor {
  return new Tensor(new Float32Array(numel(shape)).fill(1), shape, opts.requires_grad);
}
export function randn(shape: Shape, opts: Opts = {}): Tensor {   // Box–Muller
  const n = numel(shape);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(Math.random(), 1e-12), u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    buf[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) buf[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return new Tensor(buf, shape, opts.requires_grad);
}

// ---------------- torch.nn ----------------
export abstract class Module {
  training = true;
  protected _parameters = new Map<string, Tensor>();
  protected _modules = new Map<string, Module>();

  register_parameter(name: string, p: Tensor): void { this._parameters.set(name, p); }
  register_module(name: string, m: Module): void { this._modules.set(name, m); }

  parameters(): Tensor[] {
    const out: Tensor[] = [...this._parameters.values()];
    for (const m of this._modules.values()) out.push(...m.parameters());
    return out;
  }
  zero_grad(): void { for (const p of this.parameters()) p.grad = null; }
  train(mode = true): this {
    this.training = mode;
    for (const m of this._modules.values()) m.train(mode);
    return this;
  }
  eval(): this { return this.train(false); }

  state_dict(prefix = ""): Record<string, Float32Array> {
    const out: Record<string, Float32Array> = {};
    for (const [n, p] of this._parameters) out[prefix + n] = p.data.slice();
    for (const [n, m] of this._modules) Object.assign(out, m.state_dict(prefix + n + "."));
    return out;
  }
  load_state_dict(sd: Record<string, Float32Array>, prefix = ""): void {
    for (const [n, p] of this._parameters) if (sd[prefix + n]) p.data.set(sd[prefix + n]);
    for (const [n, m] of this._modules) m.load_state_dict(sd, prefix + n + ".");
  }

  abstract forward(...inputs: Tensor[]): Tensor;
}

export class Linear extends Module {               // init matches torch.nn.Linear
  weight: Tensor;
  bias: Tensor | null;
  constructor(public in_features: number, public out_features: number, use_bias = true) {
    super();
    const bound = 1 / Math.sqrt(in_features);
    const w = new Float32Array(out_features * in_features);
    for (let i = 0; i < w.length; i++) w[i] = (Math.random() * 2 - 1) * bound;
    this.weight = new Tensor(w, [out_features, in_features], true);
    this.bias = use_bias
      ? new Tensor(new Float32Array(out_features).map(() => (Math.random() * 2 - 1) * bound),
                   [out_features], true)
      : null;
    this.register_parameter("weight", this.weight);
    if (this.bias) this.register_parameter("bias", this.bias);
  }
  forward(x: Tensor): Tensor {
    let y = x.matmul(this.weight.t());
    if (this.bias) y = y.add(this.bias);
    return y;
  }
}

export class ReLU extends Module    { forward(x: Tensor): Tensor { return x.relu(); } }
export class Sigmoid extends Module { forward(x: Tensor): Tensor { return x.sigmoid(); } }
export class Tanh extends Module    { forward(x: Tensor): Tensor { return x.tanh(); } }

export class Sequential extends Module {
  private layers: Module[];
  constructor(...layers: Module[]) {
    super();
    this.layers = layers;
    layers.forEach((l, i) => this.register_module(String(i), l));
  }
  forward(x: Tensor): Tensor { for (const l of this.layers) x = l.forward(x); return x; }
}

export class MSELoss extends Module {
  forward(pred: Tensor, target: Tensor): Tensor { return pred.sub(target).pow(2).mean(); }
}

export class CrossEntropyLoss extends Module {     // logits (N,C), target (N,) of class ids
  forward(logits: Tensor, target: Tensor): Tensor {
    const [n, c] = logits.shape;
    const x = logits.data, y = target.data;
    const lse = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = -Infinity;
      for (let k = 0; k < c; k++) m = Math.max(m, x[i * c + k]);
      let s = 0;
      for (let k = 0; k < c; k++) s += Math.exp(x[i * c + k] - m);
      lse[i] = m + Math.log(s);
    }
    let total = 0;
    for (let i = 0; i < n; i++) total += lse[i] - x[i * c + y[i]];
    const needs = gradMode && logits.requires_grad;
    const res = new Tensor(new Float32Array([total / n]), [], needs);
    if (needs) {
      res.children = [logits];
      res._backward = () => {                      // d/dx = (softmax - onehot) / N
        const g = res.grad!.data[0];
        const dx = new Float32Array(n * c);
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < c; k++) dx[i * c + k] = Math.exp(x[i * c + k] - lse[i]) * g / n;
          dx[i * c + y[i]] -= g / n;
        }
        accumulate(logits, dx);
      };
    }
    return res;
  }
}

// ---------------- torch.optim ----------------
export abstract class Optimizer {
  constructor(public params: Tensor[], public lr: number) {}
  zero_grad(): void { for (const p of this.params) p.grad = null; }
  abstract step(): void;
}

export class SGD extends Optimizer {
  step(): void {
    for (const p of this.params) {
      if (!p.grad) continue;
      const g = p.grad.data;
      for (let i = 0; i < p.data.length; i++) p.data[i] -= this.lr * g[i];
    }
  }
}

export class Adam extends Optimizer {              // bias-corrected, PyTorch formula
  private m: Float32Array[];
  private v: Float32Array[];
  private t = 0;
  constructor(params: Tensor[], lr = 1e-3,
              private beta1 = 0.9, private beta2 = 0.999, private eps = 1e-8) {
    super(params, lr);
    this.m = params.map((p) => new Float32Array(p.data.length));
    this.v = params.map((p) => new Float32Array(p.data.length));
  }
  step(): void {
    this.t++;
    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    this.params.forEach((p, i) => {
      if (!p.grad) return;
      const g = p.grad.data, m = this.m[i], v = this.v[i];
      for (let j = 0; j < g.length; j++) {
        m[j] = this.beta1 * m[j] + (1 - this.beta1) * g[j];
        v[j] = this.beta2 * v[j] + (1 - this.beta2) * g[j] * g[j];
        p.data[j] -= this.lr * (m[j] / bc1) / (Math.sqrt(v[j] / bc2) + this.eps);
      }
    });
  }
}

// ---------------- PyTorch-flavoured namespaces ----------------
export const torch = { Tensor, tensor, zeros, ones, randn, no_grad };
export const nn = { Module, Linear, ReLU, Sigmoid, Tanh, Sequential, MSELoss, CrossEntropyLoss };
export const optim = { Optimizer, SGD, Adam };
