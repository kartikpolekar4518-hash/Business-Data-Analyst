// Numerical gradient check: compares autograd against central finite differences.
import { torch, nn, Tensor } from "./microtorch";

let failures = 0;

function check(name: string, params: Tensor[], loss: () => Tensor, eps = 1e-3, tol = 2e-2): void {
  for (const p of params) p.grad = null;
  loss().backward();
  let worst = 0;
  for (const p of params) {
    for (let i = 0; i < p.data.length; i++) {
      const orig = p.data[i];
      p.data[i] = orig + eps;
      const hi = torch.no_grad(loss).item();
      p.data[i] = orig - eps;
      const lo = torch.no_grad(loss).item();
      p.data[i] = orig;
      const numeric = (hi - lo) / (2 * eps);
      const analytic = p.grad ? p.grad.data[i] : 0;
      const rel = Math.abs(numeric - analytic) / Math.max(1, Math.abs(numeric), Math.abs(analytic));
      worst = Math.max(worst, rel);
    }
  }
  const ok = worst < tol;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}  max relative error ${worst.toExponential(2)}`);
}

// broadcasting + the elementwise op set
const a = torch.randn([3, 4], { requires_grad: true });
const b = torch.randn([1, 4], { requires_grad: true });
check("broadcast add/mul/div/pow/exp/log/tanh/sigmoid/relu", [a, b], () =>
  a.mul(b).add(b).div(a.mul(a).add(2)).tanh().add(a.sigmoid()).add(a.relu())
    .add(a.mul(a).add(1).log()).add(a.pow(3)).sum());

// matmul + transpose + reshape
const w = torch.randn([4, 5], { requires_grad: true });
check("matmul/t/reshape", [a, w], () => a.matmul(w).t().reshape(-1, 3).mul(2).sum());

// MSELoss through a Linear stack
const net = new nn.Sequential(new nn.Linear(4, 6), new nn.Tanh(), new nn.Linear(6, 2));
const target = torch.randn([3, 2]);
const mse = new nn.MSELoss();
check("MSELoss + Linear stack", net.parameters(), () => mse.forward(net.forward(a), target));

// CrossEntropyLoss through the same stack
const labels = torch.tensor([0, 1, 1]);
const ce = new nn.CrossEntropyLoss();
check("CrossEntropyLoss + Linear stack", net.parameters(), () => ce.forward(net.forward(a), labels));

// gradients accumulate across two backward passes, as in PyTorch
const s = torch.tensor([2], { requires_grad: true });
s.mul(s).sum().backward();
s.mul(s).sum().backward();
const accOk = Math.abs(s.grad!.item() - 8) < 1e-4;   // 2*2 twice
if (!accOk) failures++;
console.log(`${accOk ? "ok  " : "FAIL"} gradient accumulation (expected 8, got ${s.grad!.item()})`);

// no_grad builds no graph
const g = torch.no_grad(() => a.mul(2).sum());
const noGradOk = g.requires_grad === false && g.children.length === 0;
if (!noGradOk) failures++;
console.log(`${noGradOk ? "ok  " : "FAIL"} no_grad detaches the graph`);

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log("all gradient checks passed");
