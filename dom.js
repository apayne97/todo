// Tiny DOM builder shared by the two front-ends. Not a framework — it just
// replaces the createElement / className / append boilerplate.
//
//   el("div", { class: "row", onclick: fn }, titleSpan, "some text", maybeNull)
//   el("span", { class: "dot", style: { background: color } })
//   el("input", { type: "date", value: iso, min: today })   // reflected props
//   el("h1", { html: "<b>x</b>" })                            // raw innerHTML
//
// attrs: `class` → className, `html` → innerHTML, `style` object → Object.assign,
// `onX` function → event handler, anything that's a real property on the node
// (value, type, rows, href, disabled, title, …) is set as a property, everything
// else via setAttribute. children: nodes, strings, numbers, arrays (flattened);
// null / undefined / false / true are skipped so `cond && el(...)` works — but a
// number 0 IS rendered (React footgun), so write `arr.length > 0 && el(...)`, not
// `arr.length && el(...)`.

function addKids(n, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) addKids(n, c);
    else n.append(c.nodeType ? c : String(c));
  }
}

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k[0] === "o" && k[1] === "n" && typeof v === "function") n[k.toLowerCase()] = v;
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
  }
  addKids(n, kids);
  return n;
}

// empty a node
export function clear(n) {
  n.replaceChildren();
}
