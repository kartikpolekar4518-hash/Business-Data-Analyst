import { afterEach, describe, test, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Input, Select, Label, PasswordInput, Modal, ToastProvider, useToast } from "./ui";

afterEach(cleanup);

describe("Input error semantics", () => {
  test("no error: no invalid/describedby and no error text", () => {
    render(<Input aria-label="Email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  test("error: sets aria-invalid and links the message via aria-describedby", () => {
    render(<Input id="email" aria-label="Email" error="Enter a valid email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBe("email-error");
    // The linked element actually exists and carries the message.
    const msg = document.getElementById("email-error");
    expect(msg?.textContent).toContain("Enter a valid email");
  });

  test("error: preserves a caller-supplied aria-describedby and appends the error id", () => {
    render(<Input id="pw" aria-label="Password" aria-describedby="pw-hint" error="Too short" />);
    const input = screen.getByLabelText("Password");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toContain("pw-hint");
    expect(ids).toContain("pw-error");
  });
});

describe("Select error semantics", () => {
  test("error: sets aria-invalid and links the message", () => {
    render(
      <Select id="role" aria-label="Role" error="Pick a role">
        <option value="a">A</option>
      </Select>,
    );
    const select = screen.getByLabelText("Role");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("role-error");
    expect(document.getElementById("role-error")?.textContent).toContain("Pick a role");
  });
});

describe("Label association", () => {
  test("htmlFor targets the matching input id", () => {
    render(
      <>
        <Label htmlFor="e1">Work email</Label>
        <Input id="e1" />
      </>,
    );
    // getByLabelText resolves the label→input relationship.
    expect(screen.getByLabelText("Work email").id).toBe("e1");
  });
});

describe("PasswordInput toggle", () => {
  test("toggles visibility, updates its label, and preserves the value", () => {
    render(<PasswordInput aria-label="Password" defaultValue="s3cret" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("s3cret");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("s3cret"); // value not lost on toggle

    // The control now offers to hide again.
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  test("toggle is type=button so it never submits the form", () => {
    render(<PasswordInput aria-label="Password" />);
    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("type")).toBe("button");
  });
});

describe("Toast", () => {
  function ToastHarness() {
    const { toast } = useToast();
    return (
      <button onClick={() => { toast("m1"); toast("m2"); toast("m3"); toast("m4"); toast("m5", "error"); }}>
        fire
      </button>
    );
  }

  test("caps the visible stack at 3 and drops the oldest", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    // 5 fired, only the newest 3 remain (m3, m4, m5).
    expect(screen.getAllByText(/^m[0-9]$/)).toHaveLength(3);
    expect(screen.queryByText("m1")).toBeNull();
    expect(screen.queryByText("m2")).toBeNull();
  });

  test("error toasts announce assertively; info/success stay polite", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    // m5 is the error → role=alert (assertive); the others are role=status (polite).
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain("m5");
    expect(screen.getAllByRole("status").length).toBe(2);
  });
});

describe("Modal focus management", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Test modal">
          <button>Inside action</button>
        </Modal>
      </>
    );
  }

  test("focus enters the modal on open and returns to the opener on close", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    // Focus moved into the dialog.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Close via the modal's Close button; focus returns to the original opener.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });
});
