// Job-posting capture bookmarklet.
//
// Install: see README.md — this file is the readable source; the actual
// bookmark is a minified one-liner built from it (see build step below).
//
// What it does: on a job-posting page, looks for schema.org JobPosting
// structured data (the JSON-LD block most ATSs — Greenhouse, Workday, Lever,
// LinkedIn — embed for Google Jobs SEO), asks you to confirm/edit the two
// fields worth a second look, then POSTs a new task straight into the todo
// app's todos.md via the server's /capture endpoint. No extension, no install
// beyond dragging one link to your bookmarks bar.
//
// The todo app must be running at TODO_APP_ORIGIN for this to work.

(function () {
  const TODO_APP_ORIGIN = "http://localhost:4444";

  function findJobPosting() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const candidates = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const c of candidates) {
        const type = c && c["@type"];
        const isJobPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
        if (isJobPosting) return c;
      }
    }
    return null;
  }

  function orgName(jp) {
    const org = jp.hiringOrganization;
    if (!org) return "";
    return typeof org === "string" ? org : org.name || "";
  }

  function locationText(jp) {
    const loc = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
    const addr = loc && loc.address;
    if (!addr) return "";
    if (typeof addr === "string") return addr;
    return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
  }

  function salaryRange(jp) {
    const sal = jp.baseSalary && jp.baseSalary.value;
    if (!sal) return [null, null];
    if (typeof sal === "number") return [sal, sal];
    return [sal.minValue ?? sal.value ?? null, sal.maxValue ?? sal.value ?? null];
  }

  function fmtMoney(n) {
    if (n == null) return null;
    return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
  }

  function isoDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  const jp = findJobPosting();

  let role, company, jobLocation, salaryMin, salaryMax, closing;
  if (jp) {
    role = jp.title || document.title;
    company = orgName(jp);
    jobLocation = locationText(jp);
    [salaryMin, salaryMax] = salaryRange(jp);
    closing = isoDate(jp.validThrough);
  } else {
    role = document.title;
    company = "";
  }

  role = prompt("Role title:", role || "") || role;
  company = prompt("Company:", company || "") || company;
  if (!company) {
    alert("Need a company name to capture this — cancelled.");
    return;
  }

  const noteBits = [];
  if (jobLocation) noteBits.push(`Location: ${jobLocation}`);
  if (salaryMin || salaryMax) {
    const lo = fmtMoney(salaryMin) || "?";
    const hi = fmtMoney(salaryMax) || "?";
    noteBits.push(`Salary: ${lo}–${hi}`);
  }
  if (closing) noteBits.push(`Closes: ${closing}`);
  if (!jp) noteBits.push("(no structured job data found on this page — captured manually)");

  const payload = {
    title: `apply to ${company} — ${role}`,
    url: window.location.href,
    due: closing,
    note: noteBits.join(" · "),
  };

  fetch(TODO_APP_ORIGIN + "/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j.ok) alert(`Added to todo app ✓\n${payload.title}`);
      else alert("Todo app said: " + (j.error || "failed"));
    })
    .catch((e) => {
      alert(
        "Couldn't reach the todo app at " +
          TODO_APP_ORIGIN +
          " — is it running?\n(" +
          e.message +
          ")"
      );
    });
})();
