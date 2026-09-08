# microtorch

A miniature, eager-mode, PyTorch-style deep learning framework in pure TypeScript.
Single file, zero runtime dependencies.

- Dynamic computation graph rebuilt on every forward pass (define-by-run)
- Reverse-mode autograd with PyTorch's accumulation semantics (`grad +=`)
- NumPy-style broadcasting with correct un-broadcasting of gradients
- `nn.Module` system with `parameters()`, `state_dict()`, `train()/eval()`
- SGD and bias-corrected Adam

Not a full port: pure-TS CPU loops (no CUDA/WebGPU), float32 only, ~20 ops, no
conv/pool, DataLoader, JIT, distributed training or mixed precision. JavaScript has
no operator overloading, so `a.add(b)` replaces `a + b`; everything else mirrors
PyTorch naming.

## Run it

```bash
npm install        # only dev dependency is tsx
npm run demo       # XOR + 3-blob classification
npm run test       # numerical gradient checks
```

## Example

```ts
import { torch, nn, optim } from "./microtorch";

const net = new nn.Sequential(
  new nn.Linear(2, 8), new nn.ReLU(),
  new nn.Linear(8, 1), new nn.Sigmoid(),
);
const loss_fn = new nn.MSELoss();
const opt = new optim.Adam(net.parameters(), 5e-2);

const X = torch.tensor([[0, 0], [0, 1], [1, 0], [1, 1]]);
const Y = torch.tensor([[0], [1], [1], [0]]);

for (let epoch = 0; epoch < 400; epoch++) {
  const loss = loss_fn.forward(net.forward(X), Y);
  opt.zero_grad();
  loss.backward();
  opt.step();
}
console.log(torch.no_grad(() => net.forward(X)).toString());
```

## Files

| File | What it is |
| --- | --- |
| `microtorch.ts` | The whole framework: `Tensor`, autograd, `nn`, `optim` |
| `demo.ts` | XOR regression and a 3-class blob classifier |
| `gradcheck.ts` | Autograd verified against central finite differences |

## API parity

| PyTorch | microtorch |
| --- | --- |
| `torch.Tensor`, `.grad`, `.backward()`, grad accumulation | `Tensor` — same semantics |
| broadcasting + summed-back gradients | same |
| `torch.no_grad` | `no_grad(fn)` |
| `nn.Module`, `.parameters()`, `.zero_grad()`, `.train()/.eval()` | same |
| `nn.Linear / ReLU / Sigmoid / Tanh / Sequential` | same names and behaviour (incl. ±1/√fan_in init) |
| `nn.MSELoss`, `nn.CrossEntropyLoss` | same |
| `optim.SGD`, `optim.Adam` | same (bias-corrected Adam) |
| `state_dict() / load_state_dict()` | same (`Float32Array` blobs) |
| dtypes, CUDA, conv/pool/einsum, DataLoader, JIT, DDP, AMP | not implemented |

## Roadmap

- GPU backend: WebGPU compute shaders, or N-API bindings to CUDA
- Speed: WASM + SIMD matmul kernels; batched matmul / einsum
- Layers: Conv2d (im2col), MaxPool, Dropout, LayerNorm/BatchNorm
- Data: `DataLoader` with batching and shuffling; AdamW, RMSprop, LR schedulers
- Systems: int/bool dtypes, binary serialization, autodiff for the remaining ops
