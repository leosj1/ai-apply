const companies = ["linear", "retool", "ramp", "mercury", "coda", "brex"];
for (const co of companies) {
  const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${co}?includeCompensation=true`).catch(() => null);
  if (!r?.ok) { console.log(co, "→ err", r?.status); continue; }
  const d = await r.json();
  const jobs = (d.jobs || []).filter((j) => j.isListed && !j.isConfidential);
  if (jobs.length) {
    const j = jobs[0];
    console.log(`${co}: ${j.title}\n  URL: ${j.jobUrl}`);
    process.exit(0);
  }
  console.log(co, "→ no open jobs");
}
