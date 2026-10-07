(() => {
  const section = document.getElementById("calculator");
  const display = document.getElementById("calculatorDisplay");
  const expression = document.getElementById("calculatorExpression");
  let entry = "0", stored = null, operator = null, fresh = false, error = false;
  const symbols = { "+": "+", "-": "−", "*": "×", "/": "÷" };
  const format = value => String(value).replace(".", ",");

  function press(key) {
    if (key === "clear" || error) {
      entry = "0"; stored = null; operator = null; fresh = false; error = false;
      if (key === "clear") return render();
    }
    if (/^\d$/.test(key)) {
      entry = fresh || entry === "0" ? key : entry.length < 16 ? entry + key : entry;
      fresh = false;
    } else if (key === "," || key === ".") {
      if (fresh) entry = "0";
      if (!entry.includes(".")) entry += ".";
      fresh = false;
    } else if (key === "backspace") {
      if (!fresh) entry = entry.slice(0, -1) || "0";
      if (entry === "-") entry = "0";
    } else if (key === "sign") {
      if (Number(entry) !== 0) entry = entry.startsWith("-") ? entry.slice(1) : "-" + entry;
    } else if (symbols[key] || key === "=") {
      if (operator && !fresh) {
        const right = Number(entry);
        const result = operator === "+" ? stored + right : operator === "-" ? stored - right : operator === "*" ? stored * right : right === 0 ? NaN : stored / right;
        if (!Number.isFinite(result)) {
          entry = right === 0 && operator === "/" ? "Não é possível dividir por zero" : "Resultado fora do limite";
          stored = null; operator = null; error = true;
          return render();
        }
        entry = String(Number(result.toPrecision(12)));
      }
      stored = key === "=" ? null : Number(entry);
      operator = key === "=" ? null : key;
      fresh = true;
    }
    render();
  }

  function render() {
    display.textContent = format(entry);
    display.classList.toggle("calculator-error", error);
    expression.textContent = operator ? `${format(stored)} ${symbols[operator]}` : "";
  }

  document.getElementById("calculatorKeys").addEventListener("click", event => {
    const button = event.target.closest("button[data-key]");
    if (button) press(button.dataset.key);
  });
  document.addEventListener("keydown", event => {
    if (!section.classList.contains("active") || document.getElementById("authScreen").classList.contains("active")) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const key = { Enter: "=", Escape: "clear", Delete: "clear", Backspace: "backspace" }[event.key] || event.key;
    if (/^[0-9,+*/.=-]$/.test(key) || ["clear", "backspace"].includes(key)) {
      event.preventDefault();
      press(key);
    }
  });
})();
