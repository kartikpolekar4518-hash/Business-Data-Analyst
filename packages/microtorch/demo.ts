import { torch, nn, optim } from "./microtorch";

// ---------- Demo 1: XOR ----------
const xor = new nn.Sequential(
  new nn.Linear(2, 8),
  new nn.ReLU(),
  new nn.Linear(8, 1),
  new nn.Sigmoid(),
);
const mse = new nn.MSELoss();
const opt1 = new optim.Adam(xor.parameters(), 5e-2);
const X = torch.tensor([[0, 0], [0, 1], [1, 0], [1, 1]]);
const Y = torch.tensor([[0], [1], [1], [0]]);

for (let epoch = 0; epoch < 400; epoch++) {
  const loss = mse.forward(xor.forward(X), Y);
  opt1.zero_grad();
  loss.backward();
  opt1.step();
  if (epoch % 100 === 0) console.log(`xor  epoch ${epoch}  loss ${loss.item().toFixed(4)}`);
}
console.log(torch.no_grad(() => xor.forward(X)).toString());

// ---------- Demo 2: 3-blob classification with cross-entropy ----------
const centers = [[1.5, 1], [-1.5, 1], [0, -1.5]];
const xs: number[][] = [];
const ys: number[] = [];
centers.forEach(([cx, cy], c) => {
  for (let i = 0; i < 40; i++) {
    xs.push([cx + torch.randn([]).item() * 0.4, cy + torch.randn([]).item() * 0.4]);
    ys.push(c);
  }
});
const XB = torch.tensor(xs);
const YB = torch.tensor(ys);
const clf = new nn.Sequential(new nn.Linear(2, 16), new nn.ReLU(), new nn.Linear(16, 3));
const ce = new nn.CrossEntropyLoss();
const opt2 = new optim.Adam(clf.parameters(), 2e-2);

for (let epoch = 0; epoch < 150; epoch++) {
  const loss = ce.forward(clf.forward(XB), YB);
  opt2.zero_grad();
  loss.backward();
  opt2.step();
  if (epoch % 50 === 0) console.log(`clf  epoch ${epoch}  loss ${loss.item().toFixed(4)}`);
}
const preds = torch.no_grad(() => clf.forward(XB)).argmax(-1);
let correct = 0;
for (let i = 0; i < preds.data.length; i++) if (preds.data[i] === YB.data[i]) correct++;
console.log(`accuracy: ${(100 * correct / YB.data.length).toFixed(1)}%`);
